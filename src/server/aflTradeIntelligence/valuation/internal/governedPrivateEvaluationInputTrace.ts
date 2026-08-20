import { z } from 'zod';

import { aflTradeArtifactRefSchema } from '../../artifacts/artifactReference';
import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '../../artifacts/contentAddress';
import { governedPrivateEvaluationSelectorSchema } from './governedPrivateEvaluationWorkspaceContracts';

const instantSchema = z.iso.datetime({ offset: true });
const publicIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);
const displayLabelSchema = z.string().trim().min(1).max(240);
const componentRoles = [
  'player_contribution_and_availability',
  'draft_pick_and_future_pick_distribution',
] as const;
const pickAssetKinds = ['current_pick_entitlement', 'future_pick_entitlement'] as const;

const componentSchema = z
  .object({
    role: z.enum(componentRoles),
    runId: aflTradeContentAddressedIdSchema('model-run'),
    protocolId: aflTradeContentAddressedIdSchema('model-protocol'),
    datasetId: aflTradeContentAddressedIdSchema('dataset'),
    datasetAdmissionId: aflTradeContentAddressedIdSchema('dataset-admission'),
    gate3DecisionId: aflTradeContentAddressedIdSchema('gate-decision'),
    evidence: z
      .object({
        runManifest: aflTradeArtifactRefSchema,
        protocol: aflTradeArtifactRefSchema,
        datasetAdmission: aflTradeArtifactRefSchema,
        gate3Decision: aflTradeArtifactRefSchema,
      })
      .strict(),
  })
  .strict();

const transferSchema = z
  .object({
    transferId: publicIdSchema,
    assetId: publicIdSchema,
    assetKind: z.enum(['player', ...pickAssetKinds]),
    fromClubId: publicIdSchema,
    toClubId: publicIdSchema,
    displayLabel: displayLabelSchema,
    evidenceRef: aflTradeArtifactRefSchema,
  })
  .strict();

const seasonSchema = z
  .object({
    season: z.number().int().min(1897).max(2200),
    status: z.enum(['complete', 'current_complete', 'right_censored']),
    startsAt: instantSchema,
    endsAt: instantSchema,
    evidenceRef: aflTradeArtifactRefSchema,
  })
  .strict()
  .superRefine((season, context) => {
    if (Date.parse(season.endsAt) <= Date.parse(season.startsAt)) {
      context.addIssue({ code: 'custom', message: 'Season end must follow season start.' });
    }
  });

const acquisitionSpellSchema = z
  .object({
    spellVersionId: publicIdSchema,
    clubId: publicIdSchema,
    clubName: displayLabelSchema,
    joinedAt: instantSchema,
    departedAt: instantSchema.nullable(),
    evidenceRef: aflTradeArtifactRefSchema,
  })
  .strict()
  .superRefine((spell, context) => {
    if (spell.departedAt !== null && Date.parse(spell.departedAt) <= Date.parse(spell.joinedAt)) {
      context.addIssue({ code: 'custom', message: 'Acquisition-spell departure must follow joining.' });
    }
  });

const requiredSeasonSchema = z
  .object({
    season: z.number().int().min(1897).max(2200),
    status: z.enum(['complete', 'current_complete', 'right_censored']),
    evidenceRef: aflTradeArtifactRefSchema,
  })
  .strict();

const playerHorizonSchema = z
  .object({
    assetId: publicIdSchema,
    playerId: publicIdSchema,
    playerName: displayLabelSchema,
    playerObservationId: aflTradeContentAddressedIdSchema('player-pav-observation'),
    playerObservationArtifact: aflTradeArtifactRefSchema,
    receivingClubId: publicIdSchema,
    acquisitionSpells: z.array(acquisitionSpellSchema).min(1).max(20),
    requiredSeasons: z.array(requiredSeasonSchema).min(1).max(40),
  })
  .strict();

const custodySchema = z
  .object({
    ordinal: z.number().int().nonnegative().max(100),
    clubId: publicIdSchema,
    clubName: displayLabelSchema,
    heldFrom: instantSchema,
    heldThrough: instantSchema.nullable(),
    evidenceRef: aflTradeArtifactRefSchema,
  })
  .strict()
  .superRefine((custody, context) => {
    if (
      custody.heldThrough !== null &&
      Date.parse(custody.heldThrough) <= Date.parse(custody.heldFrom)
    ) {
      context.addIssue({ code: 'custom', message: 'Pick custody must have a positive interval.' });
    }
  });

const lineageAssetLabelSchema = z
  .object({
    assetId: publicIdSchema,
    displayLabel: displayLabelSchema,
  })
  .strict();

const transformationSchema = z
  .object({
    ordinal: z.number().int().nonnegative().max(100),
    kind: z.enum(['renumbered', 'selected_player', 'split', 'merged']),
    fromAssetIds: z.array(publicIdSchema).min(1).max(20),
    toAssetIds: z.array(publicIdSchema).min(1).max(20),
    effectiveAt: instantSchema,
    economicAllocationDecisionId: aflTradeContentAddressedIdSchema(
      'economic-allocation-decision'
    ).nullable(),
    assetLabels: z.array(lineageAssetLabelSchema).min(1).max(40),
    evidenceRef: aflTradeArtifactRefSchema,
  })
  .strict()
  .superRefine((transformation, context) => {
    const needsAllocation = transformation.kind === 'split' || transformation.kind === 'merged';
    if (needsAllocation !== (transformation.economicAllocationDecisionId !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['economicAllocationDecisionId'],
        message:
          'Split or merged transformations require one approved economic-allocation decision.',
      });
    }
    for (const field of ['fromAssetIds', 'toAssetIds'] as const) {
      const ids = transformation[field];
      if (new Set(ids).size !== ids.length || ids.some((id, index) => index > 0 && ids[index - 1]! > id)) {
        context.addIssue({
          code: 'custom',
          path: [field],
          message: 'Transformation assets must be unique and canonically ordered.',
        });
      }
    }
    const expectedLabelIds = [...new Set([
      ...transformation.fromAssetIds,
      ...transformation.toAssetIds,
    ])].sort();
    const actualLabelIds = transformation.assetLabels.map(({ assetId }) => assetId);
    if (!canonicalIds(actualLabelIds) || !exactJson(actualLabelIds, expectedLabelIds)) {
      context.addIssue({
        code: 'custom',
        path: ['assetLabels'],
        message: 'Transformation labels must exactly cover its complete lineage frontier.',
      });
    }
  });

const pickLineageSchema = z
  .object({
    rootAssetId: publicIdSchema,
    pickIdentityId: publicIdSchema,
    pickIdentityLabel: displayLabelSchema,
    receivingClubId: publicIdSchema,
    pickObservationSetId: aflTradeContentAddressedIdSchema('pick-pav-observation-set'),
    pickModelExecutionId: aflTradeContentAddressedIdSchema('pick-pav-model-execution'),
    pickBenchmarkId: aflTradeContentAddressedIdSchema('pick-pav-benchmark'),
    pickBenchmarkArtifact: aflTradeArtifactRefSchema,
    resolvedSelectionNumber: z.number().int().positive().max(500).nullable(),
    custody: z.array(custodySchema).min(1).max(100),
    transformations: z.array(transformationSchema).max(100),
  })
  .strict();

export const GOVERNED_PRIVATE_EVALUATION_INPUT_TRACE_SCHEMA_VERSION =
  'private-evaluation-input-trace/v1' as const;
const LIMITATION =
  'Authenticated calculation-input trace only; contains no caller-supplied values, grades, publication approval, or activation authority.' as const;

function canonicalIds(values: readonly string[]): boolean {
  return (
    new Set(values).size === values.length &&
    values.every((value, index) => index === 0 || values[index - 1]! < value)
  );
}

function exactJson(left: unknown, right: unknown): boolean {
  return canonicalizeAflTradeJson(left) === canonicalizeAflTradeJson(right);
}

export const governedPrivateEvaluationInputTraceContentSchema = z
  .object({
    schemaVersion: z.literal(GOVERNED_PRIVATE_EVALUATION_INPUT_TRACE_SCHEMA_VERSION),
    environment: z.enum(['non_production', 'production']),
    selector: governedPrivateEvaluationSelectorSchema,
    factualReleaseId: aflTradeContentAddressedIdSchema('outcome-release'),
    valuationInputBundleId: aflTradeContentAddressedIdSchema('valuation-input-bundle'),
    components: z.array(componentSchema).length(componentRoles.length),
    transaction: z
      .object({
        effectiveAt: instantSchema,
        clubs: z
          .array(
            z
              .object({
                aflClubId: publicIdSchema,
                clubName: displayLabelSchema,
              })
              .strict()
          )
          .min(2)
          .max(4),
        transfers: z.array(transferSchema).min(2).max(100),
      })
      .strict(),
    seasonUniverse: z.array(seasonSchema).min(1).max(40),
    playerHorizons: z.array(playerHorizonSchema).max(100),
    pickLineages: z.array(pickLineageSchema).max(100),
    derivedAt: instantSchema,
    publicationEligible: z.literal(false),
    limitation: z.literal(LIMITATION),
  })
  .strict()
  .superRefine((trace, context) => {
    const componentRoleValues = trace.components.map(({ role }) => role);
    if (!exactJson(componentRoleValues, componentRoles)) {
      context.addIssue({ code: 'custom', message: 'Model components must use canonical roles.' });
    }
    for (const field of [
      'runId',
      'protocolId',
      'datasetId',
      'datasetAdmissionId',
      'gate3DecisionId',
    ] as const) {
      if (new Set(trace.components.map((component) => component[field])).size !== componentRoles.length) {
        context.addIssue({ code: 'custom', message: `Model component ${field} values must be distinct.` });
      }
    }

    const transferIds = trace.transaction.transfers.map(({ transferId }) => transferId);
    const transferAssetIds = trace.transaction.transfers.map(({ assetId }) => assetId);
    const participatingClubIds = [
      ...new Set(
        trace.transaction.transfers.flatMap(({ fromClubId, toClubId }) => [
          fromClubId,
          toClubId,
        ])
      ),
    ].sort();
    const transactionClubIds = trace.transaction.clubs.map(({ aflClubId }) => aflClubId);
    if (
      !canonicalIds(transactionClubIds) ||
      !canonicalIds(transferIds) ||
      !canonicalIds(transferAssetIds) ||
      !exactJson(transactionClubIds, participatingClubIds) ||
      trace.transaction.transfers.some(({ fromClubId, toClubId }) => fromClubId === toClubId)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['transaction'],
        message: 'Transaction clubs must equal the exact clubs participating in directed transfers.',
      });
    }

    const seasons = trace.seasonUniverse.map(({ season }) => String(season));
    const currentSeasons = trace.seasonUniverse.filter(({ status }) => status !== 'complete');
    const firstPostTradeSeason = new Date(trace.transaction.effectiveAt).getUTCFullYear() + 1;
    if (
      !canonicalIds(seasons) ||
      currentSeasons.length !== 1 ||
      trace.seasonUniverse.at(-1)?.status === 'complete' ||
      trace.seasonUniverse.some(
        ({ season, startsAt, endsAt }, index) =>
          season !== firstPostTradeSeason + index ||
          startsAt.slice(0, 4) !== String(season) ||
          endsAt.slice(0, 4) !== String(season)
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['seasonUniverse'],
        message:
          'Season universe must contain every consecutive post-trade season through the current cutoff.',
      });
    }

    const transfersByAsset = new Map(
      trace.transaction.transfers.map((transfer) => [transfer.assetId, transfer])
    );
    const clubNames = new Map<string, string>();
    const clubIdentities = [
      ...trace.transaction.clubs.map(({ aflClubId, clubName }) => ({
        clubId: aflClubId,
        clubName,
      })),
      ...trace.playerHorizons.flatMap(({ acquisitionSpells }) => acquisitionSpells),
      ...trace.pickLineages.flatMap(({ custody }) => custody),
    ];
    for (const { clubId, clubName } of clubIdentities) {
      const existingName = clubNames.get(clubId);
      if (existingName !== undefined && existingName !== clubName) {
        context.addIssue({
          code: 'custom',
          path: ['transaction', 'clubs'],
          message: 'One authenticated club identity cannot use conflicting display names.',
        });
      }
      clubNames.set(clubId, clubName);
    }
    const playerAssetIds = trace.transaction.transfers
      .filter(({ assetKind }) => assetKind === 'player')
      .map(({ assetId }) => assetId)
      .sort();
    const tracedPlayerIds = trace.playerHorizons.map(({ assetId }) => assetId);
    const pickAssetIds = trace.transaction.transfers
      .filter(({ assetKind }) => pickAssetKinds.includes(assetKind as (typeof pickAssetKinds)[number]))
      .map(({ assetId }) => assetId)
      .sort();
    const tracedPickIds = trace.pickLineages.map(({ rootAssetId }) => rootAssetId);
    if (!canonicalIds(tracedPlayerIds) || !exactJson(playerAssetIds, tracedPlayerIds)) {
      context.addIssue({ code: 'custom', message: 'Every player transfer requires one exact player horizon.' });
    }
    if (!canonicalIds(tracedPickIds) || !exactJson(pickAssetIds, tracedPickIds)) {
      context.addIssue({ code: 'custom', message: 'Every pick transfer requires one exact pick lineage.' });
    }

    for (const horizon of trace.playerHorizons) {
      const transfer = transfersByAsset.get(horizon.assetId);
      const spells = [...horizon.acquisitionSpells].sort((left, right) =>
        left.joinedAt.localeCompare(right.joinedAt)
      );
      const receivingSpell = spells.find(({ clubId }) => clubId === horizon.receivingClubId);
      const expectedSeasons = receivingSpell === undefined ? [] : trace.seasonUniverse
        .filter((season) =>
          Date.parse(season.startsAt) >= Math.max(
            Date.parse(trace.transaction.effectiveAt),
            Date.parse(receivingSpell.joinedAt)
          ) &&
          (receivingSpell.departedAt === null ||
            Date.parse(season.startsAt) < Date.parse(receivingSpell.departedAt))
        )
        .map(({ season, status }) => ({ season, status }));
      const actualSeasons = horizon.requiredSeasons.map(({ season, status }) => ({ season, status }));
      if (
        transfer?.assetKind !== 'player' ||
        transfer.toClubId !== horizon.receivingClubId ||
        transfer.displayLabel !== horizon.playerName ||
        receivingSpell === undefined ||
        !exactJson(actualSeasons, expectedSeasons)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['playerHorizons'],
          message: 'Player horizon must contain every applicable season from the authenticated universe.',
        });
      }
    }

    for (const lineage of trace.pickLineages) {
      const transfer = transfersByAsset.get(lineage.rootAssetId);
      const custodyContinuous = lineage.custody.every((entry, index) =>
        entry.ordinal === index &&
        (index === 0
          ? entry.clubId === lineage.receivingClubId && entry.heldFrom === trace.transaction.effectiveAt
          : lineage.custody[index - 1]!.heldThrough === entry.heldFrom) &&
        (index < lineage.custody.length - 1 ? entry.heldThrough !== null : entry.heldThrough === null)
      );
      let frontier = [lineage.rootAssetId];
      const transformationChain = lineage.transformations.every((transformation, index) => {
        const valid =
          transformation.ordinal === index &&
          exactJson(transformation.fromAssetIds, frontier) &&
          Date.parse(transformation.effectiveAt) >= Date.parse(trace.transaction.effectiveAt);
        frontier = transformation.toAssetIds;
        return valid;
      });
      if (
        transfer === undefined ||
        transfer.assetKind === 'player' ||
        transfer.toClubId !== lineage.receivingClubId ||
        !custodyContinuous ||
        !transformationChain
      ) {
        context.addIssue({
          code: 'custom',
          path: ['pickLineages'],
          message: 'Pick lineage must preserve exact identity, continuous custody, and ordered transformations.',
        });
      }
    }

    const createdAtValues = [
      ...trace.components.flatMap(({ evidence }) => Object.values(evidence).map(({ createdAt }) => createdAt)),
      ...trace.transaction.transfers.map(({ evidenceRef }) => evidenceRef.createdAt),
      ...trace.seasonUniverse.map(({ evidenceRef }) => evidenceRef.createdAt),
      ...trace.playerHorizons.flatMap(
        ({ playerObservationArtifact, acquisitionSpells, requiredSeasons }) => [
          playerObservationArtifact.createdAt,
          ...acquisitionSpells.map(({ evidenceRef }) => evidenceRef.createdAt),
          ...requiredSeasons.map(({ evidenceRef }) => evidenceRef.createdAt),
        ]
      ),
      ...trace.pickLineages.flatMap(({ pickBenchmarkArtifact, custody, transformations }) => [
        pickBenchmarkArtifact.createdAt,
        ...custody.map(({ evidenceRef }) => evidenceRef.createdAt),
        ...transformations.map(({ evidenceRef }) => evidenceRef.createdAt),
      ]),
    ];
    if (createdAtValues.some((createdAt) => Date.parse(createdAt) > Date.parse(trace.derivedAt))) {
      context.addIssue({ code: 'custom', message: 'Input-trace evidence must exist before derivation.' });
    }
  });

export const governedPrivateEvaluationInputTraceSchema = z
  .object({
    inputTraceId: aflTradeContentAddressedIdSchema('private-evaluation-input-trace'),
    content: governedPrivateEvaluationInputTraceContentSchema,
  })
  .strict()
  .superRefine((trace, context) => {
    addAflTradeContentAddressIssue(
      'private-evaluation-input-trace',
      trace.inputTraceId,
      trace.content,
      context,
      ['inputTraceId']
    );
  });

export type GovernedPrivateEvaluationInputTrace = z.infer<
  typeof governedPrivateEvaluationInputTraceSchema
>;

export function createGovernedPrivateEvaluationInputTrace(
  input: z.input<typeof governedPrivateEvaluationInputTraceContentSchema>
): GovernedPrivateEvaluationInputTrace {
  const content = governedPrivateEvaluationInputTraceContentSchema.parse(input);
  return governedPrivateEvaluationInputTraceSchema.parse({
    inputTraceId: createAflTradeContentAddress('private-evaluation-input-trace', content),
    content,
  });
}
