import { describe, expect, it } from 'vitest';

import {
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  authenticateAflTradeExternalCanonicalPromotionProposal,
  createAflTradeExternalCanonicalPromotionRequest,
  deriveAflTradeExternalCanonicalPromotionProposal,
  parseAflTradeExternalCanonicalPromotionRequest,
} from '@/server/aflTradeIntelligence/source/externalCanonicalPromotionContracts';
import {
  AFL_TRADE_EXTERNAL_EVIDENCE_BATCH_SCHEMA_VERSION,
  AFL_TRADE_EXTERNAL_EVIDENCE_SCHEMA_VERSION,
  createAflTradeExternalEvidenceBatch,
  createAflTradeExternalEvidenceEnvelope,
  type AflTradeExternalEvidenceContent,
} from '@/server/aflTradeIntelligence/source/externalDraftTradeEvidenceContracts';
import {
  AFL_TRADE_EXTERNAL_IDENTITY_RESOLUTION_SCHEMA_VERSION,
  createAflTradeExternalIdentityResolution,
  reconcileAflTradeExternalEvidence,
} from '@/server/aflTradeIntelligence/source/externalEvidenceReconciliation';
import {
  createAflTradeExternalReconciliationCandidate,
  parseAflTradeExternalReconciliationCandidate,
} from '@/server/aflTradeIntelligence/source/externalReconciliationCandidateContracts';
import {
  AFL_TRADE_EXTERNAL_RECONCILIATION_SOURCE_AUTHORITY_SCHEMA_VERSION,
  createAflTradeHistoricalCompletionReconciliationAuthority,
} from '@/server/aflTradeIntelligence/source/externalReconciliationSourceAuthorityContracts';
import {
  aflTradeAdditiveDraftVersion,
  aflTradeNumberOnlyPickIds,
  aflTradePromotedDraftState,
  aflTradePromotionWriteScope,
  type AflTradeCurrentCanonicalSelectionPick,
  type AflTradeDraftRootSlot,
} from '@/server/aflTradeIntelligence/source/pickLineageDeferral';

/**
 * Selections promoted before the pick-identity rules carry their slot's number-only pick id (#853):
 * 239 of 383 current 2019 to 2024 national selections on the grading database (2026-10-15). Where the
 * candidate names the pick, with usable custody, the slot is re-keyed: re-promoted with the re-synced
 * slots under the candidate's pick, as many per session root as keep its scoped version additive
 * under asset-scoped supersession (migration 0284).
 */
const digest = (character: string) => character.repeat(64);
const decisionId = `review-decision:${digest('d')}`;
const root = 'draft-event:session-2';
const origin = 'event-version:session-2-v1';

const slot = (
  selectionNumber: number,
  playerId: string,
  eventVersionId = origin,
  current = true
): AflTradeDraftRootSlot[] => [
  { eventId: root, eventVersionId, kind: 'selection', selectionNumber, playerId, current },
  { eventId: root, eventVersionId, kind: 'asset', selectionNumber: null, playerId, current },
];
const night = (numbers: readonly number[]) => numbers.flatMap((n) => slot(n, `player-${n}`));
const numberOnly = (selectionNumber: number) =>
  createAflTradeContentAddress('draft-pick', {
    draftYear: 2024,
    draftType: 'national',
    nominalPick: selectionNumber,
    nominalRound: null,
  });
const custodyPick = (selectionNumber: number) =>
  createAflTradeContentAddress('draft-pick', { custody: selectionNumber });
const selection = (selectionNumber: number, overrides: Record<string, unknown> = {}) => ({
  selectionId: `selection:${selectionNumber}`,
  draftYear: 2024,
  draftType: 'national',
  selectionNumber,
  roundNumber: null,
  pickId: custodyPick(selectionNumber),
  playerId: `player-${selectionNumber}`,
  clubId: 'club-a',
  status: 'single_source',
  ...overrides,
});
const current = (
  selectionNumber: number,
  overrides: Partial<AflTradeCurrentCanonicalSelectionPick> = {}
): AflTradeCurrentCanonicalSelectionPick => ({
  selectionId: `selection:${selectionNumber}`,
  selectionNumber,
  playerId: `player-${selectionNumber}`,
  pickId: numberOnly(selectionNumber),
  clubId: 'club-a',
  eventId: root,
  eventVersionId: origin,
  specialEntitlementCited: false,
  ...overrides,
});
const custody = (selectionNumber: number, status = 'single_source') => ({
  custodyId: `custody:${selectionNumber}`,
  pickId: custodyPick(selectionNumber),
  status,
});
const state = (
  selections: readonly ReturnType<typeof selection>[],
  rows: readonly AflTradeCurrentCanonicalSelectionPick[],
  options: {
    custody?: readonly ReturnType<typeof custody>[];
    deferredPickIds?: readonly string[];
    rootSlots?: readonly AflTradeDraftRootSlot[];
  } = {}
) =>
  aflTradePromotedDraftState(
    selections,
    rows.map(({ selectionId, selectionNumber, playerId }) => ({
      selectionId,
      selectionNumber,
      playerId,
    })),
    {
      pickCustody:
        options.custody ?? selections.map(({ selectionNumber }) => custody(selectionNumber)),
      deferredPickIds: new Set(options.deferredPickIds ?? []),
      state: {
        selections: rows,
        rootSlots: options.rootSlots ?? night(rows.map(({ selectionNumber }) => selectionNumber)),
      },
    }
  );
const numbers = (count: number) => Array.from({ length: count }, (_, index) => index + 1);

describe('classifying re-keyed selections', () => {
  it('forms the number-only addresses the reconciler and migration 0284 form', () => {
    expect(
      aflTradeNumberOnlyPickIds({ draftYear: 2024, draftType: 'national', selectionNumber: 13 })
    ).toEqual([numberOnly(13)]);
    const rounded = aflTradeNumberOnlyPickIds({
      draftYear: 2024,
      draftType: 'national',
      selectionNumber: 13,
      roundNumber: 1,
    });
    expect(rounded).toHaveLength(2);
    expect(rounded).toContain(numberOnly(13));
  });

  it('re-keys a usable selection whose current row carries its number-only id, and nothing else', () => {
    const result = state(
      [
        selection(1),
        selection(2, { status: 'unresolved' }),
        selection(3),
        selection(4),
        selection(5),
        selection(6),
        selection(7, { clubId: 'club-b' }),
        selection(8),
        selection(9, { pickId: numberOnly(9) }),
      ],
      [
        current(1),
        // Unresolved on the pick side: keeps the promoted id.
        current(2),
        // A promoted id that is not the slot's number-only address (an entitlement, custody or
        // reviewed id) is never overwritten. It is also the pick slot 8 names.
        current(3, { pickId: custodyPick(8) }),
        // Slot 4's pick has no usable custody, slot 5's is deferred.
        current(4),
        current(5),
        // A special entitlement cites the row.
        current(6, { specialEntitlementCited: true }),
        // The club differs.
        current(7),
        // Pick-identity rule 4: slot 3's current row already carries slot 8's pick.
        current(8),
        // The candidate's own pick is number-only.
        current(9),
      ],
      {
        custody: [1, 2, 3, 5, 6, 7, 8].map((n) => custody(n)).concat([custody(4, 'unresolved')]),
        deferredPickIds: [custodyPick(5)],
      }
    );
    expect(result).toEqual({
      promotedDrafts: [],
      resyncedSelectionIds: [],
      rekeyedSelectionIds: ['selection:1'],
    });
  });

  it('re-keys nothing without the context, the root slots, or a fully current draft', () => {
    const selections = numbers(6).map((n) => selection(n));
    const rows = numbers(6).map((n) => current(n));
    // Without the re-key context the draft is left whole, as before migration 0284.
    expect(
      aflTradePromotedDraftState(
        selections,
        rows.map(({ selectionId, selectionNumber, playerId }) => ({
          selectionId,
          selectionNumber,
          playerId,
        }))
      )
    ).toEqual({
      promotedDrafts: [{ draftYear: 2024, draftType: 'national' }],
      resyncedSelectionIds: [],
      rekeyedSelectionIds: [],
    });
    // Without the root's recorded slots additivity cannot be shown.
    expect(state(selections, rows, { rootSlots: [] }).rekeyedSelectionIds).toEqual([]);
    // A draft holding a selection with no current row is written whole.
    expect(state(selections, rows.slice(1)).rekeyedSelectionIds).toEqual([]);
    // A selection current twice is not placed in one version; the others still are.
    expect(
      state(selections, [...rows, current(1, { eventVersionId: 'event-version:other' })], {
        rootSlots: night(numbers(6)),
      }).rekeyedSelectionIds
    ).toEqual(['selection:2', 'selection:3']);
  });

  it('re-keys a re-synced slot under its new player as well', () => {
    expect(
      state(
        [selection(1, { playerId: 'twin' }), selection(2), selection(3), selection(4)],
        [
          current(1),
          current(2, { pickId: custodyPick(2) }),
          current(3, { pickId: custodyPick(3) }),
          current(4, { pickId: custodyPick(4) }),
        ]
      )
    ).toEqual({
      promotedDrafts: [],
      resyncedSelectionIds: ['selection:1'],
      rekeyedSelectionIds: ['selection:1'],
    });
  });
});

describe('keeping each re-sync version additive (migration 0256)', () => {
  it('takes, per root, fewer than half of a version’s other slots and the rest on a later pass', () => {
    const seven = numbers(7);
    // Slot 7 keeps its pick (unresolved on the pick side). A version carrying 3 of its 6 others
    // re-lists the night and retires it, so the first pass takes 2.
    const selections = seven.map((n) => selection(n, n === 7 ? { status: 'unresolved' } : {}));
    const first = state(
      selections,
      seven.map((n) => current(n))
    );
    expect(first.rekeyedSelectionIds).toEqual(['selection:1', 'selection:2']);
    expect(first.promotedDrafts).toEqual([]);
    expect(
      aflTradeAdditiveDraftVersion(
        night(seven),
        [1, 2, 3].map((n) => ({ selectionNumber: n, playerId: `player-${n}` }))
      )
    ).toBe(false);
    // Once the first pass is promoted as version 2, the next preparation takes the next two.
    const passed = 'event-version:session-2-v2';
    const second = state(
      selections,
      seven.map((n) =>
        n <= 2 ? current(n, { pickId: custodyPick(n), eventVersionId: passed }) : current(n)
      ),
      {
        rootSlots: [
          ...seven.flatMap((n) => slot(n, `player-${n}`, origin, n > 2)),
          ...[1, 2].flatMap((n) => slot(n, `player-${n}`, passed)),
        ],
      }
    );
    expect(second.rekeyedSelectionIds).toEqual(['selection:3', 'selection:4']);
    // When every current slot of the night changes, one version carries them all: no slot it
    // omits is left to retire.
    expect(
      state(
        seven.map((n) => selection(n)),
        seven.map((n) => current(n))
      ).rekeyedSelectionIds
    ).toEqual(seven.map((n) => `selection:${n}`));
  });

  it('changes a small scoped version only whole, so its unchanged siblings stay current', () => {
    const scoped = 'event-version:session-2-v2';
    // The genuine Cameron shape: version 1 holds 1 to 9, version 2 re-versions 8 and 9 alone.
    const rootSlots = [
      ...numbers(7).flatMap((n) => slot(n, `player-${n}`)),
      ...[8, 9].flatMap((n) => slot(n, `player-${n}`, origin, false)),
      ...[8, 9].flatMap((n) => slot(n, `player-${n}`, scoped)),
    ];
    const settled = numbers(7).map((n) => current(n, { pickId: custodyPick(n) }));
    const selections = numbers(9).map((n) => selection(n));
    // Re-keying 8 alone carries 1 of 9's 1 other slot on version 2 and retires it: 8 is left.
    expect(
      state(
        selections,
        [
          ...settled,
          current(8, { eventVersionId: scoped }),
          current(9, { eventVersionId: scoped, pickId: custodyPick(9) }),
        ],
        { rootSlots }
      ).rekeyedSelectionIds
    ).toEqual([]);
    // When both slots of version 2 are re-keyed, the version changes whole and retires nothing else.
    expect(
      state(
        selections,
        [
          ...settled,
          current(8, { eventVersionId: scoped }),
          current(9, { eventVersionId: scoped }),
        ],
        { rootSlots }
      ).rekeyedSelectionIds
    ).toEqual(['selection:8', 'selection:9']);
  });

  it('never claims additivity it cannot show, or over a slot of a carried player', () => {
    expect(aflTradeAdditiveDraftVersion([], [])).toBe(false);
    // Player 2 recorded at number 3 elsewhere on the root would be retired by name.
    expect(
      aflTradeAdditiveDraftVersion(
        [...night(numbers(6)), ...slot(3, 'player-2', 'event-version:other')],
        [{ selectionNumber: 2, playerId: 'player-2' }]
      )
    ).toBe(false);
  });
});

describe('a deferred candidate that re-keys a promoted selection', () => {
  const capturedAt = '2026-08-09T04:00:00.000Z';
  const completionId = `external-historical-capture-completion:${digest('9')}`;
  const gws = { nativeId: null, recordedName: 'GWS' };
  const bulldogs = { nativeId: 'western-bulldogs', recordedName: 'Western Bulldogs' };
  const batch = (
    provider: AflTradeExternalEvidenceContent['provider'],
    suffix: string,
    claims: AflTradeExternalEvidenceContent['claim'][]
  ) => {
    const capture: AflTradeExternalEvidenceContent['capture'] = {
      captureId: `source-capture:${digest(suffix)}`,
      artifactId: `artifact:${digest(suffix)}`,
      contentSha256: digest(suffix),
      mediaType: 'text/html',
      sourceUrl: `https://example.test/${provider}/2025/${suffix}`,
      capturedAt,
      effectiveAt: '2025-11-20T00:00:00.000Z',
      parserVersion: `${provider}/v1`,
      fieldManifestSha256: digest('f'),
    };
    return createAflTradeExternalEvidenceBatch({
      schemaVersion: AFL_TRADE_EXTERNAL_EVIDENCE_BATCH_SCHEMA_VERSION,
      provider,
      captureId: capture.captureId,
      evidence: claims.map((claim, index) =>
        createAflTradeExternalEvidenceEnvelope({
          schemaVersion: AFL_TRADE_EXTERNAL_EVIDENCE_SCHEMA_VERSION,
          provider,
          capture,
          sourceRow: { ordinal: index + 1, sourceKey: `${provider}:${index + 1}` },
          claim,
          publicationEligible: false,
        })
      ),
      finalizedAt: capturedAt,
      publicationEligible: false,
    });
  };
  const resolution = (
    provider: AflTradeExternalEvidenceContent['provider'],
    entityKind: 'club' | 'player',
    sourceIdentity: { nativeId: string | null; recordedName: string },
    canonicalId: string
  ) =>
    createAflTradeExternalIdentityResolution({
      schemaVersion: AFL_TRADE_EXTERNAL_IDENTITY_RESOLUTION_SCHEMA_VERSION,
      provider,
      entityKind,
      sourceIdentity,
      canonicalId,
      reviewDecisionId: `review-decision:${digest('a')}`,
      reviewDecisionSha256: digest('a'),
      decidedAt: '2026-08-09T03:00:00.000Z',
      status: 'current_approved',
    });
  // The 2025 national draft: Bulldogs select a reviewed draftee at 14, and the order page states
  // that slot as GWS's round-1 entitlement held by the Bulldogs. Nothing is pick-side.
  const draftguru = batch('draftguru', 'a', [
    {
      kind: 'draft_selection',
      draftYear: 2025,
      draftType: 'national',
      selectionNumber: 14,
      roundNumber: 1,
      player: { nativeId: 'reviewed-draftee', recordedName: 'Reviewed Draftee' },
      selectedByClub: bulldogs,
    },
  ]);
  const order = batch('official_afl', 'e', [
    {
      kind: 'pick_custody',
      draftYear: 2025,
      draftType: 'national',
      roundNumber: 1,
      recordedPickNumber: 14,
      originalClub: gws,
      currentClub: bulldogs,
      observedAt: '2025-10-01T00:00:00.000Z',
    },
  ]);
  const identityResolutions = [
    resolution('draftguru', 'club', bulldogs, 'club-western-bulldogs'),
    resolution(
      'draftguru',
      'player',
      { nativeId: 'reviewed-draftee', recordedName: 'Reviewed Draftee' },
      'player-draftee'
    ),
    resolution('official_afl', 'club', gws, 'club-gws'),
    resolution('official_afl', 'club', bulldogs, 'club-western-bulldogs'),
  ];
  const sourceAuthority = createAflTradeHistoricalCompletionReconciliationAuthority({
    schemaVersion: AFL_TRADE_EXTERNAL_RECONCILIATION_SOURCE_AUTHORITY_SCHEMA_VERSION,
    kind: 'historical_plan_completion',
    completionId,
    completionSha256: digest('9'),
    planId: `external-historical-capture-plan:${digest('8')}`,
    planSha256: digest('7'),
    targetSetSha256: digest('6'),
    resultSetSha256: digest('5'),
    completionSourceBatchSetSha256: digest('4'),
    candidateSourceBatchSetSha256: sha256AflTradeCanonicalJson(
      [draftguru.batchId, order.batchId].sort()
    ),
    completedAt: '2026-08-09T04:30:00.000Z',
  });
  const selection14 = createAflTradeContentAddress('external-draft-selection', {
    draftYear: 2025,
    draftType: 'national',
    selectionNumber: 14,
  });
  const slot14NumberOnly = createAflTradeContentAddress('draft-pick', {
    draftYear: 2025,
    draftType: 'national',
    nominalPick: 14,
    nominalRound: null,
  });
  const promotedRow = (pickId: string): AflTradeCurrentCanonicalSelectionPick => ({
    selectionId: selection14,
    selectionNumber: 14,
    playerId: 'player-draftee',
    pickId,
    clubId: 'club-western-bulldogs',
    eventId: root,
    eventVersionId: origin,
    specialEntitlementCited: false,
  });
  const reconcile = (deferral: boolean, promotedPickId?: string) =>
    reconcileAflTradeExternalEvidence({
      environment: 'test_fixture',
      competition: 'AFLM',
      anchorSeasonYear: 2025,
      sourceBatches: [draftguru, order],
      identityResolutions,
      sourceAuthority,
      reconciledAt: '2026-08-09T05:00:00.000Z',
      ...(deferral ? { pickLineageDeferral: { decisionId } } : {}),
      ...(promotedPickId === undefined
        ? {}
        : {
            promotedDraftSelections: [
              { selectionId: selection14, selectionNumber: 14, playerId: 'player-draftee' },
            ],
            promotedSelectionPicks: {
              selections: [promotedRow(promotedPickId)],
              // Four other draftees on the night: carrying one keeps the version additive.
              rootSlots: [
                ...slot(14, 'player-draftee'),
                ...[15, 16, 17, 18].flatMap((n) => slot(n, `player-${n}`)),
              ],
            },
          }),
    });

  it('records the slot as re-keyed only under the deferral, never over a promoted pick id', () => {
    const plain = reconcile(false);
    const written = plain.content.draftSelections[0]!;
    expect(written).toMatchObject({ selectionId: selection14, status: 'single_source' });
    expect(written.pickId).not.toBe(slot14NumberOnly);
    expect(plain.content.pickCustody.map(({ pickId }) => pickId)).toContain(written.pickId);

    const candidate = reconcile(true, slot14NumberOnly);
    expect(candidate.content.issues).toEqual([]);
    expect(candidate.content.pickLineageDeferral).toEqual({
      decisionId,
      rekeyedSelectionIds: [selection14],
    });
    expect(parseAflTradeExternalReconciliationCandidate(candidate).candidateId).toBe(
      candidate.candidateId
    );
    // The same promoted id as the candidate's: the draft is left whole as before.
    expect(reconcile(true, written.pickId).content.pickLineageDeferral).toEqual({
      decisionId,
      promotedDrafts: [{ draftYear: 2025, draftType: 'national' }],
    });
    // Another non-number-only promoted id is never overwritten.
    expect(
      reconcile(true, createAflTradeContentAddress('draft-pick', { reviewed: true })).content
        .pickLineageDeferral
    ).toEqual({ decisionId, promotedDrafts: [{ draftYear: 2025, draftType: 'national' }] });
    expect(() =>
      reconcileAflTradeExternalEvidence({
        environment: 'test_fixture',
        competition: 'AFLM',
        anchorSeasonYear: 2025,
        sourceBatches: [draftguru, order],
        identityResolutions,
        sourceAuthority,
        reconciledAt: '2026-08-09T05:00:00.000Z',
        promotedSelectionPicks: { selections: [], rootSlots: [] },
      })
    ).toThrow(/only under a pick-side deferral/);
  });

  it('writes only the re-keyed slot, through a session re-sync, and the receipt counts it', () => {
    const candidate = reconcile(true, slot14NumberOnly);
    const written = aflTradePromotionWriteScope(candidate.content);
    expect(written.draftSelections).toEqual([]);
    expect(written.resyncedSelections.map(({ selectionId }) => selectionId)).toEqual([selection14]);
    expect(written).toMatchObject({ resyncedSelectionCount: 0, rekeyedSelectionCount: 1 });
    const resync = {
      selectionId: selection14,
      supersedesVersionId: origin,
      eventDate: '2025-11-20',
      datePrecision: null,
      officialName: '2025 AFL National Draft',
    };
    const proposal = deriveAflTradeExternalCanonicalPromotionProposal({
      candidate,
      proposedAt: '2026-08-09T07:31:00.000Z',
      draftEvents: [],
      promotedSessionResyncs: [resync],
    });
    expect(proposal.content.draftEventCoverage).toEqual([
      expect.objectContaining({
        kind: 'promoted_session_resync',
        supersedesVersionId: origin,
        selectionIds: [selection14],
      }),
    ]);
    const authenticated = authenticateAflTradeExternalCanonicalPromotionProposal({
      candidate,
      proposal,
    });
    expect(authenticated).toMatchObject({
      draftSelectionCount: 1,
      pickLineageDeferral: { decisionId, deferredIssueCount: 0, rekeyedSelectionCount: 1 },
    });
    expect(authenticated.pickLineageDeferral).not.toHaveProperty('resyncedSelectionCount');
    const request = createAflTradeExternalCanonicalPromotionRequest({
      candidateId: candidate.candidateId,
      proposalId: proposal.proposalId,
      approvalDecisionId: `review-decision:${digest('a')}`,
      pickLineageDeferral: authenticated.pickLineageDeferral!,
    });
    expect(parseAflTradeExternalCanonicalPromotionRequest(request)).toEqual(request);
  });

  it('is refused by the candidate contract for an unusable listing', () => {
    const content = reconcile(true, slot14NumberOnly).content;
    const listed = (rekeyedSelectionIds: string[], overrides: Record<string, unknown> = {}) =>
      createAflTradeExternalReconciliationCandidate({
        ...content,
        ...overrides,
        pickLineageDeferral: { decisionId, rekeyedSelectionIds },
      });
    expect(() => listed([selection14])).not.toThrow();
    const refused = /re-keyed selection must be a usable candidate selection/;
    expect(() =>
      listed([selection14], {
        draftSelections: content.draftSelections.map((value) => ({
          ...value,
          status: 'unresolved',
        })),
      })
    ).toThrow(refused);
    expect(() =>
      listed([selection14], {
        draftSelections: content.draftSelections.map((value) => ({
          ...value,
          pickId: slot14NumberOnly,
        })),
      })
    ).toThrow(refused);
    expect(() => listed([selection14], { pickCustody: [] })).toThrow(refused);
    expect(() =>
      createAflTradeExternalReconciliationCandidate({
        ...content,
        pickLineageDeferral: {
          decisionId,
          promotedDrafts: [{ draftYear: 2025, draftType: 'national' }],
          rekeyedSelectionIds: [selection14],
        },
      })
    ).toThrow(refused);
    expect(() => listed([])).toThrow();
  });
});
