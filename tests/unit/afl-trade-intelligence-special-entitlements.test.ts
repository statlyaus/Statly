import { deriveAflTradeExternalCanonicalPromotionProposal } from '@/server/aflTradeIntelligence/source/externalCanonicalPromotionContracts';
import { describe, expect, it } from 'vitest';
import { parseDraftguruTradeDetail } from '@/server/aflTradeIntelligence/source/draftguruSourceAdapter';
import {
  createAflTradeExternalEvidenceBatch,
  AFL_TRADE_EXTERNAL_EVIDENCE_BATCH_SCHEMA_VERSION,
} from '@/server/aflTradeIntelligence/source/externalDraftTradeEvidenceContracts';
import { reconcileAflTradeExternalEvidence } from '@/server/aflTradeIntelligence/source/externalEvidenceReconciliation';
import { parseAflTradeExternalReconciliationCandidate } from '@/server/aflTradeIntelligence/source/externalReconciliationCandidateContracts';
import { parseSpecialDraftEntitlement } from '@/server/aflTradeIntelligence/source/specialDraftEntitlement';

const at = '2026-09-12T00:00:00.000Z';
function parse(year: number, labels: string[], paired = true) {
  const empty = '<td colspan="5"></td>';
  const side = (label: string) =>
    `<td class="future-pick-name actual-asset">${label}<br/><span class="pick-estimation">(estimate: pick 999)</span></td><td colspan="4" class="player-name">Future outcome must not be extracted</td>`;
  const html = `<h2 class="heading">Synthetic mixed entitlement trade</h2><table class="individual-trade"><tr class="club-header"><td>Club A</td></tr>${labels.map((label) => `<tr class="movement">${side(label)}${empty}</tr>`).join('')}<tr class="movement"><td class="pick-name actual-asset">Pick 10</td><td colspan="4"></td>${empty}</tr><tr class="club-header"><td>Club B</td></tr>${paired ? labels.map((label) => `<tr class="movement">${empty}${side(label)}</tr>`).join('') : ''}<tr class="movement">${empty}<td class="pick-name actual-asset">Pick 10</td><td colspan="4"></td></tr></table>`;
  const capture = {
    captureId: `source-capture:${'1'.repeat(64)}`,
    artifactId: `artifact:${'2'.repeat(64)}`,
    contentSha256: '2'.repeat(64),
    mediaType: 'text/html',
    sourceUrl: `https://www.draftguru.com.au/trades/${year}-synthetic`,
    capturedAt: at,
    effectiveAt: at,
    parserVersion: 'test',
    fieldManifestSha256: '3'.repeat(64),
  };
  return {
    capture,
    result: parseDraftguruTradeDetail(html, { capture, draftYear: year, effectiveAt: at }),
  };
}

describe('historical special draft entitlements', () => {
  it.each([
    [2011, 'M1', 'mini_draft', 2011],
    [2012, 'M2', 'mini_draft', 2012],
    [2010, 'CMP1 (Gary Ablett)', 'expansion_compensation', null],
    [2012, 'CMP2 (Gary Ablett)', 'expansion_compensation', null],
    [2011, 'CMP3 (Rhys Palmer)', 'expansion_compensation', null],
    [2019, '2020MIDR1 (Gold Coast concession)', 'assistance_concession', 2020],
  ] as const)(
    'preserves %s %s without estimates or invented exercise year',
    (year, label, type, draftYear) => {
      const { result } = parse(year, [label]);
      expect(result.issues).toEqual([]);
      const transfers = result.evidence.flatMap(({ content }) =>
        content.claim.kind === 'directed_transfer' ? [content.claim] : []
      );
      expect(transfers).toHaveLength(2);
      expect(transfers.find((t) => t.asset.kind === 'special_pick')?.asset).toMatchObject({
        entitlementType: type,
        draftYear,
        sourceLabel: label,
      });
      expect(JSON.stringify(result.evidence)).not.toMatch(/999|estimate|Future outcome/);
    }
  );

  it('keeps two Ablett components and national picks separate in one transaction', () => {
    const { result } = parse(2010, ['CMP1 (Gary Ablett)', 'CMP2 (Gary Ablett)']);
    expect(result.issues).toEqual([]);
    const ids = result.evidence.flatMap(({ content }) =>
      content.claim.kind === 'directed_transfer' ? [content.claim.nativeTransferId] : []
    );
    expect(new Set(ids).size).toBe(3);
  });

  it('does not conflate the same mini-draft ordinal in different years', () => {
    expect(parseSpecialDraftEntitlement('M1', 2011)).not.toEqual(
      parseSpecialDraftEntitlement('M1', 2012)
    );
  });

  it.each(['M3', 'CMP6 (Player)', '2021MIDR1 (Gold Coast concession)', 'M1 junk'])(
    'rejects unsupported labels: %s',
    (label) => {
      expect(parse(2011, [label]).result.issues.some((i) => i.code === 'unsupported_asset')).toBe(
        true
      );
    }
  );

  it('rejects mini-draft rights outside the supported historical events', () => {
    expect(parseSpecialDraftEntitlement('M1', 2025)).toBeNull();
  });

  it('retains one-sided special assets as pairing issues', () => {
    expect(parse(2011, ['M1'], false).result.issues.some((i) => i.code === 'unpaired_asset')).toBe(
      true
    );
  });

  it('preserves special facts in reconciliation while blocking unresolved lineage', () => {
    const { capture, result } = parse(2011, ['M2', 'CMP2 (Phil Davis)']);
    const batch = createAflTradeExternalEvidenceBatch({
      schemaVersion: AFL_TRADE_EXTERNAL_EVIDENCE_BATCH_SCHEMA_VERSION,
      provider: 'draftguru',
      captureId: capture.captureId,
      evidence: result.evidence,
      finalizedAt: at,
      publicationEligible: false,
    });
    const candidate = reconcileAflTradeExternalEvidence({
      environment: 'test_fixture',
      competition: 'AFLM',
      anchorSeasonYear: 2011,
      sourceBatches: [batch],
      identityResolutions: [],
      reconciledAt: at,
    });
    const preserved = parseAflTradeExternalReconciliationCandidate(candidate);
    const specials = preserved.content.transfers.filter((t) => t.asset.kind === 'special_pick');
    expect(() =>
      deriveAflTradeExternalCanonicalPromotionProposal({
        candidate: preserved,
        proposedAt: at,
        draftEvents: [],
        transactionDates: preserved.content.transactions.map((t) => ({
          transactionId: t.transactionId,
          occurredOn: '2011-10-01',
        })),
      })
    ).toThrow(/Special entitlement/);
    expect(specials).toHaveLength(2);
    expect(specials.every((t) => t.status === 'unresolved')).toBe(true);
    for (const transfer of specials)
      expect(
        preserved.content.issues.some(
          (i) =>
            i.code === 'lineage_unresolved' && i.subjectKey === `lineage:${transfer.transferId}`
        )
      ).toBe(true);
  });
});
