import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ErrorBoundary } from '@/components/ui/ErrorBoundary';

let shouldThrow = false;

function RecoverableChild() {
  if (shouldThrow) throw new Error('panel failed');
  return <div>Panel recovered</div>;
}

describe('ErrorBoundary recovery contract', () => {
  afterEach(() => {
    shouldThrow = false;
    vi.restoreAllMocks();
  });

  it('provides error and reset controls to a fallback renderer', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    shouldThrow = true;

    render(
      <ErrorBoundary
        fallback={({ error, resetError }) => (
          <div role="alert">
            <span>{error?.message}</span>
            <button
              type="button"
              onClick={() => {
                shouldThrow = false;
                resetError();
              }}
            >
              Retry panel
            </button>
          </div>
        )}
      >
        <RecoverableChild />
      </ErrorBoundary>
    );

    expect(screen.getByRole('alert')).toHaveTextContent('panel failed');
    fireEvent.click(screen.getByRole('button', { name: 'Retry panel' }));
    expect(screen.getByText('Panel recovered')).toBeInTheDocument();
  });

  it('resets a failed section when its reset key changes', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    shouldThrow = true;

    const view = render(
      <ErrorBoundary resetKeys={['roster']} fallback={<div role="alert">Roster failed</div>}>
        <RecoverableChild />
      </ErrorBoundary>
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Roster failed');
    shouldThrow = false;
    view.rerender(
      <ErrorBoundary resetKeys={['overview']} fallback={<div role="alert">Roster failed</div>}>
        <RecoverableChild />
      </ErrorBoundary>
    );

    expect(screen.getByText('Panel recovered')).toBeInTheDocument();
  });
});
