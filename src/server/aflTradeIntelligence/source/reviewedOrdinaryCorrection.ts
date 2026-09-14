import { createAflTradeContentAddress } from '../artifacts/contentAddress';
import {
  createAflTradeExternalReconciliationCandidate,
  parseAflTradeExternalReconciliationCandidate,
} from './externalReconciliationCandidateContracts';
import { reviewedPickLineageRegistrationSchema } from './reviewedPickLineageRegistrationContracts';
import { buildReviewedLineageCorrectionGraph } from './reviewedLineageCorrectionGraph';

export interface ReviewedMovementEvidence {
  transferId: string;
  artifactId: string;
  sourceUrl: string;
  nativeEventId: string;
  fromClubId: string;
  toClubId: string;
  retainedAssetLabel: string;
  evidenceId: string;
}

type Candidate = ReturnType<typeof parseAflTradeExternalReconciliationCandidate>;
type Registration = ReturnType<typeof reviewedPickLineageRegistrationSchema.parse>;
type Graph = ReturnType<typeof buildReviewedLineageCorrectionGraph>;
type Movement = Graph['content']['movements'][number];
type Chain = Graph['content']['chains'][number];
type Transfer = Candidate['content']['transfers'][number];
const evidence = (ids: readonly string[]) => [...new Set(ids)].sort();

function assertOrdinaryParent(
  parent: Candidate,
  registration: Registration
): asserts parent is Candidate & {
  content: { reviewedScope: NonNullable<Candidate['content']['reviewedScope']> };
} {
  if (
    !parent.content.reviewedScope ||
    parent.content.reviewedCorrection ||
    parent.content.pickCustody.length ||
    parent.content.pickLineage.length ||
    parent.content.reviewedScope.registrationId !== registration.registrationId ||
    parent.content.environment !== registration.content.environment
  )
    throw new TypeError('Ordinary correction requires the exact registered pre-correction scope.');
}

function movementEvidenceIds(
  movement: Movement,
  movementEvidence: readonly ReviewedMovementEvidence[],
  byTransfer: Map<string, Transfer>
) {
  let ids: string[];
  if (movement.source) {
    // HTML row references remain in the registration. Parsed claim ordinals are a different coordinate system.
    const source = movement.source;
    ids = evidence(
      movementEvidence
        .filter(
          (row) =>
            row.artifactId === source.artifact.artifactId &&
            row.sourceUrl === source.sourceUrl &&
            row.nativeEventId === source.nativeEventId &&
            row.fromClubId === movement.fromClubId &&
            row.toClubId === movement.toClubId &&
            (movement.transferIds.includes(row.transferId) ||
              row.retainedAssetLabel === source.retainedAssetLabel)
        )
        .map((row) => row.evidenceId)
    );
    if (ids.length !== 1)
      throw new TypeError(
        'Movement requires one exact retained evidence transfer for its source, clubs and asset.'
      );
  } else {
    ids = movement.transferIds.flatMap(
      (transferId) => byTransfer.get(transferId)?.evidenceIds ?? []
    );
    if (!ids.length)
      throw new TypeError('Registered movement requires original transfer evidence.');
  }
  return ids;
}

function recordedMovementPick(
  movement: Movement,
  records: Map<string, Registration['content']['records'][number]>
) {
  const rootRecords = movement.transferIds.flatMap((transferId) =>
    records.has(transferId) ? [records.get(transferId)!] : []
  );
  const reviewedPicks = new Set(
    rootRecords.flatMap((r) => (r.acceptedTradeTimePick === null ? [] : [r.acceptedTradeTimePick]))
  );
  if (reviewedPicks.size > 1)
    throw new TypeError('Shared movement has contradictory reviewed trade-time picks.');
  const label = movement.source?.retainedAssetLabel;
  const match = label?.match(/^Pick\s+(\d+)$/i);
  const recordedPickNumber = [...reviewedPicks][0] ?? (match ? Number(match[1]) : null);
  return recordedPickNumber;
}

function ordinaryCoordinates(
  chain: Chain,
  content: Candidate['content'],
  byTransfer: Map<string, Transfer>
) {
  const endpoint = chain.endpoint;
  const selected =
    endpoint.kind === 'selected'
      ? content.draftSelections.filter(
          (s) =>
            s.playerId === endpoint.playerId &&
            s.clubId === endpoint.exercisingClubId &&
            s.draftYear === endpoint.draftYear &&
            s.draftType === endpoint.draftType &&
            s.selectionNumber === endpoint.livePick
        )
      : [];
  if (chain.endpoint.kind === 'selected' && selected.length !== 1)
    throw new TypeError('Reviewed ordinary endpoint must match one scoped selection.');
  const selection = selected[0];
  const first = byTransfer.get(chain.transferIds[0])!;
  if (first.asset.kind !== 'pick_entitlement')
    throw new TypeError('Special rights require their dedicated correction owner.');
  const pickId = selection?.pickId ?? first.asset.pickId;
  const draftYear =
    chain.endpoint.kind === 'incorporated_into_later_package'
      ? first.asset.draftYear
      : chain.endpoint.draftYear;
  const draftType =
    chain.endpoint.kind === 'incorporated_into_later_package'
      ? first.asset.draftType
      : chain.endpoint.draftType;
  if (draftYear === null || draftType === null)
    throw new TypeError('Ordinary correction requires known draft coordinates.');
  return { selection, pickId, draftYear, draftType };
}

function applyOrdinaryLineage(
  content: Candidate['content'],
  chain: Chain,
  coordinates: ReturnType<typeof ordinaryCoordinates>,
  registration: Registration,
  records: Map<string, Registration['content']['records'][number]>,
  custodyIds: string[]
) {
  const { selection, pickId, draftYear, draftType } = coordinates;
  const bindings: { transferId: string; lineageId: string; custodyIds: string[] }[] = [];
  for (const transferId of chain.transferIds) {
    const transfer = content.transfers.find((t) => t.transferId === transferId)!;
    if (transfer.asset.kind !== 'pick_entitlement')
      throw new TypeError('Ordinary correction cannot relabel special rights.');
    const record = records.get(transferId)!;
    transfer.asset = {
      ...transfer.asset,
      pickId,
      draftYear,
      draftType,
      nominalPick: record.acceptedTradeTimePick ?? transfer.asset.nominalPick,
      originalClubId: chain.originalClubId,
    };
    transfer.status = 'single_source';
    const terminalOutcome =
      chain.endpoint.kind === 'selected' || chain.endpoint.kind === 'rookie_elevation'
        ? undefined
        : chain.endpoint;
    const lineageId = createAflTradeContentAddress('external-pick-lineage', {
      registrationId: registration.registrationId,
      transferId,
      pickId,
      selectionId: selection?.selectionId ?? null,
      ...(terminalOutcome ? { terminalOutcome } : {}),
    });
    content.pickLineage.push({
      lineageId,
      pickId,
      transferId,
      selectionId: selection?.selectionId ?? null,
      ...(terminalOutcome ? { terminalOutcome } : {}),
      status: 'single_source',
      evidenceIds: evidence([
        ...transfer.evidenceIds,
        ...(selection?.evidenceIds ?? []),
        ...content.pickCustody
          .filter((c) => custodyIds.includes(c.custodyId))
          .flatMap((c) => c.evidenceIds),
      ]),
    });
    bindings.push({ transferId, lineageId, custodyIds });
  }
  return bindings;
}

/** Materialize ordinary histories only. Special-right chains and rookie elevation stay blocking. */
export function buildReviewedOrdinaryCorrection(input: {
  scopeCandidate: unknown;
  registration: unknown;
  movementEvidence: readonly ReviewedMovementEvidence[];
}) {
  const parent = parseAflTradeExternalReconciliationCandidate(input.scopeCandidate);
  const registration = reviewedPickLineageRegistrationSchema.parse(input.registration);
  assertOrdinaryParent(parent, registration);
  const graph = buildReviewedLineageCorrectionGraph(registration.content.records);
  const byTransfer = new Map(parent.content.transfers.map((t) => [t.transferId, t]));
  const records = new Map(registration.content.records.map((r) => [r.transferId, r]));
  const eligible = graph.content.chains.filter(
    (chain) =>
      chain.endpoint.kind !== 'rookie_elevation' &&
      chain.transferIds.every((id) => byTransfer.get(id)?.asset.kind === 'pick_entitlement')
  );
  const content = structuredClone(parent.content);
  const appliedTransferIds: string[] = [];
  const bindings: { transferId: string; lineageId: string; custodyIds: string[] }[] = [];
  for (const chain of eligible) {
    // A shared ordinary history is supported, but every movement is persisted once for its stable pick.
    const { selection, pickId, draftYear, draftType } = ordinaryCoordinates(
      chain,
      content,
      byTransfer
    );
    const custodyIds = chain.movementIds.map((movementId) =>
      createAflTradeContentAddress('external-pick-custody', {
        correctionGraphId: graph.correctionGraphId,
        movementId,
        pickId,
      })
    );
    chain.movementIds.forEach((id, index) => {
      const movement = graph.content.movements.find((m) => m.movementId === id)!;
      const ids = movementEvidenceIds(movement, input.movementEvidence, byTransfer);
      const recordedPickNumber = recordedMovementPick(movement, records);
      content.pickCustody.push({
        custodyId: custodyIds[index],
        pickId,
        observedAt: movement.occurredAt,
        predecessorCustodyId: index === 0 ? null : custodyIds[index - 1],
        draftYear,
        draftType,
        roundNumber: null,
        recordedPickNumber,
        originalClubId: chain.originalClubId,
        currentClubId: movement.toClubId,
        status: 'single_source',
        evidenceIds: evidence(ids),
      });
    });
    if (selection)
      selection.status = selection.status === 'corroborated' ? 'corroborated' : 'single_source';
    const chainBindings = applyOrdinaryLineage(
      content,
      chain,
      { selection, pickId, draftYear, draftType },
      registration,
      records,
      custodyIds
    );
    appliedTransferIds.push(...chainBindings.map((binding) => binding.transferId));
    bindings.push(...chainBindings);
  }
  const applied = new Set(appliedTransferIds);
  content.issues = content.issues.filter(
    (issue) =>
      issue.code !== 'lineage_unresolved' ||
      !issue.subjectKey.startsWith('lineage:') ||
      !applied.has(issue.subjectKey.slice('lineage:'.length))
  );
  content.pickCustody.sort((a, b) => a.custodyId.localeCompare(b.custodyId));
  content.pickLineage.sort((a, b) => a.lineageId.localeCompare(b.lineageId));
  const active = new Set(
    [
      ...content.transactions,
      ...content.transfers,
      ...content.draftSelections,
      ...content.pickCustody,
      ...content.pickLineage,
      ...content.issues,
    ].flatMap((r) => r.evidenceIds)
  );
  const originalEvidence = new Set(
    [
      ...parent.content.transactions,
      ...parent.content.transfers,
      ...parent.content.draftSelections,
      ...parent.content.issues,
    ].flatMap((r) => r.evidenceIds)
  );
  for (const id of parent.content.reviewedScope.deferredEvidenceIds) originalEvidence.add(id);
  for (const id of active)
    if (!originalEvidence.has(id))
      throw new TypeError('Correction evidence must belong to the scoped retained source set.');
  content.reviewedScope!.deferredEvidenceIds = [...originalEvidence]
    .filter((id) => !active.has(id))
    .sort();
  content.reviewedCorrection = {
    schemaVersion: 'afl-trade-reviewed-ordinary-correction/v1',
    scopeCandidateId: parent.candidateId,
    registrationId: registration.registrationId,
    correctionGraphId: graph.correctionGraphId,
    bindings: bindings.sort((a, b) => a.transferId.localeCompare(b.transferId)),
  };
  const candidate = createAflTradeExternalReconciliationCandidate(content);
  const pendingTransferIds = registration.content.records
    .map((r) => r.transferId)
    .filter((id) => !applied.has(id))
    .sort();
  return {
    candidate,
    appliedTransferIds: appliedTransferIds.sort(),
    pendingTransferIds,
    canonicalAdmission: false as const,
    persisted: false as const,
  };
}
