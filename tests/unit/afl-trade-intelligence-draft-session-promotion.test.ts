import { expect, it } from 'vitest';
import { createAflTradeExternalCanonicalPromotionProposal } from '@/server/aflTradeIntelligence/source/externalCanonicalPromotionContracts';

const selection = (value: string) => `external-draft-selection:${value.repeat(64)}`;
const evidence = (value: string) => `external-evidence:${value.repeat(64)}`;
const content = {
  schemaVersion: 'afl-trade-external-canonical-promotion-proposal/v2' as const,
  candidateId: `external-reconciliation:${'a'.repeat(64)}`,
  candidateSha256: 'a'.repeat(64),
  environment: 'test_fixture' as const,
  competition: 'AFLM',
  anchorSeasonYear: 2024,
  draftEventCoverage: [
    {
      draftYear: 2024,
      draftType: 'national',
      sessionOrdinal: 1,
      eventDate: '2024-11-20',
      officialName: 'Synthetic national draft first session',
      expectedSelectionCount: 1,
      selectionIds: [selection('1')],
      evidenceIds: [evidence('1')],
      status: 'complete' as const,
    },
    {
      draftYear: 2024,
      draftType: 'national',
      sessionOrdinal: 2,
      eventDate: '2024-11-21',
      officialName: 'Synthetic national draft second session',
      expectedSelectionCount: 1,
      selectionIds: [selection('2')],
      evidenceIds: [evidence('2')],
      status: 'complete' as const,
    },
  ],
  transactionDateCoverage: [],
  proposedAt: '2024-11-22T00:00:00.000Z',
  publicationEligible: false as const,
};

it('preserves distinct exact dates and membership for two sessions of one draft', () => {
  const proposal = createAflTradeExternalCanonicalPromotionProposal(content);
  expect(proposal.content.draftEventCoverage.map(({ eventDate }) => eventDate)).toEqual([
    '2024-11-20',
    '2024-11-21',
  ]);
});

it('marks combined-proof coverage with an explicit version that cannot masquerade as v2', () => {
  const proposal = createAflTradeExternalCanonicalPromotionProposal({
    ...content,
    schemaVersion: 'afl-trade-external-canonical-promotion-proposal/v3',
    draftEventCoverage: content.draftEventCoverage.map((coverage) => ({
      ...coverage,
      proofKind: 'combined_session_facts' as const,
      evidenceIds: [evidence('1'), evidence('2'), evidence('3')],
    })),
  });

  expect(proposal.content.schemaVersion).toBe(
    'afl-trade-external-canonical-promotion-proposal/v3'
  );
  expect(proposal.content.draftEventCoverage).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ proofKind: 'combined_session_facts' }),
    ])
  );
});

it('rejects repeated selections, absent session evidence and nonchronological sessions', () => {
  for (const second of [
    { ...content.draftEventCoverage[1]!, selectionIds: [selection('1')] },
    { ...content.draftEventCoverage[1]!, evidenceIds: [] },
    { ...content.draftEventCoverage[1]!, eventDate: '2024-11-19' },
    { ...content.draftEventCoverage[1]!, sessionOrdinal: 3 },
  ]) {
    expect(() =>
      createAflTradeExternalCanonicalPromotionProposal({
        ...content,
        draftEventCoverage: [content.draftEventCoverage[0]!, second],
      })
    ).toThrow();
  }
});

it('retains explicit session dates and selection numbers as official source evidence', async () => {
  const { createAflTradeExternalEvidenceEnvelope } =
    await import('@/server/aflTradeIntelligence/source/externalDraftTradeEvidenceContracts');
  const row = createAflTradeExternalEvidenceEnvelope({
    schemaVersion: 'afl-trade-external-evidence/v1',
    provider: 'official_afl',
    capture: {
      captureId: `source-capture:${'b'.repeat(64)}`,
      artifactId: `artifact:${'c'.repeat(64)}`,
      contentSha256: 'c'.repeat(64),
      mediaType: 'text/html',
      sourceUrl: 'https://www.afl.com.au/news/1257674/synthetic-fixture',
      capturedAt: '2024-11-22T00:00:00.000Z',
      effectiveAt: '2024-11-21T00:00:00.000Z',
      parserVersion: 'synthetic-session/v1',
      fieldManifestSha256: 'd'.repeat(64),
    },
    sourceRow: { ordinal: 1, sourceKey: '2024-national-session-2' },
    claim: {
      kind: 'draft_session',
      draftYear: 2024,
      draftType: 'national',
      sessionOrdinal: 2,
      eventDate: '2024-11-21',
      officialName: 'Synthetic second session',
      selectionNumbers: [30],
    },
    publicationEligible: false,
  });
  expect(row.content.claim).toMatchObject({ eventDate: '2024-11-21', selectionNumbers: [30] });
});
