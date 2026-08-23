import { createHash } from 'node:crypto';

import { z } from 'zod';

import {
  createLocalAflTradeAflTablesResultsAuthority,
  createLocalAflTradeFiveSeasonAflTablesAuthority,
} from '../development/localFiveSeasonAflTablesAuthority';
import { createLocalAflTradeOfficialAfl2026Authority } from '../development/localOfficialAfl2026Authority';
import type { AflTradeHpnPavMethodAuthority } from '../modeling/hpnPavCalculationService';
import { PostgresAflTradeHpnPavCalculationRepository } from '../modeling/postgresHpnPavCalculationRepository';
import { PostgresAflTradeHpnPavInputRepository } from '../modeling/postgresHpnPavInputRepository';
import { PostgresAflTradeHpnProjectedFieldMapAuthority } from '../modeling/postgresHpnProjectedFieldMapAuthority';
import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';
import type { AflTradeFitzRoyCaptureCommand } from '../source/fitzRoyCaptureRuntime';
import type { AflTradeFitzRoyFieldMap } from '../source/fitzRoyObservationContracts';
import {
  type AflTradePrivateValuationCaptureBinding,
  type AflTradePrivateValuationCaptureSourceRole,
} from './privateValuationCaptureBinding';
import { createAflTradePrivateValuationRawDataCoordinator } from './privateValuationRawDataCoordinator';
import { aflTradePrivateValuationDispatchRequestSchema } from './privateValuationScheduling';
import type { AflTradePrivateValuationFactualPreparationResult } from './postgresPrivateValuationFactualPreparation';
import { PostgresAflTradePrivateValuationCaptureBindingRepository } from './postgresPrivateValuationCaptureBindingRepository';
import { PostgresAflTradePrivateValuationScheduleRepository } from './postgresPrivateValuationScheduling';

const EXECUTION_DATABASE_ROLE = 'afl_trade_private_evaluation_coordinator';
const SUPPORTED_VALUATION_SCOPE_KEY = 'afl-men:2026-trades';
const requestIdSchema = z.string().regex(/^private-valuation-dispatch:[a-f0-9]{64}$/u);
const claimSchema = z
  .object({
    claimId: z.string().regex(/^private-valuation-dispatch-claim:[a-f0-9]{64}$/u),
    leaseToken: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict();
const methodIdSchema = z.string().regex(/^hpn-pav-method:[a-f0-9]{64}$/u);

type SourceAuthority = Readonly<{
  capture: AflTradeFitzRoyCaptureCommand;
  fieldMap: AflTradeFitzRoyFieldMap;
}>;

type SourceLane = Readonly<{
  sourceRole: Exclude<AflTradePrivateValuationCaptureSourceRole, 'factual_input'>;
  inputKind: 'completed_match_result' | 'player_match_stats';
  role: 'primary' | 'corroborating' | null;
  authority: SourceAuthority;
}>;

export type AflTradePrivateValuationHpnPreparationResult = Readonly<{
  state: 'prepared' | 'already_prepared';
  requestId: string;
  factualOutputId: string;
  inputSetId: string;
  calculationId: string;
  captureBindingIds: readonly string[];
  publicationEligible: false;
}>;

export interface AflTradePrivateValuationHpnPreparationDependencies {
  readonly factualPreparation: {
    prepare(input: {
      readonly requestId: string;
      readonly claim: { readonly claimId: string; readonly leaseToken: string };
    }): Promise<AflTradePrivateValuationFactualPreparationResult>;
  };
  readonly methodId: string;
  readonly methodAuthority: AflTradeHpnPavMethodAuthority;
  readonly captureSource: (input: {
    readonly requestId: string;
    readonly claim: { readonly claimId: string; readonly leaseToken: string };
    readonly sourceRole: Exclude<AflTradePrivateValuationCaptureSourceRole, 'factual_input'>;
    readonly capture: AflTradeFitzRoyCaptureCommand;
    readonly fieldMap: AflTradeFitzRoyFieldMap;
  }) => Promise<{ readonly normalizationRunId: string }>;
}

function sourceLanes(seasonYear: number): readonly SourceLane[] {
  return [
    {
      sourceRole: 'hpn_completed_results',
      inputKind: 'completed_match_result',
      role: null,
      authority: createLocalAflTradeAflTablesResultsAuthority(seasonYear),
    },
    {
      sourceRole: 'hpn_primary_player_stats',
      inputKind: 'player_match_stats',
      role: 'primary',
      authority: createLocalAflTradeFiveSeasonAflTablesAuthority(seasonYear),
    },
    {
      sourceRole: 'hpn_corroborating_player_stats',
      inputKind: 'player_match_stats',
      role: 'corroborating',
      authority: createLocalAflTradeOfficialAfl2026Authority(),
    },
  ];
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function requireExactLaneBinding(
  lane: SourceLane,
  binding: AflTradePrivateValuationCaptureBinding,
  seasonYear: number
): void {
  if (
    binding.content.schemaVersion !==
    'afl-trade-private-valuation-capture-binding/v2'
  ) {
    throw new TypeError(`Accepted source custody does not match ${lane.sourceRole}.`);
  }
  const source = binding.content.sourcePlan;
  if (
    source.provider !== lane.authority.capture.sourceRights.content.provider ||
    source.dataset !== lane.authority.capture.sourceRights.content.dataset ||
    source.capabilityId !== lane.authority.capture.gateRequest.capabilityId ||
    source.competition !== 'AFLM' ||
    source.seasonYear !== seasonYear ||
    source.fieldMapId !== lane.authority.fieldMap.mapId ||
    source.rightsArtifactId !== lane.authority.capture.sourceRights.rightsArtifactId
  ) {
    throw new TypeError(`Accepted source custody does not match ${lane.sourceRole}.`);
  }
}

export class PostgresAflTradePrivateValuationHpnPreparation {
  constructor(
    private readonly client: AflOutcomeSqlClient,
    private readonly dependencies: AflTradePrivateValuationHpnPreparationDependencies
  ) {}

  private async loadRequest(
    requestId: string,
    claim: z.infer<typeof claimSchema>
  ) {
    const result = await this.client.transaction(async (transaction) => {
      await transaction.query(`SET LOCAL ROLE ${EXECUTION_DATABASE_ROLE}`);
      return transaction.query<{ readonly request_json: unknown }>(
        `SELECT load_outcome_private_valuation_dispatch_request_for_claim($1,$2,$3)
                AS request_json`,
        [requestId, claim.claimId, sha256(claim.leaseToken)]
      );
    });
    if (result.rows.length !== 1) {
      throw new TypeError('HPN preparation requires one exact retained dispatch request.');
    }
    const request = aflTradePrivateValuationDispatchRequestSchema.parse(
      result.rows[0]!.request_json
    );
    if (request.requestId !== requestId) {
      throw new TypeError('HPN preparation request differs from retained dispatch custody.');
    }
    return request;
  }

  private async captureLane(
    request: z.infer<typeof aflTradePrivateValuationDispatchRequestSchema>,
    claim: z.infer<typeof claimSchema>,
    lane: SourceLane
  ): Promise<AflTradePrivateValuationCaptureBinding> {
    const coordinator = createAflTradePrivateValuationRawDataCoordinator({
      captureBindings: new PostgresAflTradePrivateValuationCaptureBindingRepository(
        this.client
      ),
      sourceRole: lane.sourceRole,
      capture: async () =>
        this.dependencies.captureSource({
          requestId: request.requestId,
          claim,
          sourceRole: lane.sourceRole,
          capture: lane.authority.capture,
          fieldMap: lane.authority.fieldMap,
        }),
    });
    return (await coordinator.run({ request, claim })).binding;
  }

  private async loadEffectiveThrough(normalizationRunIds: readonly string[]): Promise<string> {
    const result = await this.client.query<{ readonly effective_through: Date | string | null }>(
      `SELECT max(capture.captured_at) AS effective_through
         FROM outcome_provider_normalization_run run
         JOIN outcome_source_capture capture ON capture.capture_id=run.capture_id
        WHERE run.normalization_run_id=ANY($1::text[])`,
      [normalizationRunIds]
    );
    const value = result.rows[0]?.effective_through;
    if (value === null || value === undefined) {
      throw new TypeError('HPN preparation could not establish its exact evidence cutoff.');
    }
    return new Date(value).toISOString();
  }

  private async renewClaim(claim: z.infer<typeof claimSchema>): Promise<void> {
    await new PostgresAflTradePrivateValuationScheduleRepository(this.client).heartbeat(claim);
  }

  async prepare(input: {
    readonly requestId: string;
    readonly claim: { readonly claimId: string; readonly leaseToken: string };
  }): Promise<AflTradePrivateValuationHpnPreparationResult> {
    const requestId = requestIdSchema.parse(input.requestId);
    const claim = claimSchema.parse(input.claim);
    const seasonYear = 2026;
    const methodId = methodIdSchema.parse(this.dependencies.methodId);
    const request = await this.loadRequest(requestId, claim);
    if (request.scopeKey !== SUPPORTED_VALUATION_SCOPE_KEY) {
      throw new TypeError(
        `HPN preparation supports only ${SUPPORTED_VALUATION_SCOPE_KEY}.`
      );
    }
    const factual = await this.dependencies.factualPreparation.prepare({ requestId, claim });
    if (
      factual.output.content.requestId !== requestId ||
      factual.output.content.valuationScopeKey !== request.scopeKey
    ) {
      throw new TypeError('HPN preparation received factual output from another dispatch scope.');
    }

    const lanes = sourceLanes(seasonYear);
    const bindings: AflTradePrivateValuationCaptureBinding[] = [];
    for (const lane of lanes) {
      const binding = await this.captureLane(request, claim, lane);
      requireExactLaneBinding(lane, binding, seasonYear);
      bindings.push(binding);
    }

    const fieldMapAuthority = new PostgresAflTradeHpnProjectedFieldMapAuthority(this.client);
    const sources = [];
    for (let index = 0; index < lanes.length; index += 1) {
      const lane = lanes[index]!;
      const binding = bindings[index]!;
      if (binding.content.schemaVersion !== 'afl-trade-private-valuation-capture-binding/v2') {
        throw new TypeError(`HPN source custody must use the role-aware binding contract.`);
      }
      await this.renewClaim(claim);
      const fieldMap = await fieldMapAuthority.loadCurrentForSource({
        provider: binding.content.sourcePlan.provider,
        capabilityId: binding.content.sourcePlan.capabilityId,
        inputKind: lane.inputKind,
        sourceSchemaSha256: lane.authority.fieldMap.sourceSchemaSha256,
        providerDecodeMapId: binding.content.sourcePlan.fieldMapId,
        seasonYear,
        rightsArtifactId: binding.content.sourcePlan.rightsArtifactId,
        valuationScopeKey: request.scopeKey,
      });
      if (fieldMap === null) {
        throw new TypeError(`No current reviewed HPN field map exists for ${lane.sourceRole}.`);
      }
      sources.push({
        normalizationRunId: binding.content.normalizationRunId,
        fieldMapId: fieldMap.fieldMapId,
        inputKind: lane.inputKind,
        role: lane.role,
      });
    }

    await this.renewClaim(claim);
    const inputSet = await new PostgresAflTradeHpnPavInputRepository(
      this.client
    ).buildAndPersistSeasonInputSet(
      {
        environment: 'non_production',
        competition: 'AFLM',
        seasonYear,
        methodId,
        factualRunId: factual.output.content.reconciliation.factualRunId,
        effectiveThrough: await this.loadEffectiveThrough(
          bindings.map(({ content }) => content.normalizationRunId)
        ),
        sources,
      },
      { environment: 'non_production' }
    );
    await this.renewClaim(claim);
    const calculation = await new PostgresAflTradeHpnPavCalculationRepository(
      this.client,
      this.dependencies.methodAuthority
    ).calculateAndPersist(
      {
        inputSetId: inputSet.inputSet.inputSetId,
        environment: 'non_production',
        competition: 'AFLM',
        seasonYear,
        methodId,
      },
      { environment: 'non_production' }
    );

    return {
      state:
        factual.state === 'already_prepared' &&
        inputSet.idempotentReplay &&
        calculation.idempotentReplay
          ? 'already_prepared'
          : 'prepared',
      requestId,
      factualOutputId: factual.output.outputId,
      inputSetId: inputSet.inputSet.inputSetId,
      calculationId: calculation.calculation.calculationId,
      captureBindingIds: bindings.map(({ bindingId }) => bindingId),
      publicationEligible: false,
    };
  }
}
