import { TextEncoder } from 'node:util';

import { z } from 'zod';

import {
  aflTradeArtifactRefSchema,
  createAflTradeCanonicalJsonArtifactRef,
  type AflTradeArtifactRef,
} from '../artifacts/artifactReference';
import { canonicalizeAflTradeJson } from '../artifacts/contentAddress';
import { createPostgresAflTradeGateDecisionLedgerRepository } from '../governance/postgresGateDecisionLedgerRepository';
import { createPgAflOutcomeSqlClient, type AflOutcomePgPool } from '../outcomes/pgOutcomeSqlClient';
import { createPostgresGovernedPrivateEvaluationStagingRepository } from '../valuation/internal/postgresGovernedPrivateEvaluationStagingRepository';
import { PostgresGovernedValuationComponentRunRepository } from '../valuation/internal/postgresGovernedValuationComponentRunRepository';
import { createPostgresAflTradePrivateCurrentValuationCohortCoordinator } from '../valuation/postgresCurrentValuationCohortPreparation';
import { createPostgresGenuineDispatchBoundPickPavExecutor } from '../valuation/postgresGenuineDispatchBoundPickPav';
import {
  PostgresAflTradePrivateValuationHpnPreparation,
  resolveAflTradePrivateValuationHpnSourceAuthority,
  type AflTradePrivateValuationHpnPreparationDependencies,
} from '../valuation/postgresPrivateValuationHpnPreparation';
import { requireAflTradePrivateValuationHpnScopePolicy } from '../valuation/privateValuationHpnScopePolicy';
import { createPostgresAflTradeRetainedValuationInputBundleSelector } from '../valuation/retainedValuationInputBundleConstruction';
import { createLocalAflTradePrivateDerivedArtifactRepository } from './localFileConditionalObjectStore';
import { createLocalAflTradeGenuineAdmittedPlayerExecutor } from './localGenuineAdmittedPlayerContribution';
import { createLocalAflTradePrivateValuationConstructionEvidence } from './localPrivateValuationConstructionEvidence';
import {
  createLocalPrivateValuationConstructionBlocker,
  createLocalPrivateValuationConstructionReport,
  safeLocalPrivateValuationConstructionReason,
  type LocalPrivateValuationConstructionBlocker,
  type LocalPrivateValuationConstructionReport,
} from './localPrivateValuationConstructionReport';
import { createLocalAflTradePrivateValuationQualificationRegistrar } from './localPrivateValuationQualification';
import type { AflTradeLocalPrivateValuationConstruction } from './localPrivateValuationRuntime';

const DEFAULT_MAXIMUM_ARTIFACT_BYTES = 4 * 1024 * 1024;
const SOURCE_ROLES = [
  'hpn_completed_results',
  'hpn_primary_player_stats',
  'hpn_corroborating_player_stats',
] as const;

export type LocalPrivateValuationConstructionModelTargets = Readonly<{
  player: Readonly<{
    modelId: string;
    modelVersion: string;
    protocolId: string;
    datasetId: string;
    datasetAdmissionId: string;
  }>;
  pick: Readonly<{
    protocolId: string;
    datasetId: string;
    datasetAdmissionId: string;
    policyId: string;
  }>;
  qualificationPolicyId: string;
}>;

export type AflTradeLocalPrivateValuationTradeConstructor = NonNullable<
  Parameters<
    typeof createPostgresAflTradePrivateCurrentValuationCohortCoordinator
  >[0]['constructTrade']
>;

export class AflTradeLocalPrivateValuationConstructionSelectionError extends TypeError {
  readonly code = 'CONSTRUCTION_SELECTION_INVALID';
}

export type LocalPrivateValuationConstructionSelection = Readonly<{
  readonly qualificationPolicyArtifactId: string;
  readonly modelSeed: number;
  readonly modelTargets: LocalPrivateValuationConstructionModelTargets;
  readonly valuationInputBundleConstructionSpecificationId: string;
  readonly valuationInputBundleConstructionSpecificationArtifact: AflTradeArtifactRef;
  readonly constructionSpecificationArtifact: AflTradeArtifactRef;
  readonly calculationInputPackage: AflTradeArtifactRef;
  readonly constructionPolicy: AflTradeArtifactRef;
  readonly constructionRuns: Readonly<{ player: string; pick: string }>;
}>;

/** Declared, still possibly incomplete: the root reports each field the scope has not supplied. */
export type LocalPrivateValuationConstructionSelectionDeclaration = Readonly<{
  [Field in keyof LocalPrivateValuationConstructionSelection]?:
    LocalPrivateValuationConstructionSelection[Field] | undefined;
}>;

export const LOCAL_PRIVATE_VALUATION_CONSTRUCTION_SELECTION_FIELDS = [
  'qualificationPolicyArtifactId',
  'modelSeed',
  'modelTargets',
  'valuationInputBundleConstructionSpecificationId',
  'valuationInputBundleConstructionSpecificationArtifact',
  'constructionSpecificationArtifact',
  'calculationInputPackage',
  'constructionPolicy',
  'constructionRuns',
] as const satisfies readonly (keyof LocalPrivateValuationConstructionSelection)[];

export interface LocalPrivateValuationConstructionAuthority {
  /** Reviewed HPN source, factual, method and capture dependencies for the declared scope. */
  readonly hpnPreparation: AflTradePrivateValuationHpnPreparationDependencies;
  /** No genuine per-trade assembly owner exists yet, so it stays an explicit declaration. */
  readonly constructTrade?: AflTradeLocalPrivateValuationTradeConstructor;
}

export interface LocalPrivateValuationConstructionInput {
  readonly pool: AflOutcomePgPool;
  readonly artifactRoot: string;
  readonly maximumArtifactBytes?: number;
  readonly scopeKey?: string;
  readonly selection?: LocalPrivateValuationConstructionSelectionDeclaration;
  readonly authority?: Partial<LocalPrivateValuationConstructionAuthority>;
}

export type LocalPrivateValuationConstructionComposition =
  | Readonly<{
      state: 'composable';
      report: LocalPrivateValuationConstructionReport;
      construction: AflTradeLocalPrivateValuationConstruction;
    }>
  | Readonly<{
      state: 'blocked';
      report: LocalPrivateValuationConstructionReport;
      blockers: readonly LocalPrivateValuationConstructionBlocker[];
      blockerCodes: readonly string[];
    }>;

function declaration(input: {
  readonly code: string;
  readonly field: string;
  readonly reason: string;
}): LocalPrivateValuationConstructionBlocker {
  return createLocalPrivateValuationConstructionBlocker({
    code: input.code,
    subject: { kind: 'declaration', id: input.field },
    reason: input.reason,
  });
}

/**
 * Which reviewed source lanes this scope can actually resolve. Uses the runtime's own routing rule,
 * so a lane that fails here fails the same way when the HPN preparation runs.
 */
function sourceAuthorityBlockers(
  seasonYear: 2025 | 2026
): readonly LocalPrivateValuationConstructionBlocker[] {
  const blockers: LocalPrivateValuationConstructionBlocker[] = [];
  for (const sourceRole of SOURCE_ROLES) {
    try {
      resolveAflTradePrivateValuationHpnSourceAuthority({ seasonYear, sourceRole });
    } catch (error) {
      blockers.push(
        createLocalPrivateValuationConstructionBlocker({
          code: 'hpn_source_authority_missing',
          subject: { kind: 'source_role', id: sourceRole },
          reason: safeLocalPrivateValuationConstructionReason(error),
        })
      );
    }
  }
  return blockers;
}

export const localPrivateValuationConstructionSelectionSchema = z
  .object({
    qualificationPolicyArtifactId: z.string().min(1),
    modelSeed: z.number().int().nonnegative(),
    modelTargets: z.object({
      player: z
        .object({
          modelId: z.string().min(1),
          modelVersion: z.string().min(1),
          protocolId: z.string().min(1),
          datasetId: z.string().min(1),
          datasetAdmissionId: z.string().min(1),
        })
        .strict(),
      pick: z
        .object({
          protocolId: z.string().min(1),
          datasetId: z.string().min(1),
          datasetAdmissionId: z.string().min(1),
          policyId: z.string().min(1),
        })
        .strict(),
      qualificationPolicyId: z.string().min(1),
    }),
    valuationInputBundleConstructionSpecificationId: z.string().min(1),
    valuationInputBundleConstructionSpecificationArtifact: aflTradeArtifactRefSchema,
    constructionSpecificationArtifact: aflTradeArtifactRefSchema,
    calculationInputPackage: aflTradeArtifactRefSchema,
    constructionPolicy: aflTradeArtifactRefSchema,
    constructionRuns: z.object({ player: z.string().min(1), pick: z.string().min(1) }).strict(),
  })
  .strict();

function selectionBlockers(
  selection: LocalPrivateValuationConstructionSelectionDeclaration | undefined
): readonly LocalPrivateValuationConstructionBlocker[] {
  if (selection === undefined) {
    return [
      declaration({
        code: 'construction_selection_not_supplied',
        field: 'selection',
        reason: 'No reviewed construction selection was declared for this scope.',
      }),
    ];
  }
  const missing = LOCAL_PRIVATE_VALUATION_CONSTRUCTION_SELECTION_FIELDS.filter(
    (field) => selection[field] === undefined || selection[field] === null
  ).map((field) =>
    declaration({
      code: 'construction_selection_field_missing',
      field,
      reason: `The declared construction selection omits ${field}.`,
    })
  );
  if (missing.length > 0) return missing;
  const parsed = localPrivateValuationConstructionSelectionSchema.safeParse(selection);
  if (!parsed.success) {
    throw new AflTradeLocalPrivateValuationConstructionSelectionError(
      `The declared construction selection is malformed: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.')} ${issue.message}`)
        .join('; ')}.`
    );
  }
  return [];
}

function authorityBlockers(
  authority: Partial<LocalPrivateValuationConstructionAuthority> | undefined
): readonly LocalPrivateValuationConstructionBlocker[] {
  const blockers: LocalPrivateValuationConstructionBlocker[] = [];
  if (authority?.hpnPreparation === undefined) {
    blockers.push(
      declaration({
        code: 'hpn_preparation_authority_not_declared',
        field: 'authority.hpnPreparation',
        reason:
          'No reviewed HPN source, factual, method and capture authority was declared for this scope.',
      })
    );
  }
  if (authority?.constructTrade === undefined) {
    blockers.push(
      createLocalPrivateValuationConstructionBlocker({
        code: 'cohort_trade_construction_owner_missing',
        subject: { kind: 'owner', id: 'private-cohort-trade-construction' },
        reason:
          'No genuine evidence-derived per-trade valuation-input assembly owner exists yet, so the private cohort cannot construct a trade.',
      })
    );
  }
  return blockers;
}

function scopeBlockers(scopeKey: string): readonly LocalPrivateValuationConstructionBlocker[] {
  try {
    requireAflTradePrivateValuationHpnScopePolicy(scopeKey);
    return [];
  } catch (error) {
    return [
      createLocalPrivateValuationConstructionBlocker({
        code: 'construction_scope_unsupported',
        subject: { kind: 'scope', id: scopeKey },
        reason: safeLocalPrivateValuationConstructionReason(error),
      }),
    ];
  }
}

/**
 * Whether the references a declared selection names are actually retained. No other owner checks the
 * bundle-construction specification, construction specification, construction policy or calculation
 * input package before use, so the root checks them together instead of letting a declared-but-absent
 * artifact fail deep inside an adapter. Only declared references are read.
 */
async function retentionBlockers(
  pool: AflOutcomePgPool,
  selection: LocalPrivateValuationConstructionSelectionDeclaration | undefined
): Promise<readonly LocalPrivateValuationConstructionBlocker[]> {
  if (
    selection === undefined ||
    LOCAL_PRIVATE_VALUATION_CONSTRUCTION_SELECTION_FIELDS.some(
      (field) => selection[field] === undefined || selection[field] === null
    )
  ) {
    return [];
  }
  const declared = [
    'valuationInputBundleConstructionSpecificationArtifact',
    'constructionSpecificationArtifact',
    'calculationInputPackage',
    'constructionPolicy',
  ].map((field) => ({
    artifactId: aflTradeArtifactRefSchema.parse(
      selection[field as keyof LocalPrivateValuationConstructionSelection]
    ).artifactId,
    field,
  }));
  const retained = await pool.query(
    `SELECT artifact_id FROM outcome_artifact_custody WHERE artifact_id = ANY($1::text[])`,
    [declared.map(({ artifactId }) => artifactId)]
  );
  const present = new Set(
    retained.rows.map((row) => (row as { readonly artifact_id: string }).artifact_id)
  );
  return declared
    .filter(({ artifactId }) => !present.has(artifactId))
    .map(({ artifactId, field }) =>
      declaration({
        code: 'construction_artifact_not_retained',
        field: artifactId,
        reason: `The declared construction selection field ${field} is not retained in private artifact custody.`,
      })
    );
}

function blockersFor(
  input: LocalPrivateValuationConstructionInput & { readonly scopeKey: string }
): readonly LocalPrivateValuationConstructionBlocker[] {
  const policy = requireAflTradePrivateValuationHpnScopePolicy(input.scopeKey);
  return [
    ...scopeBlockers(input.scopeKey),
    // The local construction-evidence owner is configured for one exact 2025 dispatch and claim.
    ...(policy.scopeKey === 'afl-men:2025-trades'
      ? []
      : [
          declaration({
            code: 'cohort_construction_evidence_scope_unsupported',
            field: policy.scopeKey,
            reason:
              'The local private construction-evidence owner is configured for afl-men:2025-trades only.',
          }),
        ]),
    ...sourceAuthorityBlockers(policy.seasonYear),
    ...selectionBlockers(input.selection),
    ...authorityBlockers(input.authority),
  ];
}

/**
 * Reports whether a declared scope can compose the local private valuation chain, and names every
 * authority it is missing. Read-only: it resolves the reviewed source lanes, reads the declaration,
 * and writes nothing. A report can never grant qualification.
 */
export async function inspectLocalAflTradePrivateValuationConstruction(
  input: LocalPrivateValuationConstructionInput
): Promise<LocalPrivateValuationConstructionReport> {
  const scopeKey = input.scopeKey ?? 'afl-men:2025-trades';
  return createLocalPrivateValuationConstructionReport({
    scopeKey,
    blockers: [
      ...blockersFor({ ...input, scopeKey }),
      ...(await retentionBlockers(input.pool, input.selection)),
    ],
  });
}

/**
 * Composes the model-pair and cohort halves for a declared scope, or reports why it cannot. It never
 * substitutes fixture or synthetic authority for a reviewed declaration, and it never claims the
 * chain is complete while any authority is missing.
 */
export async function composeLocalAflTradePrivateValuationConstruction(
  input: LocalPrivateValuationConstructionInput
): Promise<LocalPrivateValuationConstructionComposition> {
  const report = await inspectLocalAflTradePrivateValuationConstruction(input);
  if (report.state === 'blocked') {
    return {
      state: 'blocked',
      report,
      blockers: report.blockers,
      blockerCodes: report.blockerCodes,
    };
  }
  const selection = localPrivateValuationConstructionSelectionSchema.parse(
    input.selection
  ) as unknown as LocalPrivateValuationConstructionSelection;
  const authority = input.authority as LocalPrivateValuationConstructionAuthority;
  const constructTrade = authority.constructTrade;
  if (constructTrade === undefined) {
    throw new AflTradeLocalPrivateValuationConstructionSelectionError(
      'A composable report requires a declared per-trade construction owner.'
    );
  }
  return {
    state: 'composable',
    report,
    construction: createConstruction({
      pool: input.pool,
      artifactRoot: input.artifactRoot,
      maximumArtifactBytes: input.maximumArtifactBytes ?? DEFAULT_MAXIMUM_ARTIFACT_BYTES,
      selection,
      hpnPreparation: authority.hpnPreparation,
      constructTrade,
    }),
  };
}

/**
 * Builds both halves from owners that already exist. It composes; it does not reimplement HPN
 * preparation, cohort binding or prepared-v3 storage, and it invents no authority of its own.
 */
function createConstruction(input: {
  readonly pool: AflOutcomePgPool;
  readonly artifactRoot: string;
  readonly maximumArtifactBytes: number;
  readonly selection: LocalPrivateValuationConstructionSelection;
  readonly hpnPreparation: AflTradePrivateValuationHpnPreparationDependencies;
  readonly constructTrade: AflTradeLocalPrivateValuationTradeConstructor;
}): AflTradeLocalPrivateValuationConstruction {
  const client = createPgAflOutcomeSqlClient(input.pool);
  const artifacts = createLocalAflTradePrivateDerivedArtifactRepository({
    rootDirectory: input.artifactRoot,
    repositoryId: 'governed-private-evaluation',
    maximumObjectBytes: input.maximumArtifactBytes,
  });
  const staging = createPostgresGovernedPrivateEvaluationStagingRepository({
    client,
    artifactRepository: artifacts,
    maximumArtifactBytes: input.maximumArtifactBytes,
  });
  const clock = { now: () => new Date().toISOString() };
  const selectValuationInputBundleId = createPostgresAflTradeRetainedValuationInputBundleSelector({
    specificationId: input.selection.valuationInputBundleConstructionSpecificationId,
    specificationArtifact: input.selection.valuationInputBundleConstructionSpecificationArtifact,
  });
  return {
    modelPair: {
      hpnPreparation: {
        prepare: (value) =>
          new PostgresAflTradePrivateValuationHpnPreparation(client, input.hpnPreparation).prepare(
            value
          ),
      },
      targets: input.selection.modelTargets,
      playerExecutor: createLocalAflTradeGenuineAdmittedPlayerExecutor({
        sql: client,
        artifactRepository: artifacts,
        maximumArtifactBytes: input.maximumArtifactBytes,
        gateDecisionLedgerRepository: createPostgresAflTradeGateDecisionLedgerRepository(client),
        componentRepository: new PostgresGovernedValuationComponentRunRepository({
          client,
          artifactRepository: artifacts,
          maximumArtifactBytes: input.maximumArtifactBytes,
        }),
        seed: input.selection.modelSeed,
      }),
      pickExecutor: createPostgresGenuineDispatchBoundPickPavExecutor({
        client,
        artifactRepository: artifacts,
        maximumArtifactBytes: input.maximumArtifactBytes,
        retainArtifact: ({ document, createdAt }) =>
          staging.retainArtifact({
            reference: createAflTradeCanonicalJsonArtifactRef(document, createdAt),
            bytes: new TextEncoder().encode(canonicalizeAflTradeJson(document)),
          }),
        clock,
      }),
      qualificationRegistrar: createLocalAflTradePrivateValuationQualificationRegistrar({
        client,
        artifactRepository: artifacts,
        maximumArtifactBytes: input.maximumArtifactBytes,
        policyArtifactId: input.selection.qualificationPolicyArtifactId,
      }),
    },
    // Dispatch-bound: construction evidence authenticates the live claim, which only exists per
    // dispatch, so the cohort half is built when the runtime hands it the claimed dispatch.
    cohort: ({ requestId, claim }) => ({
      selectValuationInputBundleId,
      loadConstructionEvidence: createLocalAflTradePrivateValuationConstructionEvidence({
        dispatch: { requestId, scopeKey: 'afl-men:2025-trades', claim },
        artifactRepository: artifacts,
        maximumArtifactBytes: input.maximumArtifactBytes,
        specificationArtifact: input.selection.constructionSpecificationArtifact,
      }),
      constructTrade: input.constructTrade,
    }),
  };
}
