import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/AuthForm', () => ({ default: () => <div>auth form</div> }));
vi.mock('next/image', () => ({
  default: ({ alt }: { alt: string }) => <span role="img" aria-label={alt} />,
}));

import LoginPage from '@/app/(auth)/login/page';
import RegisterPage from '@/app/(auth)/register/page';

async function renderPage(
  page: typeof LoginPage | typeof RegisterPage,
  params: Record<string, string>
) {
  render((await page({ searchParams: Promise.resolve(params) })) as ReactElement);
}

const inviteNext = '/leagues/join?code=ABC123';

describe('sign-in and sign-up cross-links', () => {
  it('carries the invite destination from sign-in to sign-up', async () => {
    await renderPage(LoginPage, { next: inviteNext });

    expect(screen.getByRole('button', { name: /Sign up/ })).toHaveAttribute(
      'href',
      `/register?next=${encodeURIComponent(inviteNext)}`
    );
  });

  it('carries the invite destination from sign-up back to sign-in', async () => {
    await renderPage(RegisterPage, { next: inviteNext });

    expect(screen.getByRole('button', { name: /Sign in/ })).toHaveAttribute(
      'href',
      `/login?next=${encodeURIComponent(inviteNext)}`
    );
  });

  it.each(['https://evil.example/', '//evil.example', '/\\evil.example'])(
    'drops an off-site destination %s instead of passing it on',
    async (next) => {
      await renderPage(LoginPage, { next });

      expect(screen.getByRole('button', { name: /Sign up/ })).toHaveAttribute('href', '/register');
    }
  );

  it('links plainly when there is no destination', async () => {
    await renderPage(RegisterPage, {});

    expect(screen.getByRole('button', { name: /Sign in/ })).toHaveAttribute('href', '/login');
  });
});
