import { describe, expect, it } from 'vitest';
import { requireAflTradeExternalEvidenceFieldAuthority } from '@/server/aflTradeIntelligence/source/externalDraftTradeFieldManifest';

type Input = Parameters<typeof requireAflTradeExternalEvidenceFieldAuthority>[0];
type Ranges = { from: number; to: number }[];

// Minimal guard inputs, not an admission or source-rights receipt.
function fixture(
  kind: 'compensation_rule_reference' | 'compensation_activation_reference',
  ranges: Ranges
): Input {
  const claim =
    kind === 'compensation_rule_reference' ? { kind, awardYear: 2010 } : { kind, useYear: 2012 };
  const fields = Object.keys(claim)
    .filter((key) => key !== 'kind')
    .map((key) => `${kind}.${key}`);
  return {
    evidence: [{ content: { claim } }],
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
          season: 2014,
          fieldUses: fields.map((sourceField) => ({ sourceField, use: 'archive_fact' })),
        },
      },
    },
  } as unknown as Input;
}

describe.each(['compensation_rule_reference', 'compensation_activation_reference'] as const)(
  '%s factual year authority',
  (kind) => {
    it.each<Ranges>([
      [{ from: 2014, to: 2014 }],
      [
        { from: 2000, to: 2009 },
        { from: 2013, to: 2020 },
      ],
      [],
    ])('rejects facts outside approved ranges %j', (...ranges) => {
      expect(() => requireAflTradeExternalEvidenceFieldAuthority(fixture(kind, ranges))).toThrow(
        /Compensation event years outside approved source scope/
      );
    });

    it.each<Ranges>([
      [{ from: 2010, to: 2012 }],
      [
        { from: 2010, to: 2010 },
        { from: 2012, to: 2012 },
      ],
    ])('accepts explicitly covered years independently of page anchor %j', (...ranges) => {
      expect(() =>
        requireAflTradeExternalEvidenceFieldAuthority(fixture(kind, ranges))
      ).not.toThrow();
    });

    it('does not let year coverage replace field permission', () => {
      const input = fixture(kind, [{ from: 2010, to: 2014 }]);
      input.sourceRights.content.fields = [];
      expect(() => requireAflTradeExternalEvidenceFieldAuthority(input)).toThrow(
        /outside the reviewed Gate/
      );
    });
  }
);
