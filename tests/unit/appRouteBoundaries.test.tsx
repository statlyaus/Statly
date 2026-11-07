import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const { captureError, captureException } = vi.hoisted(() => ({
  captureError: vi.fn(),
  captureException: vi.fn(),
}));
vi.mock('@/lib/sentry-utils', () => ({ captureError, captureException }));

import AppRouteError from '@/app/(app)/error';
import AppNotFound from '@/app/(app)/not-found';
import AuthRouteError from '@/app/(auth)/error';
import PublicRouteError from '@/app/(public)/error';
import GlobalError from '@/app/global-error';
import NotFound from '@/app/not-found';

describe('app route error boundary', () => {
  it('reports the error, keeps raw details hidden and retries through reset', () => {
    const reset = vi.fn();
    const error = Object.assign(new Error('db host 10.0.0.4 refused'), { digest: 'abc123' });

    render(<AppRouteError error={error} reset={reset} />);

    expect(captureError).toHaveBeenCalledWith(error, { boundary: 'app-route', digest: 'abc123' });
    expect(screen.getByRole('heading', { name: 'This page could not load' })).toBeInTheDocument();
    expect(screen.queryByText(/10\.0\.0\.4/)).not.toBeInTheDocument();
    expect(screen.getByText('Reference: abc123')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(reset).toHaveBeenCalledOnce();
    expect(screen.getByRole('link', { name: 'Go to dashboard' })).toHaveAttribute(
      'href',
      '/dashboard'
    );
  });
});

describe.each([
  ['public', PublicRouteError, 'public-route', 'Go home', '/'],
  ['sign-in', AuthRouteError, 'auth-route', 'Go home', '/'],
])('%s route error boundary', (_label, RouteError, boundary, linkName, href) => {
  it('keeps the group layout, reports the error, hides raw details and retries', () => {
    const reset = vi.fn();
    const error = Object.assign(new Error('upstream 10.0.0.9 timed out'), { digest: 'pub789' });

    render(<RouteError error={error} reset={reset} />);

    expect(captureError).toHaveBeenCalledWith(error, { boundary, digest: 'pub789' });
    expect(screen.getByRole('heading', { name: 'This page could not load' })).toBeInTheDocument();
    expect(screen.queryByText(/10\.0\.0\.9/)).not.toBeInTheDocument();
    expect(screen.getByText('Reference: pub789')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(reset).toHaveBeenCalledOnce();
    expect(screen.getByRole('link', { name: linkName })).toHaveAttribute('href', href);
  });
});

describe('in-app not-found page', () => {
  it('stays inside the app shell and sends managers to their dashboard', () => {
    render(<AppNotFound />);

    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.queryByRole('main')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to dashboard' })).toHaveAttribute(
      'href',
      '/dashboard'
    );
  });
});

describe('global error page', () => {
  it('reports the error, uses a top-level heading and retries through reset', () => {
    const reset = vi.fn();
    const error = Object.assign(new Error('root layout failed'), { digest: 'def456' });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    // global-error renders its own <html> and <body>; jsdom warns about nesting them in a div.
    render(<GlobalError error={error} reset={reset} />);

    expect(captureException).toHaveBeenCalledWith(error);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Something went wrong' })
    ).toBeInTheDocument();
    expect(screen.queryByText(/root layout failed/)).not.toBeInTheDocument();
    expect(screen.getByText('Reference: def456')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(reset).toHaveBeenCalledOnce();
    expect(screen.getByRole('link', { name: 'Go home' })).toHaveAttribute('href', '/');
    consoleError.mockRestore();
  });
});

describe('not-found page', () => {
  it('explains the missing page and links home', () => {
    render(<NotFound />);

    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go home' })).toHaveAttribute('href', '/');
  });
});
