'use client';

import { fieldStyles } from '@/components/ui/controlStyles';

import { Field, FormSection, describedBy } from '../../shell/formParts';

import type { LeagueSectionProps } from './sectionProps';

export function AuctionSection({ values, update, error, ids }: LeagueSectionProps) {
  return (
    <FormSection id="bb-auction" title="Auction" summary="Only for auction drafts and keepers.">
      <Field
        id={ids.budget}
        label="Auction budget"
        help="Optional. With a budget, the Players page shows each player's auction dollar value."
        error={error('auctionBudget')}
        className="sm:max-w-xs"
      >
        <input
          id={ids.budget}
          type="number"
          inputMode="numeric"
          min={1}
          placeholder="e.g. 200"
          value={values.auctionBudget}
          onChange={(event) => update('auctionBudget', event.target.value)}
          aria-invalid={error('auctionBudget') ? true : undefined}
          aria-describedby={describedBy(ids.budget, true, error('auctionBudget'))}
          className={fieldStyles()}
        />
      </Field>
    </FormSection>
  );
}
