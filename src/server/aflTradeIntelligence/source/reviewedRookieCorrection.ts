import { createAflTradeContentAddress } from '../artifacts/contentAddress';
import { createAflTradeExternalReconciliationCandidate, parseAflTradeExternalReconciliationCandidate } from './externalReconciliationCandidateContracts';
import { buildReviewedLineageCorrectionGraph } from './reviewedLineageCorrectionGraph';
import type { ReviewedMovementEvidence } from './reviewedOrdinaryCorrection';
import { reviewedPickLineageRegistrationSchema } from './reviewedPickLineageRegistrationContracts';
import { rookieElevationOutcomeSchema } from './pickTerminalOutcome';

/** Pure successor construction; current parent/review/source authentication belongs to persistence. */
export function buildReviewedRookieCorrection(input: {
  candidate: unknown;
  registration: unknown;
  movementEvidence: readonly ReviewedMovementEvidence[];
}) {
  const parent = parseAflTradeExternalReconciliationCandidate(input.candidate);
  const registration = reviewedPickLineageRegistrationSchema.parse(input.registration);
  const graph = buildReviewedLineageCorrectionGraph(registration.content.records);
  if (!parent.content.reviewedScope || !parent.content.reviewedCorrection ||
    parent.content.reviewedRookieCorrection || parent.content.environment === 'production' ||
    parent.content.environment !== registration.content.environment ||
    parent.content.reviewedCorrection.registrationId !== registration.registrationId ||
    parent.content.reviewedCorrection.correctionGraphId !== graph.correctionGraphId)
    throw new TypeError('Rookie correction requires its unchanged private reviewed parent and registration.');
  const content = structuredClone(parent.content);
  const records = new Map(registration.content.records.map(record => [record.transferId, record]));
  const bindings: {transferId: string; lineageId: string; custodyIds: string[]}[] = [];
  const unique = (ids: readonly string[]) => [...new Set(ids)].sort();
  for (const chain of graph.content.chains.filter(chain => chain.endpoint.kind === 'rookie_elevation')) {
    const endpoint = rookieElevationOutcomeSchema.parse(chain.endpoint);
    const transfers = chain.transferIds.map(id => content.transfers.find(transfer => transfer.transferId === id));
    if (transfers.some(transfer => !transfer || transfer.asset.kind !== 'pick_entitlement') || !transfers.length)
      throw new TypeError('Rookie history requires every exact retained ordinary transfer.');
    const first = transfers[0]!;
    if (first.asset.kind !== 'pick_entitlement') throw new TypeError('Rookie history is not an ordinary pick.');
    const pickId = first.asset.pickId;
    if (content.pickCustody.some(row => row.pickId === pickId) ||
      content.pickLineage.some(row => chain.transferIds.includes(row.transferId)))
      throw new TypeError('Rookie history must not overwrite previously represented custody or endpoints.');
    const custodyIds = chain.movementIds.map(movementId => createAflTradeContentAddress('external-pick-custody', {
      correctionGraphId: graph.correctionGraphId, movementId, pickId,
    }));
    chain.movementIds.forEach((movementId, index) => {
      const movement = graph.content.movements.find(row => row.movementId === movementId)!;
      const source = movement.source;
      const evidenceIds = source ? unique(input.movementEvidence.filter(row =>
        row.artifactId === source.artifact.artifactId && row.sourceUrl === source.sourceUrl &&
        row.nativeEventId === source.nativeEventId && row.fromClubId === movement.fromClubId &&
        row.toClubId === movement.toClubId && (movement.transferIds.includes(row.transferId) ||
          row.retainedAssetLabel === source.retainedAssetLabel)).map(row => row.evidenceId)) :
        unique(movement.transferIds.flatMap(id => content.transfers.find(row => row.transferId === id)?.evidenceIds ?? []));
      if (!evidenceIds.length || (source && evidenceIds.length !== 1))
        throw new TypeError('Rookie custody requires exact retained movement evidence.');
      const picks = unique(movement.transferIds.flatMap(id => {
        const pick = records.get(id)?.acceptedTradeTimePick;
        return pick == null ? [] : [String(pick)];
      }));
      if (picks.length > 1) throw new TypeError('Rookie custody has contradictory trade-time numbering.');
      const labelPick = source?.retainedAssetLabel.match(/^Pick\s+(\d+)$/i);
      content.pickCustody.push({
        custodyId: custodyIds[index], pickId, observedAt: movement.occurredAt,
        predecessorCustodyId: index === 0 ? null : custodyIds[index - 1],
        draftYear: endpoint.draftYear, draftType: endpoint.draftType, roundNumber: null,
        recordedPickNumber: picks.length ? Number(picks[0]) : labelPick ? Number(labelPick[1]) : null,
        originalClubId: chain.originalClubId, currentClubId: movement.toClubId,
        status: 'single_source', evidenceIds,
      });
    });
    for (const transfer of transfers) {
      if (!transfer || transfer.asset.kind !== 'pick_entitlement') throw new TypeError('Missing rookie transfer.');
      const record = records.get(transfer.transferId);
      if (!record) throw new TypeError('Every rookie transfer requires a registered review.');
      transfer.asset = { ...transfer.asset, pickId, draftYear: endpoint.draftYear,
        draftType: endpoint.draftType, nominalPick: record.acceptedTradeTimePick ?? transfer.asset.nominalPick,
        originalClubId: chain.originalClubId };
      transfer.status = 'single_source';
      const lineageId = createAflTradeContentAddress('external-pick-lineage', {
        registrationId: registration.registrationId, transferId: transfer.transferId,
        pickId, selectionId: null, terminalOutcome: endpoint,
      });
      content.pickLineage.push({ lineageId, pickId, transferId: transfer.transferId, selectionId: null,
        terminalOutcome: endpoint, status: 'single_source', evidenceIds: unique([...transfer.evidenceIds,
          ...content.pickCustody.filter(row => custodyIds.includes(row.custodyId)).flatMap(row => row.evidenceIds)]) });
      bindings.push({ transferId: transfer.transferId, lineageId, custodyIds });
    }
  }
  if (!bindings.length) throw new TypeError('No registered rookie history remains to correct.');
  const applied = new Set(bindings.map(binding => binding.transferId));
  content.issues = content.issues.filter(issue => issue.code !== 'lineage_unresolved' ||
    !issue.subjectKey.startsWith('lineage:') || !applied.has(issue.subjectKey.slice('lineage:'.length)));
  content.pickCustody.sort((a,b) => a.custodyId.localeCompare(b.custodyId));
  content.pickLineage.sort((a,b) => a.lineageId.localeCompare(b.lineageId));
  const allRows = (value: typeof content) => [...value.transactions, ...value.transfers,
    ...value.draftSelections, ...value.pickCustody, ...value.pickLineage, ...value.issues];
  const known = new Set([...allRows(parent.content).flatMap(row => row.evidenceIds), ...parent.content.reviewedScope.deferredEvidenceIds]);
  const active = new Set(allRows(content).flatMap(row => row.evidenceIds));
  if ([...active].some(id => !known.has(id))) throw new TypeError('Rookie correction cannot introduce evidence outside its parent.');
  content.reviewedScope!.deferredEvidenceIds = [...known].filter(id => !active.has(id)).sort();
  content.reviewedRookieCorrection = {
    schemaVersion: 'afl-trade-reviewed-rookie-correction/v1', parentCandidateId: parent.candidateId,
    registrationId: registration.registrationId, correctionGraphId: graph.correctionGraphId,
    bindings: bindings.sort((a,b) => a.transferId.localeCompare(b.transferId)),
  };
  return { candidate: createAflTradeExternalReconciliationCandidate(content),
    appliedTransferIds: [...applied].sort(), persisted: false as const, canonicalAdmission: false as const };
}
