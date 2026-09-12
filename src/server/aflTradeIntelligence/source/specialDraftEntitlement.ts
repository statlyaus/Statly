import { z } from 'zod';

/** Source-local rights, not resolved custody, exercise years or eventual player selections. */
export const specialDraftEntitlementSchema = z
  .object({
    kind: z.literal('special_pick'),
    entitlementType: z.enum(['mini_draft', 'expansion_compensation', 'assistance_concession']),
    draftYear: z.number().int().min(1988).max(2200).nullable(),
    selectionOrdinal: z.number().int().min(1).max(2).nullable(),
    sourceLabel: z.string().trim().min(1).max(500),
  })
  .strict()
  .superRefine((asset, context) => {
    const mini = asset.entitlementType === 'mini_draft';
    if (
      (mini &&
        (!asset.draftYear || ![2011, 2012].includes(asset.draftYear) || !asset.selectionOrdinal)) ||
      (mini && asset.sourceLabel !== `M${asset.selectionOrdinal}`) ||
      (asset.entitlementType === 'expansion_compensation' &&
        !/^CMP[1-5] \([^()]+\)$/.test(asset.sourceLabel)) ||
      (asset.entitlementType === 'assistance_concession' &&
        asset.sourceLabel !== '2020MIDR1 (Gold Coast concession)') ||
      (!mini && asset.selectionOrdinal !== null) ||
      (asset.entitlementType === 'expansion_compensation' && asset.draftYear !== null) ||
      (asset.entitlementType === 'assistance_concession' && asset.draftYear !== 2020)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Special entitlement has unsupported year or ordinal semantics.',
      });
    }
  });

export type SpecialDraftEntitlement = z.infer<typeof specialDraftEntitlementSchema>;

/** Exact source label only; callers must exclude adjacent estimates before parsing. */
export function parseSpecialDraftEntitlement(
  label: string,
  tradeYear: number
): SpecialDraftEntitlement | null {
  const mini = /^M([12])$/.exec(label);
  if (mini && [2011, 2012].includes(tradeYear)) {
    return specialDraftEntitlementSchema.parse({
      kind: 'special_pick',
      entitlementType: 'mini_draft',
      draftYear: tradeYear,
      selectionOrdinal: Number(mini[1]),
      sourceLabel: label,
    });
  }
  if (/^CMP[1-5] \([^()]+\)$/.test(label) && tradeYear >= 2010 && tradeYear <= 2015) {
    return specialDraftEntitlementSchema.parse({
      kind: 'special_pick',
      entitlementType: 'expansion_compensation',
      draftYear: null,
      selectionOrdinal: null,
      sourceLabel: label,
    });
  }
  if (label === '2020MIDR1 (Gold Coast concession)' && tradeYear === 2019) {
    return specialDraftEntitlementSchema.parse({
      kind: 'special_pick',
      entitlementType: 'assistance_concession',
      draftYear: 2020,
      selectionOrdinal: null,
      sourceLabel: label,
    });
  }
  return null;
}
