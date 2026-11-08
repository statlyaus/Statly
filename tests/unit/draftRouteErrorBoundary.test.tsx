import { existsSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const { captureError } = vi.hoisted(() => ({ captureError: vi.fn() }));
vi.mock('@/lib/sentry-utils', () => ({ captureError, captureException: captureError }));

const boundaryPath = path.resolve(__dirname, '../../src/app/(public)/draft/error.tsx');

describe('public draft hub error boundary', () => {
  it('exists so draft hub failures render inside the hub layout, not global-error', () => {
    expect(existsSync(boundaryPath)).toBe(true);
  });

  it('reports the error, hides raw details and retries the segment', async () => {
    const { default: DraftRouteError } = await import('@/app/(public)/draft/error');
    const retry = vi.fn();
    const error = Object.assign(new Error('outcomes pool 10.0.0.4 refused'), { digest: 'abc123' });

    render(<DraftRouteError error={error} retry={retry} />);

    expect(captureError).toHaveBeenCalledWith(error, { boundary: 'draft-route', digest: 'abc123' });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'This page could not load' })).toBeInTheDocument();
    expect(screen.queryByText(/10\.0\.0\.4/)).not.toBeInTheDocument();
    expect(screen.getByText('Reference: abc123')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
