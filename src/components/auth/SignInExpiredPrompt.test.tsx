import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { clearSignInExpired, reportSignInExpired } from '@/lib/signInExpiry';

import SignInExpiredPrompt, { loginHrefFor } from './SignInExpiredPrompt';

describe('SignInExpiredPrompt', () => {
  afterEach(() => {
    act(() => clearSignInExpired());
    window.history.replaceState(null, '', '/');
  });

  it('renders nothing while the sign-in works', () => {
    const { container } = render(<SignInExpiredPrompt />);

    expect(container).toBeEmptyDOMElement();
  });

  it('raises one alert with a sign-in link back to the current page and query', () => {
    window.history.replaceState(null, '', '/leagues/league-1/trades?thread=t-1');
    render(<SignInExpiredPrompt />);

    act(() => reportSignInExpired());

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Your sign-in has expired');
    const link = screen.getByRole('link', { name: 'Sign in again' });
    expect(link).toHaveAttribute(
      'href',
      `/login?next=${encodeURIComponent('/leagues/league-1/trades?thread=t-1')}`
    );
  });

  it('points the link at the page the user is on when they click it', () => {
    window.history.replaceState(null, '', '/leagues/league-1');
    render(<SignInExpiredPrompt />);
    act(() => reportSignInExpired());

    window.history.replaceState(null, '', '/leagues/league-1/waivers?tab=claims');
    const link = screen.getByRole('link', { name: 'Sign in again' });
    link.addEventListener('click', (event) => event.preventDefault());
    act(() => link.click());

    expect(link).toHaveAttribute(
      'href',
      `/login?next=${encodeURIComponent('/leagues/league-1/waivers?tab=claims')}`
    );
  });

  it('hides again once the sign-in is restored', () => {
    render(<SignInExpiredPrompt />);
    act(() => reportSignInExpired());
    expect(screen.getByRole('alert')).toBeInTheDocument();

    act(() => clearSignInExpired());

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('builds a login link the login page can only read as a same-site path', () => {
    expect(loginHrefFor('//evil.example/path', '')).toBe('/login');
    expect(loginHrefFor('/dashboard', '?a=1')).toBe(
      `/login?next=${encodeURIComponent('/dashboard?a=1')}`
    );
  });
});
