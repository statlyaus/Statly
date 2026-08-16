import { z } from 'zod';

import {
  aflTradeArtifactRefSchema,
  doesAflTradeArtifactRefMatchCanonicalJson,
  type AflTradeArtifactRef,
} from '../artifacts/artifactReference';
import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import {
  parseAflTradeWorkbookTransactionReviewDecision,
  type AflTradeWorkbookTransactionReviewDecision,
} from '../source/workbookTransactionReviewDecision';
import {
  parseAflTradeWorkbookTransactionReviewSet,
  type AflTradeWorkbookTransactionReviewSet,
} from '../source/workbookTransactionReviewSet';

export const AFL_TRADE_PRIVATE_TRADE_ASSET_CUSTODY_SCHEMA_VERSION =
  'afl-trade-private-trade-asset-custody/v1' as const;

const publicIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u);
const evidenceRefsSchema = z.array(aflTradeArtifactRefSchema).min(1).max(100);

const assetIdentitySchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('player'),
      playerId: publicIdSchema,
      acquisitionSpellVersionId: aflTradeContentAddressedIdSchema(
        'acquisition-spell-version'
      ),
      identityEvidenceRefs: evidenceRefsSchema,
      acquisitionSpellEvidenceRefs: evidenceRefsSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('pick'),
      selectionId: publicIdSchema,
      selectedPlayerId: publicIdSchema,
      acquisitionSpellVersionId: aflTradeContentAddressedIdSchema(
        'acquisition-spell-version'
      ),
      selectionLineageArtifact: aflTradeArtifactRefSchema,
      identityEvidenceRefs: evidenceRefsSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('future_pick'),
      entitlementId: publicIdSchema,
      draftYear: z.number().int().min(1897).max(2200),
      round: z.number().int().min(1).max(20),
      originalClubId: publicIdSchema,
      selectionId: publicIdSchema.nullable(),
      selectedPlayerId: publicIdSchema.nullable(),
      acquisitionSpellVersionId: aflTradeContentAddressedIdSchema(
        'acquisition-spell-version'
      ).nullable(),
      selectionLineageArtifact: aflTradeArtifactRefSchema,
      identityEvidenceRefs: evidenceRefsSchema,
    })
    .strict()
    .superRefine((identity, context) => {
      const exercised = identity.selectionId !== null;
      if (
        exercised !== (identity.selectedPlayerId !== null) ||
        exercised !== (identity.acquisitionSpellVersionId !== null)
      ) {
        context.addIssue({
          code: 'custom',
          message:
            'An exercised future pick requires exact selection, selected-player, and acquisition-spell identity together.',
        });
      }
    }),
]);

const unavailableReasonSchema = z.enum([
  'asset_kind_unresolved',
  'asset_identity_unresolved',
  'selection_lineage_unresolved',
  'acquisition_spell_unresolved',
  'transfer_direction_unresolved',
]);

const inputBase = {
  sourcePartyRowId: aflTradeContentAddressedIdSchema('workbook-row'),
  sendingClubId: publicIdSchema,
  receivingClubId: publicIdSchema,
};

const assetInputSchema = z.discriminatedUnion('state', [
  z
    .object({
      ...inputBase,
      state: z.literal('resolved'),
      identity: assetIdentitySchema,
    })
    .strict(),
  z
    .object({
      ...inputBase,
      state: z.literal('unavailable'),
      assertedKind: z.enum(['player', 'pick', 'future_pick', 'unknown']),
      reasons: z.array(unavailableReasonSchema).min(1).max(5),
      evidenceRefs: evidenceRefsSchema,
    })
    .strict(),
]);

const assetBase = {
  assetId: aflTradeContentAddressedIdSchema('private-confirmed-trade-asset'),
  sourcePartyRowId: aflTradeContentAddressedIdSchema('workbook-row'),
  sourceLocator: z.string().trim().min(1).max(10_000),
  sourceOrdinal: z.number().int().nonnegative(),
  sourceClubLabel: z.string().trim().min(1).max(10_000),
  sourceAssetText: z.string().trim().min(1).max(10_000),
  sendingClubId: publicIdSchema,
  receivingClubId: publicIdSchema,
};

const assetSchema = z.discriminatedUnion('state', [
  z.object({ ...assetBase, state: z.literal('resolved'), identity: assetIdentitySchema }).strict(),
  z
    .object({
      ...assetBase,
      state: z.literal('unavailable'),
      assertedKind: z.enum(['player', 'pick', 'future_pick', 'unknown']),
      reasons: z.array(unavailableReasonSchema).min(1).max(5),
      evidenceRefs: evidenceRefsSchema,
    })
    .strict(),
]);

const contentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_PRIVATE_TRADE_ASSET_CUSTODY_SCHEMA_VERSION),
    environment: z.literal('non_production'),
    authority: z.literal('exact_current_private_workbook_transaction_and_asset_review'),
    valuationScopeKey: publicIdSchema,
    tradeId: aflTradeContentAddressedIdSchema('private-confirmed-trade'),
    reviewSetId: aflTradeContentAddressedIdSchema('workbook-transaction-review-set'),
    reviewSetArtifact: aflTradeArtifactRefSchema,
    reviewSubjectId: aflTradeContentAddressedIdSchema('workbook-transaction-review-subject'),
    reviewDecisionId: aflTradeContentAddressedIdSchema(
      'workbook-transaction-review-decision'
    ),
    reviewDecisionArtifact: aflTradeArtifactRefSchema,
    sourceTitle: z.string().trim().min(1).max(10_000),
    seasonYear: z.number().int().min(1897).max(2200),
    transferDirection: z.literal('listed_club_received_assets'),
    canonicalClubIds: z.array(publicIdSchema).min(2).max(30),
    expectedSourcePartyRowIds: z
      .array(aflTradeContentAddressedIdSchema('workbook-row'))
      .min(2)
      .max(1_000),
    assets: z.array(assetSchema).min(2).max(1_000),
    state: z.enum(['ready', 'blocked']),
    counts: z
      .object({
        totalAssets: z.number().int().positive(),
        resolvedAssets: z.number().int().nonnegative(),
        unavailableAssets: z.number().int().nonnegative(),
      })
      .strict(),
    classifiedAt: z.iso.datetime({ offset: true }),
    publicationEligible: z.literal(false),
    publicationProhibited: z.literal(true),
    limitation: z.literal(
      'Private local transaction and asset classification only; not a factual release, numerical result, publication candidate, production authority, or activation authority.'
    ),
  })
  .strict()
  .superRefine((content, context) => {
    const assetRowIds = content.assets.map(({ sourcePartyRowId }) => sourcePartyRowId);
    if (
      new Set(content.expectedSourcePartyRowIds).size !== content.expectedSourcePartyRowIds.length ||
      assetRowIds.length !== content.expectedSourcePartyRowIds.length ||
      assetRowIds.some((rowId, index) => rowId !== content.expectedSourcePartyRowIds[index])
    ) {
      context.addIssue({
        code: 'custom',
        path: ['assets'],
        message: 'Asset custody must classify every source party row exactly once.',
      });
    }
    const resolvedAssets = content.assets.filter(({ state }) => state === 'resolved').length;
    const unavailableAssets = content.assets.length - resolvedAssets;
    if (
      content.counts.totalAssets !== content.assets.length ||
      content.counts.resolvedAssets !== resolvedAssets ||
      content.counts.unavailableAssets !== unavailableAssets ||
      content.state !== (unavailableAssets === 0 ? 'ready' : 'blocked')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['counts'],
        message: 'Asset custody state and counts must equal the exact classifications.',
      });
    }
    const classifiedAt = Date.parse(content.classifiedAt);
    const identityEvidence = content.assets.flatMap((asset) => {
      if (asset.state === 'unavailable') return asset.evidenceRefs;
      if (asset.identity.kind === 'player') {
        return [
          ...asset.identity.identityEvidenceRefs,
          ...asset.identity.acquisitionSpellEvidenceRefs,
        ];
      }
      return [
        asset.identity.selectionLineageArtifact,
        ...asset.identity.identityEvidenceRefs,
      ];
    });
    if (
      [content.reviewSetArtifact, content.reviewDecisionArtifact, ...identityEvidence].some(
        ({ createdAt }) => Date.parse(createdAt) > classifiedAt
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Every classification parent must exist before the trusted classification time.',
      });
    }
  });

export const aflTradePrivateTradeAssetCustodySchema = z
  .object({
    custodyId: aflTradeContentAddressedIdSchema('private-trade-asset-custody'),
    content: contentSchema,
  })
  .strict()
  .superRefine((custody, context) => {
    addAflTradeContentAddressIssue(
      'private-trade-asset-custody',
      custody.custodyId,
      custody.content,
      context,
      ['custodyId']
    );
  });

export type AflTradePrivateTradeAssetCustody = z.infer<
  typeof aflTradePrivateTradeAssetCustodySchema
>;

function assetAddress(
  tradeId: string,
  asset: z.infer<typeof assetInputSchema>
): string {
  return createAflTradeContentAddress('private-confirmed-trade-asset', {
    tradeId,
    ...asset,
  });
}

export function createAflTradePrivateTradeAssetCustody(input: {
  readonly reviewSet: AflTradeWorkbookTransactionReviewSet;
  readonly currentDecision: AflTradeWorkbookTransactionReviewDecision;
  readonly reviewSetArtifact: AflTradeArtifactRef;
  readonly reviewDecisionArtifact: AflTradeArtifactRef;
  readonly reviewSubjectId: string;
  readonly assets: readonly z.input<typeof assetInputSchema>[];
  readonly classifiedAt: string;
}): AflTradePrivateTradeAssetCustody {
  const reviewSet = parseAflTradeWorkbookTransactionReviewSet(input.reviewSet);
  const decision = parseAflTradeWorkbookTransactionReviewDecision(input.currentDecision);
  if (!doesAflTradeArtifactRefMatchCanonicalJson(input.reviewSetArtifact, reviewSet)) {
    throw new TypeError('Asset custody requires the exact immutable review set.');
  }
  if (!doesAflTradeArtifactRefMatchCanonicalJson(input.reviewDecisionArtifact, decision)) {
    throw new TypeError('Asset custody requires the exact immutable review decision.');
  }
  if (
    decision.content.outcome !== 'approved' ||
    decision.content.transferDirection !== 'listed_club_received_assets' ||
    decision.content.reviewSetId !== reviewSet.reviewSetId ||
    decision.content.reviewSubjectId !== input.reviewSubjectId
  ) {
    throw new TypeError('Asset custody requires one exact approved transaction-review parent.');
  }
  const subject = reviewSet.content.transactions.find(
    ({ reviewSubjectId }) => reviewSubjectId === input.reviewSubjectId
  );
  if (!subject) throw new TypeError('The reviewed transaction subject is unavailable.');
  const valuationScopeKey = `workbook:${subject.seasonYear}`;
  const tradeId = createAflTradeContentAddress('private-confirmed-trade', {
    valuationScopeKey,
    reviewSetId: reviewSet.reviewSetId,
    reviewSubjectId: subject.reviewSubjectId,
    reviewDecisionId: decision.decisionId,
  });
  const parsedInputs = z.array(assetInputSchema).parse(input.assets);
  const partyById = new Map(subject.parties.map((party) => [party.stagingRowId, party]));
  const clubByPartyId = new Map(
    subject.parties.map((party, index) => [
      party.stagingRowId,
      decision.content.canonicalClubIds[index]!,
    ])
  );
  const canonicalClubs = new Set(decision.content.canonicalClubIds);
  const assets = parsedInputs
    .map((asset) => {
      const party = partyById.get(asset.sourcePartyRowId);
      if (!party) throw new TypeError('Asset custody includes an unknown source party row.');
      if (clubByPartyId.get(asset.sourcePartyRowId) !== asset.receivingClubId) {
        throw new TypeError('Asset receiving club differs from the exact reviewed party mapping.');
      }
      if (
        asset.sendingClubId === asset.receivingClubId ||
        !canonicalClubs.has(asset.sendingClubId)
      ) {
        throw new TypeError('Asset sending club must be another reviewed transaction party.');
      }
      return {
        assetId: assetAddress(tradeId, asset),
        sourcePartyRowId: party.stagingRowId,
        sourceLocator: party.sourceLocator,
        sourceOrdinal: party.sourceOrdinal,
        sourceClubLabel: party.clubLabel,
        sourceAssetText: party.assetText,
        sendingClubId: asset.sendingClubId,
        receivingClubId: asset.receivingClubId,
        ...(asset.state === 'resolved'
          ? { state: asset.state, identity: asset.identity }
          : {
              state: asset.state,
              assertedKind: asset.assertedKind,
              reasons: [...asset.reasons].sort(),
              evidenceRefs: asset.evidenceRefs,
            }),
      };
    })
    .sort((left, right) => left.sourceOrdinal - right.sourceOrdinal);
  const expectedSourcePartyRowIds = subject.parties.map(({ stagingRowId }) => stagingRowId);
  const resolvedAssets = assets.filter(({ state }) => state === 'resolved').length;
  const unavailableAssets = assets.length - resolvedAssets;
  const content = contentSchema.parse({
    schemaVersion: AFL_TRADE_PRIVATE_TRADE_ASSET_CUSTODY_SCHEMA_VERSION,
    environment: 'non_production',
    authority: 'exact_current_private_workbook_transaction_and_asset_review',
    valuationScopeKey,
    tradeId,
    reviewSetId: reviewSet.reviewSetId,
    reviewSetArtifact: input.reviewSetArtifact,
    reviewSubjectId: subject.reviewSubjectId,
    reviewDecisionId: decision.decisionId,
    reviewDecisionArtifact: input.reviewDecisionArtifact,
    sourceTitle: subject.sourceTitle,
    seasonYear: subject.seasonYear,
    transferDirection: 'listed_club_received_assets',
    canonicalClubIds: decision.content.canonicalClubIds,
    expectedSourcePartyRowIds,
    assets,
    state: unavailableAssets === 0 ? 'ready' : 'blocked',
    counts: {
      totalAssets: assets.length,
      resolvedAssets,
      unavailableAssets,
    },
    classifiedAt: input.classifiedAt,
    publicationEligible: false,
    publicationProhibited: true,
    limitation:
      'Private local transaction and asset classification only; not a factual release, numerical result, publication candidate, production authority, or activation authority.',
  });
  return aflTradePrivateTradeAssetCustodySchema.parse({
    custodyId: createAflTradeContentAddress('private-trade-asset-custody', content),
    content,
  });
}
