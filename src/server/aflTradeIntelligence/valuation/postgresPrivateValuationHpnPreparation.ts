import { createHash } from 'node:crypto';

import { z } from 'zod';

import {
  createLocalAflTradeAflTablesResultsAuthority,
  createLocalAflTradeFiveSeasonAflTablesAuthority,
} from '../development/localFiveSeasonAflTablesAuthority';
import { createLocalAflTradeOfficialAfl2026Authority } from '../development/localOfficialAfl2026Authority';
import type { AflTradeHpnPavMethodAuthority } from '../modeling/hpnPavCalculationService';
import { PostgresAflTradeHpnPavCalculationRepository } from '../modeling/postgresHpnPavCalculationRepository';
import {
  aflTradeHpnPavSeasonInputRequestSchema,
  type AflTradeHpnPavSeasonInputRequest,
} from '../modeling/hpnPavInputRepository';
import { PostgresAflTradeHpnPavInputRepository } from '../modeling/postgresHpnPavInputRepository';
import { PostgresAflTradeHpnProjectedFieldMapAuthority } from '../modeling/postgresHpnProjectedFieldMapAuthority';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '../outcomes/postgresOutcomeReleaseRepository';
import type { AflTradeFitzRoyCaptureCommand } from '../source/fitzRoyCaptureRuntime';
import type { AflTradeFitzRoyFieldMap } from '../source/fitzRoyObservationContracts';
import {
  type AflTradePrivateValuationCaptureBinding,
  type AflTradePrivateValuationCaptureSourceRole,
} from './privateValuationCaptureBinding';
import { createAflTradePrivateValuationRawDataCoordinator } from './privateValuationRawDataCoordinator';
import { aflTradePrivateValuationDispatchRequestSchema } from './privateValuationScheduling';
import type { AflTradePrivateValuationFactualPreparationResult } from './postgresPrivateValuationFactualPreparation';
import type { AflTradeAdmittedPlayerFactualPreparationResult } from './postgresAdmittedPlayerFactualPreparation';
import {
  findAflTradePrivateValuationHpnFactualBinding,
  loadAflTradePrivateValuationHpnFactualBinding,
} from './postgresPrivateValuationHpnFactualBinding';
import { PostgresAflTradePrivateValuationCaptureBindingRepository } from './postgresPrivateValuationCaptureBindingRepository';
import { PostgresAflTradePrivateValuationScheduleRepository } from './postgresPrivateValuationScheduling';
import { requireAflTradePrivateValuationHpnScopePolicy } from './privateValuationHpnScopePolicy';

const EXECUTION_DATABASE_ROLE = 'afl_trade_private_evaluation_coordinator';
const requestIdSchema = z.string().regex(/^private-valuation-dispatch:[a-f0-9]{64}$/u);
const claimSchema = z
  .object({
    claimId: z.string().regex(/^private-valuation-dispatch-claim:[a-f0-9]{64}$/u),
    leaseToken: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict();
const methodIdSchema = z.string().regex(/^hpn-pav-method:[a-f0-9]{64}$/u);

const retainedInputCustodySchema = z
  .object({
    requestId: requestIdSchema,
    factualOutputId: z.string().regex(/^private-valuation-factual-output:[a-f0-9]{64}$/u),
    factualRunId: aflTradeHpnPavSeasonInputRequestSchema.shape.factualRunId,
    knowledgePolicy: aflTradeHpnPavSeasonInputRequestSchema.shape.knowledgePolicy.unwrap(),
    knowledgeCutoffAt: aflTradeHpnPavSeasonInputRequestSchema.shape.knowledgeCutoffAt.unwrap(),
    reviewedNonparticipantDecisions:
      aflTradeHpnPavSeasonInputRequestSchema.shape.reviewedNonparticipantDecisions.unwrap(),
    sources: z
      .array(
        z
          .object({
            sourceRole: z.enum([
              'hpn_completed_results',
              'hpn_primary_player_stats',
              'hpn_corroborating_player_stats',
            ]),
            captureId: z.string().regex(/^source-capture:[a-f0-9]{64}$/u),
            normalizationRunId: z.string().regex(/^provider-normalization-run:[a-f0-9]{64}$/u),
          })
          .strict()
      )
      .length(3),
  })
  .strict()
  .superRefine((custody, context) => {
    if (
      new Set(custody.sources.map((s) => s.sourceRole)).size !== 3 ||
      new Set(custody.reviewedNonparticipantDecisions).size !==
        custody.reviewedNonparticipantDecisions.length
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Retained input custody requires distinct source roles and review decisions.',
      });
    }
  });

export type AflTradePrivateValuationRetainedInputCustody = z.infer<
  typeof retainedInputCustodySchema
>;

export type AflTradePrivateValuationHpnSourceAuthority = Readonly<{
  capture: AflTradeFitzRoyCaptureCommand;
  fieldMap: AflTradeFitzRoyFieldMap;
}>;

type SourceLane = Readonly<{
  sourceRole: Exclude<AflTradePrivateValuationCaptureSourceRole, 'factual_input'>;
  inputKind: 'completed_match_result' | 'player_match_stats';
  role: 'primary' | 'corroborating' | null;
  authority: AflTradePrivateValuationHpnSourceAuthority;
}>;

export type AflTradePrivateValuationHpnPreparationResult = Readonly<{
  state: 'prepared' | 'already_prepared';
  requestId: string;
  factualOutputId: string;
  inputSetId: string;
  calculationId: string;
  captureBindingIds: readonly string[];
  sourceAdmissionIds: readonly string[];
  publicationEligible: false;
}>;

export interface AflTradePrivateValuationHpnPreparationDependencies {
  readonly captureAuthority?: 'legacy' | 'source_first';
  readonly factualPreparation: {
    prepare(input: {
      readonly requestId: string;
      readonly claim: { readonly claimId: string; readonly leaseToken: string };
    }): Promise<
      | AflTradePrivateValuationFactualPreparationResult
      | AflTradeAdmittedPlayerFactualPreparationResult
    >;
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
  readonly resolveSourceAuthority?: (input: {
    readonly scopeKey: 'afl-men:2025-trades' | 'afl-men:2026-trades';
    readonly seasonYear: 2025 | 2026;
    readonly sourceRole: Exclude<AflTradePrivateValuationCaptureSourceRole, 'factual_input'>;
  }) => AflTradePrivateValuationHpnSourceAuthority;
}

function defaultSourceAuthority(input: {
  readonly seasonYear: 2025 | 2026;
  readonly sourceRole: Exclude<AflTradePrivateValuationCaptureSourceRole, 'factual_input'>;
}): AflTradePrivateValuationHpnSourceAuthority {
  if (input.sourceRole === 'hpn_completed_results') {
    return createLocalAflTradeAflTablesResultsAuthority(input.seasonYear);
  }
  if (input.sourceRole === 'hpn_primary_player_stats') {
    return createLocalAflTradeFiveSeasonAflTablesAuthority(input.seasonYear);
  }
  if (input.seasonYear === 2026) return createLocalAflTradeOfficialAfl2026Authority();
  throw new TypeError(
    'No exact reviewed corroborating player-stat authority is configured for afl-men:2025-trades.'
  );
}

function sourceLanes(
  scopeKey: 'afl-men:2025-trades' | 'afl-men:2026-trades',
  seasonYear: 2025 | 2026,
  resolveSourceAuthority: NonNullable<
    AflTradePrivateValuationHpnPreparationDependencies['resolveSourceAuthority']
  >
): readonly SourceLane[] {
  const authority = (
    sourceRole: Exclude<AflTradePrivateValuationCaptureSourceRole, 'factual_input'>
  ) => resolveSourceAuthority({ scopeKey, seasonYear, sourceRole });
  return [
    {
      sourceRole: 'hpn_completed_results',
      inputKind: 'completed_match_result',
      role: null,
      authority: authority('hpn_completed_results'),
    },
    {
      sourceRole: 'hpn_primary_player_stats',
      inputKind: 'player_match_stats',
      role: 'primary',
      authority: authority('hpn_primary_player_stats'),
    },
    {
      sourceRole: 'hpn_corroborating_player_stats',
      inputKind: 'player_match_stats',
      role: 'corroborating',
      authority: authority('hpn_corroborating_player_stats'),
    },
  ];
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function transactionClient(transaction: AflOutcomeSqlTransaction): AflOutcomeSqlClient {
  return {
    query: transaction.query.bind(transaction),
    transaction: async (work) => work(transaction),
  };
}

function requireExactLaneBinding(
  lane: SourceLane,
  binding: AflTradePrivateValuationCaptureBinding,
  seasonYear: number,
  captureAuthority: 'legacy' | 'source_first'
): void {
  const expectedVersion =
    captureAuthority === 'source_first'
      ? 'afl-trade-private-valuation-capture-binding/v3'
      : 'afl-trade-private-valuation-capture-binding/v2';
  if (
    binding.content.schemaVersion === 'afl-trade-private-valuation-capture-binding/v1' ||
    binding.content.schemaVersion !== expectedVersion
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
  private readonly captureAuthority: 'legacy' | 'source_first';

  constructor(
    private readonly client: AflOutcomeSqlClient,
    private readonly dependencies: AflTradePrivateValuationHpnPreparationDependencies
  ) {
    this.captureAuthority = z
      .enum(['legacy', 'source_first'])
      .parse(dependencies.captureAuthority ?? 'legacy');
  }

  private async loadRequest(requestId: string, claim: z.infer<typeof claimSchema>) {
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
      captureBindings: new PostgresAflTradePrivateValuationCaptureBindingRepository(this.client),
      captureAuthority: this.captureAuthority,
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

  private async renewClaimInTransaction(
    transaction: AflOutcomeSqlTransaction,
    claim: z.infer<typeof claimSchema>
  ): Promise<void> {
    await transaction.query(`SET LOCAL ROLE ${EXECUTION_DATABASE_ROLE}`);
    await transaction.query(`SELECT heartbeat_outcome_private_valuation_dispatch($1,$2)`, [
      claim.claimId,
      sha256(claim.leaseToken),
    ]);
    await transaction.query(`RESET ROLE`);
  }

  async prepare(input: {
    readonly requestId: string;
    readonly claim: { readonly claimId: string; readonly leaseToken: string };
    readonly retainedInputCustody?: AflTradePrivateValuationRetainedInputCustody;
  }): Promise<AflTradePrivateValuationHpnPreparationResult> {
    const requestId = requestIdSchema.parse(input.requestId);
    const claim = claimSchema.parse(input.claim);
    const custody =
      input.retainedInputCustody === undefined
        ? undefined
        : retainedInputCustodySchema.parse(input.retainedInputCustody);
    if (custody && (this.captureAuthority !== 'source_first' || custody.requestId !== requestId)) {
      throw new TypeError('Retained input custody requires the exact source-first request.');
    }
    const methodId = methodIdSchema.parse(this.dependencies.methodId);
    const request = await this.loadRequest(requestId, claim);
    const scope = requireAflTradePrivateValuationHpnScopePolicy(request.scopeKey);
    const { seasonYear } = scope;
    const factual = await this.dependencies.factualPreparation.prepare({ requestId, claim });
    if (
      factual.output.content.requestId !== requestId ||
      factual.output.content.valuationScopeKey !== request.scopeKey
    ) {
      throw new TypeError('HPN preparation received factual output from another dispatch scope.');
    }

    const loadFactualRun = async (transaction: AflOutcomeSqlTransaction) => {
      if (
        factual.output.content.schemaVersion === 'afl-trade-private-valuation-factual-output/v1'
      ) {
        await transaction.query(`SET LOCAL ROLE ${EXECUTION_DATABASE_ROLE}`);
        const binding = await findAflTradePrivateValuationHpnFactualBinding(transaction, {
          requestId,
          factualOutputId: factual.output.outputId,
        });
        await transaction.query('RESET ROLE');
        if (binding && 'authorityKind' in binding) return binding.hpnFactualRunId;
        return factual.output.content.reconciliation.factualRunId;
      }
      await transaction.query(`SET LOCAL ROLE ${EXECUTION_DATABASE_ROLE}`);
      const binding = await loadAflTradePrivateValuationHpnFactualBinding(transaction, {
        requestId,
        factualOutputId: factual.output.outputId,
      });
      await transaction.query('RESET ROLE');
      return binding.hpnFactualRunId;
    };
    const factualRunId = await this.client.transaction(loadFactualRun);
    if (
      custody &&
      (custody.factualOutputId !== factual.output.outputId || custody.factualRunId !== factualRunId)
    ) {
      throw new TypeError(
        'Retained input custody differs from authenticated factual output or run.'
      );
    }

    const lanes = sourceLanes(
      scope.scopeKey,
      seasonYear,
      this.dependencies.resolveSourceAuthority ?? defaultSourceAuthority
    );
    const bindings: AflTradePrivateValuationCaptureBinding[] = [];
    for (const lane of lanes) {
      const binding = await this.captureLane(request, claim, lane);
      requireExactLaneBinding(lane, binding, seasonYear, this.captureAuthority);
      bindings.push(binding);
    }
    if (
      custody &&
      bindings.some(
        (binding) =>
          !custody.sources.some(
            (source) =>
              'sourceRole' in binding.content &&
              source.sourceRole === binding.content.sourceRole &&
              source.captureId === binding.content.sourceCaptureId &&
              source.normalizationRunId === binding.content.normalizationRunId
          )
      )
    ) {
      throw new TypeError(
        'Retained input custody differs from the exact accepted source bindings.'
      );
    }

    const fieldMapAuthority = new PostgresAflTradeHpnProjectedFieldMapAuthority(this.client);
    const captureBindingRepository = new PostgresAflTradePrivateValuationCaptureBindingRepository(
      this.client
    );
    const sources: AflTradeHpnPavSeasonInputRequest['sources'] = [];
    const sourceAdmissions = [];
    for (let index = 0; index < lanes.length; index += 1) {
      const lane = lanes[index]!;
      const binding = bindings[index]!;
      const expectedVersion =
        this.captureAuthority === 'source_first'
          ? 'afl-trade-private-valuation-capture-binding/v3'
          : 'afl-trade-private-valuation-capture-binding/v2';
      if (
        binding.content.schemaVersion === 'afl-trade-private-valuation-capture-binding/v1' ||
        binding.content.schemaVersion !== expectedVersion
      ) {
        throw new TypeError(`HPN source custody must use the role-aware binding contract.`);
      }
      await this.renewClaim(claim);
      const fieldMap = await fieldMapAuthority.loadCurrentForSource({
        captureId: binding.content.sourceCaptureId,
        normalizationRunId: binding.content.normalizationRunId,
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
      const sourceAdmission = await captureBindingRepository.admitHpnSource({
        request,
        claim,
        factualOutputId: factual.output.outputId,
        binding,
        projectedFieldMapId: fieldMap.fieldMapId,
      });
      sourceAdmissions.push(sourceAdmission);
      sources.push({
        normalizationRunId: binding.content.normalizationRunId,
        fieldMapId: fieldMap.fieldMapId,
        inputKind: lane.inputKind,
        role: lane.role,
      });
    }

    const effectiveThrough = await this.loadEffectiveThrough(
      bindings.map(({ content }) => content.normalizationRunId)
    );
    const { inputSet, calculation } = await this.client.transaction(async (transaction) => {
      await this.renewClaimInTransaction(transaction, claim);
      if ((await loadFactualRun(transaction)) !== factualRunId) {
        throw new TypeError('HPN factual authority changed during preparation.');
      }
      const claimFencedClient = transactionClient(transaction);
      const inputSet = await new PostgresAflTradeHpnPavInputRepository(
        claimFencedClient
      ).buildAndPersistSeasonInputSet(
        aflTradeHpnPavSeasonInputRequestSchema.parse({
          environment: 'non_production',
          competition: 'AFLM',
          seasonYear,
          methodId,
          factualRunId,
          effectiveThrough,
          sources,
          ...(custody
            ? {
                knowledgePolicy: custody.knowledgePolicy,
                knowledgeCutoffAt: custody.knowledgeCutoffAt,
                reviewedNonparticipantDecisions: custody.reviewedNonparticipantDecisions,
              }
            : {}),
        }),
        { environment: 'non_production' }
      );
      const calculation = await new PostgresAflTradeHpnPavCalculationRepository(
        claimFencedClient,
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
      await this.renewClaimInTransaction(transaction, claim);
      return { inputSet, calculation };
    });

    return {
      state:
        factual.state === 'already_prepared' &&
        sourceAdmissions.every(({ state }) => state === 'already_admitted') &&
        inputSet.idempotentReplay &&
        calculation.idempotentReplay
          ? 'already_prepared'
          : 'prepared',
      requestId,
      factualOutputId: factual.output.outputId,
      inputSetId: inputSet.inputSet.inputSetId,
      calculationId: calculation.calculation.calculationId,
      captureBindingIds: bindings.map(({ bindingId }) => bindingId),
      sourceAdmissionIds: sourceAdmissions.map(({ admission }) => admission.admissionId),
      publicationEligible: false,
    };
  }
}
