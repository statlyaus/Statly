import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AppLayout from '@/components/navigation/AppLayout';

const mocks = vi.hoisted(() => ({ pathname: '/leagues' }));

vi.mock('next/navigation', () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/image', () => ({
  default: ({ alt }: { alt: string }) => <span role="img" aria-label={alt} />,
}));
vi.mock('@/AuthContext', () => ({
  useAuth: () => ({
    user: { uid: 'user-1', displayName: 'Robert', email: 'robert@example.test' },
    logout: vi.fn(),
    loading: false,
  }),
}));
vi.mock('@/components/PlayerSearch', () => ({
  default: () => <input aria-label="Search players" />,
}));
vi.mock('@/components/navigation/LeagueSwitcher', () => ({
  default: () => <div>League switcher</div>,
}));

const basketballLinks = () =>
  screen.queryAllByRole('link').filter((link) => link.getAttribute('href') === '/basketball');

describe('basketball navigation link', () => {
  beforeEach(() => {
    mocks.pathname = '/leagues';
  });

  it('is hidden unless the caller may use fantasy basketball', () => {
    render(
      <AppLayout>
        <div>Route content</div>
      </AppLayout>
    );

    expect(basketballLinks()).toHaveLength(0);
    expect(screen.getAllByRole('link', { name: /Draft Hub/ }).length).toBeGreaterThan(0);
  });

  it('is shown when the server says the caller may use it', () => {
    render(
      <AppLayout showBasketball>
        <div>Route content</div>
      </AppLayout>
    );

    expect(basketballLinks().length).toBeGreaterThan(0);
  });

  it('is inherited by a nested shell such as the draft room', () => {
    mocks.pathname = '/drafts/room-1';
    render(
      <AppLayout showBasketball>
        <AppLayout mode="shell">
          <div>Draft room</div>
        </AppLayout>
      </AppLayout>
    );

    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(basketballLinks().length).toBeGreaterThan(0);
  });
});
