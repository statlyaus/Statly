import {
  canonicalizeAflTradeJson as canonical,
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '../artifacts/contentAddress';
import {
  createAflTradeExternalReconciliationCandidate,
  parseAflTradeExternalReconciliationCandidate,
} from './externalReconciliationCandidateContracts';
import { parseAflTradeExternalEvidenceBatch } from './externalDraftTradeEvidenceContracts';
import {
  combinedDraftDocumentId,
  parseAflTradeExternalIdentityResolution,
} from './externalEvidenceReconciliation';
import { createAflTradeHistoricalCompletionReconciliationAuthority } from './externalReconciliationSourceAuthorityContracts';
import {
  projectCombinedDraftSessionEvidence,
  projectReportedDraftSessionEvidence,
  type CombinedDraftSessionFact,
} from './combinedDraftSessionEvidence';
import {
  assertReviewedSessionProjectionExtension,
  retainedDraftSessionProjectionSchema,
} from './reviewedSessionCorrectionContracts';

/** Deterministic construction only. Persistence must authenticate parent, source and identity decisions. */
export function buildReviewedSessionCorrection(input: {
  candidate: unknown;
  sourceAuthority: Parameters<typeof createAflTradeHistoricalCompletionReconciliationAuthority>[0];
  sourceBatches: readonly unknown[];
  identityResolutions: readonly unknown[];
}) {
  const parent = parseAflTradeExternalReconciliationCandidate(input.candidate);
  if (
    !parent.content.reviewedScope ||
    !parent.content.reviewedCorrection ||
    parent.content.environment === 'production'
  )
    throw new TypeError('Session correction requires an unchanged private reviewed parent.');
  const authority = createAflTradeHistoricalCompletionReconciliationAuthority(
    input.sourceAuthority
  );
  const batches = input.sourceBatches.map(parseAflTradeExternalEvidenceBatch),
    completionIds = batches.map((b) => b.batchId),
    ids = [...completionIds].sort();
  if (
    new Set(ids).size !== ids.length ||
    parent.content.sourceBatchIds.some((id) => !ids.includes(id)) ||
    authority.candidateSourceBatchSetSha256 !== sha256AflTradeCanonicalJson(ids) ||
    authority.completionSourceBatchSetSha256 !== sha256AflTradeCanonicalJson(completionIds)
  )
    throw new TypeError('Session correction requires its complete extended source set.');
  const sessionKinds = new Set([
    'draft_session',
    'draft_session_date',
    'draft_session_completion',
    'draft_session_boundary',
    'draft_completed_total',
  ]);
  const added = batches.filter((b) => !parent.content.sourceBatchIds.includes(b.batchId));
  if (
    !added.length ||
    added.some(
      (b) =>
        !b.content.evidence.length ||
        b.content.evidence.some((e) => !sessionKinds.has(e.content.claim.kind))
    )
  )
    throw new TypeError('Session source extension may add only retained session claims.');
  const resolutions = input.identityResolutions.map(parseAflTradeExternalIdentityResolution);
  const resolutionIds = resolutions.map((r) => r.resolutionId).sort();
  if (
    new Set(resolutionIds).size !== resolutionIds.length ||
    parent.content.identityResolutionIds.some((id) => !resolutionIds.includes(id))
  )
    throw new TypeError('Session correction must preserve ancestor identity resolutions.');
  const key = (
    provider: string,
    kind: string,
    entity: { nativeId: string | null; recordedName: string }
  ) => [provider, kind, entity.nativeId ?? '', entity.recordedName].join('\0');
  const lookup = new Map<string, string>();
  for (const r of resolutions) {
    const c = r.content,
      k = key(c.provider, c.entityKind, c.sourceIdentity);
    if (lookup.has(k) && lookup.get(k) !== c.canonicalId)
      throw new TypeError('Conflicting session identities.');
    lookup.set(k, c.canonicalId);
  }
  const evidence = batches.flatMap((b) => b.content.evidence);
  const groupKey = (year: number, type: string) => `${year}|${type}`;
  const selectedGroups = new Set(
    parent.content.draftSelections.map((s) => groupKey(s.draftYear, s.draftType))
  );
  const claims = evidence.filter((e) => sessionKinds.has(e.content.claim.kind));
  const groups = [
    ...new Set(
      claims.flatMap((e) => {
        const c = e.content.claim;
        return 'draftYear' in c &&
          c.draftYear !== null &&
          'draftType' in c &&
          c.draftType !== null &&
          selectedGroups.has(groupKey(c.draftYear, c.draftType))
          ? [groupKey(c.draftYear, c.draftType)]
          : [];
      })
    ),
  ].sort();
  if (!groups.length)
    throw new TypeError('Session correction has no relevant retained session evidence.');
  const projections = groups.map((group) => {
    const [yearText, draftType] = group.split('|'),
      draftYear = Number(yearText);
    const rows = evidence.filter(
      (e) =>
        e.content.claim.kind === 'draft_selection' &&
        e.content.claim.draftYear === draftYear &&
        e.content.claim.draftType === draftType
    );
    const byNumber = new Map<number, (typeof rows)[number]>();
    for (const row of rows) {
      const c = row.content.claim;
      if (c.kind !== 'draft_selection') throw new TypeError('Invalid inventory row.');
      const prior = byNumber.get(c.selectionNumber);
      if (prior && canonical(prior.content.claim) !== canonical(c))
        throw new TypeError('Conflicting retained draft inventory.');
      byNumber.set(c.selectionNumber, row);
    }
    const inventory = [...byNumber.values()].map((row) => {
      const c = row.content.claim;
      if (c.kind !== 'draft_selection') throw new TypeError('Invalid inventory row.');
      return {
        selectionId: createAflTradeContentAddress('external-draft-selection', {
          draftYear,
          draftType,
          selectionNumber: c.selectionNumber,
        }),
        selectionNumber: c.selectionNumber,
        playerId: lookup.get(key(row.content.provider, 'player', c.player)) ?? '',
        clubId: lookup.get(key(row.content.provider, 'club', c.selectedByClub)) ?? '',
      };
    });
    const selected = parent.content.draftSelections.filter(
      (s) => groupKey(s.draftYear, s.draftType) === group
    );
    const scoped = claims.filter((e) => {
      const c = e.content.claim;
      return (
        'draftYear' in c &&
        'draftType' in c &&
        c.draftYear === draftYear &&
        c.draftType === draftType
      );
    });
    const common = {
      draftYear,
      draftType: draftType!,
      selections: inventory,
      selectedSelectionIds: selected.map((s) => s.selectionId),
    };
    if (scoped.every((e) => e.content.claim.kind === 'draft_session'))
      return retainedDraftSessionProjectionSchema.parse(
        projectReportedDraftSessionEvidence({
          ...common,
          sessions: scoped.map((e) => {
            const c = e.content.claim;
            if (c.kind !== 'draft_session') throw new TypeError('Invalid direct session.');
            return { ...c, evidenceIds: [e.evidenceId] };
          }),
        })
      );
    if (scoped.some((e) => e.content.claim.kind === 'draft_session'))
      throw new TypeError('A draft cannot mix direct and partial session claims.');
    const facts: CombinedDraftSessionFact[] = scoped.map((e) => {
      const c = e.content.claim,
        source = {
          evidenceId: e.evidenceId,
          captureId: e.content.capture.captureId,
          artifactId: e.content.capture.artifactId,
          documentId: combinedDraftDocumentId(
            e.content.provider,
            e.content.capture.sourceUrl,
            parent.content.environment
          ),
        };
      if (c.kind === 'draft_session_date')
        return {
          ...source,
          kind: 'completed_session_date',
          sessionOrdinal: c.sessionOrdinal,
          eventDate: c.eventDate,
        };
      if (c.kind === 'draft_session_completion')
        return { ...source, kind: 'completed_session', sessionOrdinal: c.sessionOrdinal };
      if (c.kind === 'draft_completed_total')
        return { ...source, kind: 'completed_draft_total', selectionCount: c.selectionCount };
      if (c.kind !== 'draft_session_boundary')
        throw new TypeError('Invalid partial session claim.');
      return {
        ...source,
        kind: 'session_boundary',
        sessionOrdinal: c.sessionOrdinal,
        boundary: c.boundary,
        selectionNumber: c.selectionNumber,
        playerId: lookup.get(key(e.content.provider, 'player', c.player)) ?? '',
        clubId: lookup.get(key(e.content.provider, 'club', c.selectedByClub)) ?? '',
      };
    });
    return retainedDraftSessionProjectionSchema.parse(
      projectCombinedDraftSessionEvidence({
        ...common,
        officialName: `${draftYear} AFL Draft`,
        facts,
      })
    );
  });
  assertReviewedSessionProjectionExtension(parent.content.reviewedSessionCorrection, projections);
  const content = structuredClone(parent.content);
  for (const projection of projections)
    for (const session of projection.selectedSessions)
      for (const id of session.selectionIds) {
        const selection = content.draftSelections.find((s) => s.selectionId === id)!;
        selection.evidenceIds = [
          ...new Set([...selection.evidenceIds, ...session.evidenceIds]),
        ].sort();
      }
  const allRows = (c: typeof content) => [
    ...c.transactions,
    ...c.transfers,
    ...c.draftSelections,
    ...c.pickCustody,
    ...c.pickLineage,
    ...c.issues,
  ];
  const known = new Set([
    ...allRows(parent.content).flatMap((r) => r.evidenceIds),
    ...parent.content.reviewedScope.deferredEvidenceIds,
    ...added.flatMap((b) => b.content.evidence.map((e) => e.evidenceId)),
  ]);
  const active = new Set(allRows(content).flatMap((r) => r.evidenceIds));
  if ([...active].some((id) => !known.has(id)))
    throw new TypeError('Session correction introduced evidence outside its source extension.');
  content.reviewedScope!.deferredEvidenceIds = [...known].filter((id) => !active.has(id)).sort();
  content.sourceBatchIds = ids;
  content.sourceAuthority = authority;
  content.identityResolutionIds = resolutionIds;
  content.reconciledAt = [
    parent.content.reconciledAt,
    authority.completedAt,
    ...resolutions.map((r) => r.content.decidedAt),
  ]
    .sort((a, b) => Date.parse(a) - Date.parse(b))
    .at(-1)!;
  content.reviewedSessionCorrection = {
    schemaVersion: 'afl-trade-reviewed-session-correction/v1',
    parentCandidateId: parent.candidateId,
    sourceCompletionId: authority.completionId,
    projections,
  };
  return {
    candidate: createAflTradeExternalReconciliationCandidate(content),
    persisted: false as const,
    canonicalAdmission: false as const,
  };
}
