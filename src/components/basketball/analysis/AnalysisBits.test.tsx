import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { InjuryBadge } from './AnalysisBits';

const out = { status: 'OUT' as const, detail: 'Knee', expectedReturnOn: '2026-11-20' };

/** The badge's visible text (its screen-reader text removed) and its tooltip. */
function badge(element: Parameters<typeof render>[0]) {
  const { container } = render(element);
  const span = container.firstElementChild as HTMLElement | null;
  if (!span) return {};
  const visible = span.cloneNode(true) as HTMLElement;
  visible.querySelector('.sr-only')?.remove();
  return { visible: visible.textContent, title: span.title, full: span.textContent };
}

describe('InjuryBadge', () => {
  it('shows OUT or DTD with the detail and return date', () => {
    expect(badge(<InjuryBadge injury={out} />)).toEqual({
      visible: 'OUT',
      title: 'Knee, back Fri 20 Nov',
      full: 'OUT ruled out: Knee, back Fri 20 Nov',
    });
    expect(
      badge(<InjuryBadge injury={{ status: 'DAY_TO_DAY', detail: null, expectedReturnOn: null }} />)
    ).toEqual({ visible: 'DTD', title: 'Day-to-day', full: 'DTD day-to-day' });
    expect(badge(<InjuryBadge injury={null} />).full).toBeUndefined();
  });

  it('says out for the season instead of a return date', () => {
    expect(badge(<InjuryBadge injury={out} seasonEnding />)).toEqual({
      visible: 'OUT · season',
      title: 'Knee, out for the season',
      full: 'OUT · season ruled out: Knee, out for the season',
    });
  });

  it('marks an injury report over a day old', () => {
    expect(badge(<InjuryBadge injury={out} stale />)).toEqual({
      visible: 'OUT · old',
      title: 'Knee, back Fri 20 Nov (injury report over a day old)',
      full: 'OUT · old ruled out: Knee, back Fri 20 Nov (injury report over a day old)',
    });
  });
});
