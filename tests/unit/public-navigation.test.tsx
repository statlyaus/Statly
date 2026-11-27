import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const navigation = vi.hoisted(() => ({ pathname: '/' }));
vi.mock('next/navigation', () => ({ usePathname: () => navigation.pathname }));

import { PublicNavigation } from '@/components/navigation/PublicNavigation';

/** A tab's name as a screen reader hears it: the label, or the full name behind a phone label. */
const accessibleName = (link: HTMLElement) => link.getAttribute('aria-label') ?? link.textContent;

/** The public tabs: one current tab, the most specific section that holds the page. */
const current = (pathname: string) => {
  navigation.pathname = pathname;
  const { unmount } = render(<PublicNavigation />);
  const links = screen.getAllByRole('link').filter((link) => link.getAttribute('aria-current'));
  const names = links.map(accessibleName);
  unmount();
  return names;
};

describe('PublicNavigation', () => {
  it('has a General managers tab after Trades', () => {
    navigation.pathname = '/';
    render(<PublicNavigation />);
    expect(screen.getAllByRole('link').map(accessibleName)).toEqual([
      'Home',
      'Trades',
      'General managers',
      'Draft record',
    ]);
    expect(screen.getByRole('link', { name: 'General managers' })).toHaveAttribute(
      'href',
      '/afl/trades/general-managers'
    );
    // Phones show the shorter label, which stays inside the name a screen reader hears.
    expect(screen.getByRole('link', { name: 'General managers' })).toHaveTextContent('Managers');
  });

  it('marks General managers, not Trades, on the general managers page', () => {
    expect(current('/afl/trades/general-managers')).toEqual(['General managers']);
  });

  it('keeps Trades current on the other trade pages', () => {
    expect(current('/afl/trades')).toEqual(['Trades']);
    expect(current('/afl/trades/method')).toEqual(['Trades']);
    expect(current('/afl/stories/jeremy-cameron')).toEqual(['Trades']);
    expect(current('/')).toEqual(['Home']);
  });
});
