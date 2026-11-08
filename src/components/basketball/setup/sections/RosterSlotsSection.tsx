'use client';

import { buttonStyles, fieldStyles } from '@/components/ui/controlStyles';
import { BASKETBALL_ROSTER_SLOTS } from '@/types/basketball';

import { FieldError, FieldHelp, FormSection, describedBy } from '../../shell/formParts';
import { fieldIdOf, yahooDefaultSlotText } from '../leagueForm';

import type { LeagueSectionProps } from './sectionProps';

const SLOT_HELP: Record<string, string> = { BN: 'Bench', IL: 'Injured list' };

export function RosterSlotsSection({ values, update, error, ids }: LeagueSectionProps) {
  const slotTotals = BASKETBALL_ROSTER_SLOTS.reduce(
    (totals, slot) => {
      const count = Number(values.rosterSlots[slot]) || 0;
      if (slot === 'BN') totals.bench += count;
      else if (slot === 'IL') totals.il += count;
      else totals.starters += count;
      return totals;
    },
    { starters: 0, bench: 0, il: 0 }
  );

  return (
    <FormSection
      id="bb-slots"
      title="Roster slots"
      summary="Decides which of your players count each day when more of them play than you can start."
    >
      <fieldset
        id={ids.rosterSlots}
        tabIndex={-1}
        aria-describedby={describedBy(ids.rosterSlots, true, error('rosterSlots'))}
        className="flex flex-col gap-3 outline-none"
      >
        <legend className="sr-only">Roster slots</legend>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <FieldHelp id={ids.rosterSlots}>
            {slotTotals.starters} starters, {slotTotals.bench} bench, {slotTotals.il} injured list.
            Bench and injured-list players never count.
          </FieldHelp>
          <button
            type="button"
            onClick={() => update('rosterSlots', yahooDefaultSlotText())}
            className={buttonStyles({ variant: 'ghost', size: 'sm' })}
          >
            Use Yahoo default
          </button>
        </div>
        <div className="grid grid-cols-5 gap-2">
          {BASKETBALL_ROSTER_SLOTS.map((slot) => {
            const key = `rosterSlots.${slot}`;
            const id = fieldIdOf(key);
            return (
              <div key={slot} className="flex min-w-0 flex-col gap-1">
                <label
                  htmlFor={id}
                  className="text-xs font-bold text-foreground"
                  title={SLOT_HELP[slot]}
                >
                  {slot}
                </label>
                <input
                  id={id}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={10}
                  value={values.rosterSlots[slot]}
                  onChange={(event) =>
                    update('rosterSlots', { ...values.rosterSlots, [slot]: event.target.value })
                  }
                  aria-invalid={error(key) ? true : undefined}
                  aria-describedby={describedBy(id, undefined, error(key))}
                  className={fieldStyles({ className: 'px-2 tabular-nums' })}
                />
                <FieldError id={id} error={error(key)} />
              </div>
            );
          })}
        </div>
        <FieldError id={ids.rosterSlots} error={error('rosterSlots')} />
      </fieldset>
    </FormSection>
  );
}
