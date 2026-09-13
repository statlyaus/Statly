import { describe, expect, it } from 'vitest';
import { requireAflTradeExternalEvidenceFieldAuthority } from '@/server/aflTradeIntelligence/source/externalDraftTradeFieldManifest';

type Input = Parameters<typeof requireAflTradeExternalEvidenceFieldAuthority>[0];

// This unit fixture supplies only the fields consumed by the guard. It is not an admission receipt.
function fixture(ranges: { from: number; to: number }[]): Input {
  const fields = ['draft_selection.draftYear', 'draft_selection.selectionNumber'];
  return {
    evidence: [
      { content: { claim: { kind: 'draft_selection', draftYear: 2021, selectionNumber: 1 } } },
    ],
    sourceRights: {
      content: {
        scope: { seasonRanges: ranges },
        fields: fields.map((field) => ({
          sourceField: field,
          normalizedField: field,
          uses: { archive_fact: 'allowed' },
        })),
      },
    },
    gate0aReceipt: {
      content: {
        request: {
          season: 2020,
          fieldUses: fields.map((sourceField) => ({ sourceField, use: 'archive_fact' })),
        },
      },
    },
  } as unknown as Input;
}

describe('external selection event-year authority', () => {
  it.each([
    [{ from: 2020, to: 2020 }],
    [
      { from: 2010, to: 2020 },
      { from: 2022, to: 2025 },
    ],
  ])('rejects an emitted year absent from approved ranges %j', (...ranges) => {
    expect(() => requireAflTradeExternalEvidenceFieldAuthority(fixture(ranges))).toThrow(
      /selection.*year.*scope/i
    );
  });

  it.each([
    [{ from: 2020, to: 2021 }],
    [{ from: 2021, to: 2021 }],
    [
      { from: 2010, to: 2020 },
      { from: 2021, to: 2022 },
    ],
  ])('accepts an explicitly covered event year in %j despite the page anchor', (...ranges) => {
    expect(() => requireAflTradeExternalEvidenceFieldAuthority(fixture(ranges))).not.toThrow();
  });

  it('continues to reject fields absent from the reviewed manifest', () => {
    const input = fixture([{ from: 2020, to: 2021 }]);
    input.sourceRights.content.fields = [];
    expect(() => requireAflTradeExternalEvidenceFieldAuthority(input)).toThrow(
      /outside the reviewed/
    );
  });
});
