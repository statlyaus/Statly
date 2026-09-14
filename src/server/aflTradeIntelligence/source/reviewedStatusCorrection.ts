import { canonicalizeAflTradeJson as canonical } from '../artifacts/contentAddress';
import {
  createAflTradeExternalReconciliationCandidate,
  parseAflTradeExternalReconciliationCandidate,
} from './externalReconciliationCandidateContracts';

/** Pure reconstruction; the persistence owner must authenticate the exact parent and its dependencies. */
export function buildReviewedStatusCorrection(input: unknown) {
  const parent = parseAflTradeExternalReconciliationCandidate(input);
  const content = structuredClone(parent.content);
  if (content.environment === 'production' || !content.reviewedSessionCorrection ||
      !content.reviewedCorrection || content.reviewedStatusCorrection || content.issues.length)
    throw new TypeError('Status correction requires an issue-free private reviewed session parent.');
  const usable = (status: string) => status === 'single_source' || status === 'corroborated';
  const transactionIds: string[] = [], selectionIds: string[] = [];
  for (const transaction of content.transactions) {
    const legs = content.transfers.filter(leg => leg.transactionId === transaction.transactionId);
    if (transaction.status === 'disputed' || transaction.parties.length < 2 || !legs.length ||
        canonical(legs.map(leg => leg.transferId).sort()) !== canonical(transaction.transferIds) ||
        legs.some(leg => !usable(leg.status) || !leg.fromClubId || !leg.toClubId ||
          leg.fromClubId === leg.toClubId || !transaction.parties.includes(leg.fromClubId) ||
          !transaction.parties.includes(leg.toClubId) ||
          (leg.asset.kind === 'player' && !leg.asset.playerId)))
      throw new TypeError('Status correction requires complete resolved transaction legs and parties.');
    if (transaction.status === 'unresolved') {
      transaction.status = 'single_source'; transactionIds.push(transaction.transactionId);
    }
  }
  const sessions: Array<{ selectionIds: string[]; draftYear: number; draftType: string; evidenceIds: string[] }> = [];
  for (const proof of content.reviewedSessionCorrection.projections) sessions.push(...proof.selectedSessions);
  for (const selection of content.draftSelections) {
    const matching = sessions.filter(session => session.selectionIds.includes(selection.selectionId));
    if (selection.status === 'disputed' || !selection.playerId || !selection.clubId || matching.length !== 1 ||
        matching[0]!.draftYear !== selection.draftYear || matching[0]!.draftType !== selection.draftType ||
        matching[0]!.evidenceIds.some(id => !selection.evidenceIds.includes(id)))
      throw new TypeError('Status correction requires exact resolved completed-selection evidence.');
    const custody = content.pickCustody.filter(row => row.draftYear === selection.draftYear &&
      row.draftType === selection.draftType && row.recordedPickNumber === selection.selectionNumber);
    if (custody.some(row => !usable(row.status)))
      throw new TypeError('Status correction cannot hide unresolved ordinary custody.');
    if (selection.status === 'unresolved') {
      // Completion proves recruitment only; this adds no custody, entitlement exercise or corroboration.
      selection.status = 'single_source'; selectionIds.push(selection.selectionId);
    }
  }
  if (!transactionIds.length && !selectionIds.length) throw new TypeError('No unresolved factual statuses to reconcile.');
  content.reviewedStatusCorrection = {
    schemaVersion: 'afl-trade-reviewed-status-correction/v1', parentCandidateId: parent.candidateId,
    transactionIds: transactionIds.sort(), selectionIds: selectionIds.sort(),
  };
  return createAflTradeExternalReconciliationCandidate(content);
}
