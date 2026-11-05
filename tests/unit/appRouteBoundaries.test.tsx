import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const { captureError } = vi.hoisted(() => ({ captureError: vi.fn() }));
vi.mock('@/lib/sentry-utils', () => ({ captureError }));

import AppRouteError from '@/app/(app)/error';
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

describe('not-found page', () => {
  it('explains the missing page and links home', () => {
    render(<NotFound />);

    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go home' })).toHaveAttribute('href', '/');
  });
});
