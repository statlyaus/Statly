import { z } from 'zod';

import {
  aflTradeArtifactRefSchema,
  createAflTradeCanonicalJsonArtifactRef,
  doAflTradeArtifactRefsExactlyMatch,
  doesAflTradeArtifactRefMatchBytes,
  doesAflTradeArtifactRefMatchCanonicalJson,
  type AflTradeArtifactRef,
} from '../artifacts/artifactReference';
import {
  aflTradeContentAddressedIdSchema,
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import { aflTradeValuationInputBundleSchema } from '../artifacts/valuationInputBundle';
import {
  verifyAflTradeArtifactReadback,
  type AflTradeImmutableArtifactRepository,
} from '../artifacts/immutableArtifactRepository';
import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';
import { aflTradeQualifiedCurrentValuationModelEvidenceResultSchema } from './currentValuationModelEvidence';
import type { RetainedGovernedValuationComponentRun } from './internal/postgresGovernedValuationComponentRunRepository';
import { PostgresGovernedValuationComponentRunRepository } from './internal/postgresGovernedValuationComponentRunRepository';
import { hasExactAflTradeCurrentValuationFactualAuthority } from './postgresCurrentValuationModelEvidence';
import type { AflTradePrivateCurrentValuationInputBundleSelector } from './postgresCurrentValuationCohortPreparation';
import { createAflTradeValuationInputBundleCandidate } from './valuationInputBundleCandidate';
import { parseAflTradeValuationInputBundleConstructionSpecification } from './valuationInputBundleConstructionSpecification';

type ComponentRunLoader = Readonly<{
  loadExact(runId: string): Promise<RetainedGovernedValuationComponentRun>;
}>;
type CurrentModelEvidenceLoader = Readonly<{
  loadCurrent(input: {
    readonly operationId: string;
    readonly scopeKey: string;
  }): Promise<{ readonly evidence: unknown; readonly constructedAt: string }>;
}>;
const EXECUTION_DATABASE_ROLE = 'afl_trade_private_evaluation_coordinator';
const retainedResultSchema = z
  .object({
    operationId: z.string().trim().min(1),
    specificationId: z.string().trim().min(1),
    specificationArtifact: aflTradeArtifactRefSchema,
    valuationInputBundleId: z.string().trim().min(1),
    valuationInputBundle: aflTradeValuationInputBundleSchema,
    valuationInputBundleArtifact: aflTradeArtifactRefSchema,
  })
  .strict();

export function createPostgresAflTradeRetainedValuationInputBundleSelector(configuration: {
  readonly specificationId: string;
  readonly specificationArtifact: AflTradeArtifactRef;
}): AflTradePrivateCurrentValuationInputBundleSelector {
  const selected = z.object({
    specificationId: aflTradeContentAddressedIdSchema(
      'valuation-input-bundle-construction-specification'
    ),
    specificationArtifact: aflTradeArtifactRefSchema,
  }).strict().parse(configuration);

  return async ({ transaction, modelEvidence }) => {
    const retained = await transaction.query<{ readonly valuation_input_bundle_id: string }>(
      `SELECT valuation_input_bundle_id
         FROM outcome_valuation_input_bundle_construction_operation
        WHERE scope_key=$1 AND model_evidence_operation_id=$2 AND specification_id=$3
          AND specification_artifact_json=$4::jsonb AND factual_revision=$5
          AND model_revision=$6 AND player_run_id=$7 AND pick_run_id=$8`,
      [
        modelEvidence.scopeKey,
        modelEvidence.operationId,
        selected.specificationId,
        canonicalizeAflTradeJson(selected.specificationArtifact),
        modelEvidence.privateFactualAuthority.revision,
        modelEvidence.modelRevision,
        modelEvidence.playerRunId,
        modelEvidence.pickRunId,
      ]
    );
    if (retained.rows.length !== 1) {
      throw new TypeError('Exact retained valuation input bundle is unavailable.');
    }
    return aflTradeContentAddressedIdSchema('valuation-input-bundle').parse(
      retained.rows[0]!.valuation_input_bundle_id
    );
  };
}

async function loadCanonicalJson(input: {
  readonly repository: AflTradeImmutableArtifactRepository;
  readonly reference: AflTradeArtifactRef;
  readonly maximumBytes: number;
}): Promise<unknown> {
  const retained = await input.repository.loadExact(input.reference, input.maximumBytes);
  if (
    retained === null ||
    !doAflTradeArtifactRefsExactlyMatch(retained.reference, input.reference) ||
    !doesAflTradeArtifactRefMatchBytes(retained.reference, retained.bytes, 'application/json')
  ) {
    throw new TypeError('Bundle construction specification failed exact byte authentication.');
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(retained.bytes));
  } catch {
    throw new TypeError('Bundle construction specification is not valid JSON.');
  }
  if (!doesAflTradeArtifactRefMatchCanonicalJson(input.reference, value)) {
    throw new TypeError('Bundle construction specification is not canonical JSON.');
  }
  return value;
}

export function createAflTradeRetainedValuationInputBundleConstructor(dependencies: {
  readonly artifactRepository: AflTradeImmutableArtifactRepository;
  readonly maximumArtifactBytes: number;
  readonly componentRuns: ComponentRunLoader;
  readonly modelEvidence: CurrentModelEvidenceLoader;
}) {
  if (
    dependencies.artifactRepository.artifactClass !== 'derived_private' ||
    !Number.isSafeInteger(dependencies.maximumArtifactBytes) ||
    dependencies.maximumArtifactBytes <= 0
  ) {
    throw new TypeError('Retained bundle construction requires bounded private artifact custody.');
  }

  return async function construct(input: {
    readonly modelEvidenceOperationId: string;
    readonly scopeKey: string;
    readonly specificationArtifact: AflTradeArtifactRef;
  }) {
    const current = await dependencies.modelEvidence.loadCurrent({
      operationId: input.modelEvidenceOperationId,
      scopeKey: input.scopeKey,
    });
    const modelEvidence = aflTradeQualifiedCurrentValuationModelEvidenceResultSchema.parse(
      current.evidence
    );
    const specification = parseAflTradeValuationInputBundleConstructionSpecification(
      await loadCanonicalJson({
        repository: dependencies.artifactRepository,
        reference: input.specificationArtifact,
        maximumBytes: dependencies.maximumArtifactBytes,
      })
    );
    if (
      input.specificationArtifact.createdAt !== specification.content.createdAt ||
      specification.content.scopeKey !== modelEvidence.scopeKey ||
      modelEvidence.scopeKey !== input.scopeKey ||
      Date.parse(current.constructedAt) < Date.parse(specification.content.createdAt)
    ) {
      throw new TypeError(
        'Retained bundle construction specification does not match current model authority.'
      );
    }

    for (const policyArtifact of Object.values(specification.content.policies)) {
      await verifyAflTradeArtifactReadback(
        dependencies.artifactRepository,
        policyArtifact,
        specification.content.createdAt,
        dependencies.maximumArtifactBytes
      );
    }

    const [playerRun, pickRun] = await Promise.all([
      dependencies.componentRuns.loadExact(modelEvidence.playerRunId),
      dependencies.componentRuns.loadExact(modelEvidence.pickRunId),
    ]);
    const configuration = specification.content;
    const valuationInputBundle = createAflTradeValuationInputBundleCandidate({
      modelEvidence,
      playerRun: playerRun.manifest,
      pickRun: pickRun.manifest,
      valueUnitId: configuration.valueUnitId,
      createdAt: current.constructedAt,
      currentView: configuration.currentView,
      policies: configuration.policies,
      simulation: {
        draws: configuration.simulation.draws,
        seed: configuration.simulation.seed,
      },
    });
    const valuationInputBundleArtifact = createAflTradeCanonicalJsonArtifactRef(
      valuationInputBundle,
      current.constructedAt
    );
    const bytes = new TextEncoder().encode(canonicalizeAflTradeJson(valuationInputBundle));
    await dependencies.artifactRepository.putIfAbsent(valuationInputBundleArtifact, bytes);
    await verifyAflTradeArtifactReadback(
      dependencies.artifactRepository,
      valuationInputBundleArtifact,
      current.constructedAt,
      dependencies.maximumArtifactBytes
    );

    return {
      specificationId: specification.specificationId,
      specificationArtifact: input.specificationArtifact,
      valuationInputBundleId: valuationInputBundle.valuationInputBundleId,
      valuationInputBundle,
      valuationInputBundleArtifact,
    } as const;
  };
}

export function createPostgresAflTradeRetainedValuationInputBundleConstructor(dependencies: {
  readonly client: AflOutcomeSqlClient;
  readonly artifactRepository: AflTradeImmutableArtifactRepository;
  readonly maximumArtifactBytes: number;
}) {
  return async function construct(input: {
    readonly modelEvidenceOperationId: string;
    readonly scopeKey: string;
    readonly specificationArtifact: AflTradeArtifactRef;
  }) {
    return dependencies.client.transaction(async (transaction) => {
      await transaction.query(`SET LOCAL ROLE ${EXECUTION_DATABASE_ROLE}`);
      const evidenceRows = await transaction.query<{ readonly result_json: unknown }>(
        `SELECT result_json FROM outcome_current_valuation_model_evidence_operation
          WHERE operation_id=$1 AND scope_key=$2`,
        [input.modelEvidenceOperationId, input.scopeKey]
      );
      if (evidenceRows.rows.length !== 1) {
        throw new TypeError('Exact retained current model evidence is unavailable.');
      }
      const evidence = aflTradeQualifiedCurrentValuationModelEvidenceResultSchema.parse(
        evidenceRows.rows[0]!.result_json
      );
      const specification = parseAflTradeValuationInputBundleConstructionSpecification(
        await loadCanonicalJson({
          repository: dependencies.artifactRepository,
          reference: input.specificationArtifact,
          maximumBytes: dependencies.maximumArtifactBytes,
        })
      );
      const operationId = createAflTradeContentAddress(
        'valuation-input-bundle-construction-operation',
        {
          scopeKey: input.scopeKey,
          modelEvidenceOperationId: input.modelEvidenceOperationId,
          specificationId: specification.specificationId,
        }
      );
      await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
        `valuation-input-bundle-construction:${operationId}`,
      ]);
      const current = await transaction.query<{ readonly qualification_id: string }>(
        `SELECT qualification_id FROM outcome_current_governed_valuation_model_pair
          WHERE scope_key=$1 AND revision=$2 AND player_run_id=$3 AND pick_run_id=$4
            AND player_gate3_decision_id=$5 AND pick_gate3_decision_id=$6 AND work_id=$7
          FOR SHARE`,
        [
          input.scopeKey,
          evidence.modelRevision,
          evidence.playerRunId,
          evidence.pickRunId,
          evidence.playerGate3DecisionId,
          evidence.pickGate3DecisionId,
          evidence.qualificationWorkId,
        ]
      );
      await transaction.query(
        `SELECT revision FROM outcome_current_private_factual_authority
          WHERE valuation_scope_key=$1 FOR SHARE`,
        [input.scopeKey]
      );
      if (
        evidence.operationId !== input.modelEvidenceOperationId ||
        current.rows[0]?.qualification_id !== evidence.qualificationId ||
        !(await hasExactAflTradeCurrentValuationFactualAuthority(transaction, evidence))
      ) {
        throw new TypeError('Retained model evidence is not the exact current authority.');
      }
      const existing = await transaction.query<{
        readonly scope_key: string;
        readonly model_evidence_operation_id: string;
        readonly specification_id: string;
        readonly specification_json: unknown;
        readonly specification_artifact_json: unknown;
        readonly factual_revision: number;
        readonly model_revision: number;
        readonly player_run_id: string;
        readonly pick_run_id: string;
        readonly constructed_at: Date | string;
        readonly valuation_input_bundle_id: string;
        readonly valuation_input_bundle_json: unknown;
        readonly valuation_input_bundle_artifact_json: unknown;
        readonly result_json: unknown;
      }>(
        `SELECT scope_key,model_evidence_operation_id,specification_id,specification_json,
                specification_artifact_json,factual_revision,model_revision,player_run_id,
                pick_run_id,constructed_at,valuation_input_bundle_id,
                valuation_input_bundle_json,valuation_input_bundle_artifact_json,result_json
           FROM outcome_valuation_input_bundle_construction_operation
          WHERE operation_id=$1`,
        [operationId]
      );
      if (existing.rows.length === 1) {
        const row = existing.rows[0]!;
        const replay = retainedResultSchema.parse(row.result_json);
        const expectedArtifact = createAflTradeCanonicalJsonArtifactRef(
          replay.valuationInputBundle,
          replay.valuationInputBundle.content.createdAt
        );
        if (
          replay.operationId !== operationId ||
          row.scope_key !== input.scopeKey ||
          row.model_evidence_operation_id !== input.modelEvidenceOperationId ||
          row.specification_id !== specification.specificationId ||
          canonicalizeAflTradeJson(row.specification_json) !==
            canonicalizeAflTradeJson(specification) ||
          canonicalizeAflTradeJson(row.specification_artifact_json) !==
            canonicalizeAflTradeJson(replay.specificationArtifact) ||
          row.factual_revision !== evidence.privateFactualAuthority.revision ||
          row.model_revision !== evidence.modelRevision ||
          row.player_run_id !== evidence.playerRunId ||
          row.pick_run_id !== evidence.pickRunId ||
          new Date(row.constructed_at).toISOString() !==
            replay.valuationInputBundle.content.createdAt ||
          row.valuation_input_bundle_id !== replay.valuationInputBundleId ||
          canonicalizeAflTradeJson(row.valuation_input_bundle_json) !==
            canonicalizeAflTradeJson(replay.valuationInputBundle) ||
          canonicalizeAflTradeJson(row.valuation_input_bundle_artifact_json) !==
            canonicalizeAflTradeJson(replay.valuationInputBundleArtifact) ||
          !doAflTradeArtifactRefsExactlyMatch(
            expectedArtifact,
            replay.valuationInputBundleArtifact
          ) ||
          !doAflTradeArtifactRefsExactlyMatch(
            replay.specificationArtifact,
            input.specificationArtifact
          )
        ) {
          throw new TypeError('Retained bundle construction replay conflicts with exact input.');
        }
        await verifyAflTradeArtifactReadback(
          dependencies.artifactRepository,
          replay.valuationInputBundleArtifact,
          replay.valuationInputBundle.content.createdAt,
          dependencies.maximumArtifactBytes
        );
        return replay;
      }
      const trusted = await transaction.query<{ readonly constructed_at: Date | string }>(
        `SELECT date_trunc('milliseconds',transaction_timestamp()) AS constructed_at`
      );
      const constructedAt = new Date(trusted.rows[0]!.constructed_at).toISOString();
      const transactionClient: AflOutcomeSqlClient = {
        query: transaction.query.bind(transaction),
        transaction: async (work) => work(transaction),
      };
      const constructRetained = createAflTradeRetainedValuationInputBundleConstructor({
        artifactRepository: dependencies.artifactRepository,
        maximumArtifactBytes: dependencies.maximumArtifactBytes,
        componentRuns: new PostgresGovernedValuationComponentRunRepository({
          ...dependencies,
          client: transactionClient,
        }),
        modelEvidence: {
          loadCurrent: async () => ({ evidence, constructedAt }),
        },
      });
      const constructed = await constructRetained(input);
      const result = retainedResultSchema.parse({ operationId, ...constructed });
      await transaction.query(
        `INSERT INTO outcome_valuation_input_bundle_construction_operation
          (operation_id,scope_key,model_evidence_operation_id,specification_id,
           specification_json,specification_artifact_json,factual_revision,model_revision,player_run_id,pick_run_id,
           constructed_at,valuation_input_bundle_id,valuation_input_bundle_json,
           valuation_input_bundle_artifact_json,result_json)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,$15::jsonb)`,
        [
          operationId,
          input.scopeKey,
          input.modelEvidenceOperationId,
          specification.specificationId,
          canonicalizeAflTradeJson(specification),
          canonicalizeAflTradeJson(input.specificationArtifact),
          evidence.privateFactualAuthority.revision,
          evidence.modelRevision,
          evidence.playerRunId,
          evidence.pickRunId,
          constructedAt,
          result.valuationInputBundleId,
          canonicalizeAflTradeJson(result.valuationInputBundle),
          canonicalizeAflTradeJson(result.valuationInputBundleArtifact),
          canonicalizeAflTradeJson(result),
        ]
      );
      return result;
    });
  };
}
