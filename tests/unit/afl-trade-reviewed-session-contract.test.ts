import { expect, it } from 'vitest';
import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { projectReportedDraftSessionEvidence } from '@/server/aflTradeIntelligence/source/combinedDraftSessionEvidence';
import {
  assertReviewedSessionProjectionExtension,
  retainedDraftSessionProjectionSchema,
  reviewedSessionCorrectionSchema,
} from '@/server/aflTradeIntelligence/source/reviewedSessionCorrectionContracts';
const id = (prefix: string, n: number) => createAflTradeContentAddress(prefix, { n });
function proof() {
  return projectReportedDraftSessionEvidence({
    draftYear: 2021,
    draftType: 'national',
    selections: [1, 2].map((n) => ({
      selectionNumber: n,
      selectionId: id('external-draft-selection', n),
    })),
    selectedSelectionIds: [id('external-draft-selection', 2)],
    sessions: [1, 2].map((n) => ({
      sessionOrdinal: n,
      eventDate: `2021-11-${23 + n}`,
      officialName: 'AFL Draft',
      selectionNumbers: [n],
      evidenceIds: [id('external-evidence', n)],
    })),
  });
}
it('accepts a later-only selected session with complete source inventory', () => {
  const p = proof();
  expect(retainedDraftSessionProjectionSchema.parse(p)).toEqual(p);
  expect(p.selectedSessions[0]!.sessionOrdinal).toBe(2);
});
it('rejects removed, duplicated and substituted inventory membership', () => {
  for (const mutate of [
    (p: ReturnType<typeof proof>) => {
      p.inventorySelectionIds.pop();
    },
    (p: ReturnType<typeof proof>) => {
      p.inventorySessions[0]!.selectionIds = [...p.inventorySessions[1]!.selectionIds];
    },
    (p: ReturnType<typeof proof>) => {
      p.selectedSessions[0]!.selectionIds = [id('external-draft-selection', 3)];
    },
    (p: ReturnType<typeof proof>) => {
      p.selectedSessions[0]!.sessionOrdinal = 1;
    },
    (p: ReturnType<typeof proof>) => {
      p.selectedSessions[0]!.evidenceIds = [id('external-evidence', 3)];
    },
    (p: ReturnType<typeof proof>) => {
      p.inventorySessions[0]!.eventDate = '2021-12-31';
    },
  ]) {
    const p = proof();
    mutate(p);
    expect(retainedDraftSessionProjectionSchema.safeParse(p).success).toBe(false);
  }
});
it('rejects duplicated draft groups in a versioned correction', () => {
  const p = proof();
  const marker = {
    schemaVersion: 'afl-trade-reviewed-session-correction/v1',
    parentCandidateId: id('external-reconciliation', 1),
    sourceCompletionId: id('external-historical-capture-completion', 1),
    projections: [p],
  };
  expect(reviewedSessionCorrectionSchema.safeParse(marker).success).toBe(true);
  expect(
    reviewedSessionCorrectionSchema.safeParse({ ...marker, projections: [p, p] }).success
  ).toBe(false);
});

it('extends session coverage while preserving each prior proof exactly', () => {
  const prior = proof();
  const marker = reviewedSessionCorrectionSchema.parse({
    schemaVersion: 'afl-trade-reviewed-session-correction/v1',
    parentCandidateId: id('external-reconciliation', 1),
    sourceCompletionId: id('external-historical-capture-completion', 1),
    projections: [prior],
  });
  const added = structuredClone(prior);
  for (const session of [...added.inventorySessions, ...added.selectedSessions]) {
    session.draftYear = 2022;
    session.eventDate = session.eventDate.replace('2021', '2022');
  }
  expect(() => assertReviewedSessionProjectionExtension(marker, [prior, added])).not.toThrow();
  expect(() => assertReviewedSessionProjectionExtension(marker, [prior])).toThrow(/add groups/);
  const changed = structuredClone(prior);
  changed.inventorySessions[0]!.officialName = 'Altered prior proof';
  expect(() => assertReviewedSessionProjectionExtension(marker, [changed, added])).toThrow(
    /preserve/
  );
  expect(() => assertReviewedSessionProjectionExtension(marker, [added, added])).toThrow(
    /preserve/
  );
});
