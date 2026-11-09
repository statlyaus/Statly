import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AppLayout from '@/components/navigation/AppLayout';
import { LOGIN_AUTO_REDIRECT_KEY } from '@/lib/loginLoopGuard';

vi.mock('next/navigation', () => ({ usePathname: () => '/leagues/abc' }));
vi.mock('@/components/navigation/MainNavigation', () => ({ default: () => <nav /> }));

describe('AppLayout and the /login loop guard', () => {
  beforeEach(() => window.sessionStorage.clear());

  it('clears the auto-redirect marker once the signed-in shell renders', () => {
    window.sessionStorage.setItem(
      LOGIN_AUTO_REDIRECT_KEY,
      JSON.stringify({ destination: '/leagues/abc', at: Date.now() })
    );

    render(<AppLayout>page</AppLayout>);

    expect(window.sessionStorage.getItem(LOGIN_AUTO_REDIRECT_KEY)).toBeNull();
  });
});
