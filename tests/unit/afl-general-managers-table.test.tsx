import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

import { GeneralManagersTable } from '@/components/aflGeneralManagers/GeneralManagersTable';
import type { GeneralManagerLadderRow } from '@/components/aflGeneralManagers/generalManagerLadder';

/** The general managers table sorts by PAV +/− (the default) or by per trade, either way round. */

const row = (person: string, net: number, deals: number): GeneralManagerLadderRow => ({
  person,
  club: 'Geelong',
  firstYear: 2019,
  lastYear: 2024,
  deals,
  net,
  perDeal: net / deals,
  unconfirmed: false,
});

// Ordered by net, as the ladder hands them over: per trade puts them in a different order.
const rows = [row('Most in all', 90, 30), row('Best per trade', 60, 2), row('Worst', -40, 4)];

const people = () =>
  screen
    .getAllByRole('row')
    .slice(1)
    .map((tableRow) => within(tableRow).getByRole('rowheader').textContent);

describe('general managers table', () => {
  it('ranks by PAV +/− first, highest first', () => {
    render(<GeneralManagersTable rows={rows} />);
    expect(people()).toEqual(['Most in all', 'Best per trade', 'Worst']);
    expect(screen.getByRole('columnheader', { name: /PAV/u })).toHaveAttribute(
      'aria-sort',
      'descending'
    );
  });

  it('sorts by per trade, then flips it on a second press', () => {
    render(<GeneralManagersTable rows={rows} />);
    fireEvent.click(screen.getByRole('button', { name: /Per trade/u }));
    expect(people()).toEqual(['Best per trade', 'Most in all', 'Worst']);
    expect(screen.getByRole('columnheader', { name: /Per trade/u })).toHaveAttribute(
      'aria-sort',
      'descending'
    );
    expect(screen.getByRole('columnheader', { name: /PAV/u })).not.toHaveAttribute('aria-sort');
    fireEvent.click(screen.getByRole('button', { name: /Per trade/u }));
    expect(people()).toEqual(['Worst', 'Most in all', 'Best per trade']);
    expect(screen.getByRole('columnheader', { name: /Per trade/u })).toHaveAttribute(
      'aria-sort',
      'ascending'
    );
  });
});
