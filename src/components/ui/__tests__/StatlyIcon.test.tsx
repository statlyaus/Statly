import { render } from '@testing-library/react';

import StatlyIcon, { type StatlyIconName } from '../StatlyIcon';

const names: StatlyIconName[] = [
  'home',
  'activity',
  'bolt',
  'players',
  'draft',
  'basketball',
  'tools',
  'stopwatch',
  'footy',
  'trade',
  'ladder',
  'team',
  'commissioner',
  'help',
  'clock',
];

describe('StatlyIcon', () => {
  it.each(names)('renders %s as a decorative stroke icon', (name) => {
    const { container } = render(<StatlyIcon name={name} />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('data-statly-icon', name);
    expect(svg).toHaveAttribute('stroke', 'currentColor');
    expect(svg?.childElementCount).toBeGreaterThan(0);
  });

  it('keeps the caller size class', () => {
    const { container } = render(<StatlyIcon name="home" className="h-6 w-6" />);
    expect(container.querySelector('svg')?.getAttribute('class')).toContain('h-6 w-6');
  });
});
