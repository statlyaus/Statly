import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';

import { PageErrorBoundary, SectionErrorBoundary } from '../ErrorBoundary';

function Explode(): never {
  throw new Error('[firebaseAdmin] Firestore operation "doc" is unavailable');
}

describe('ErrorBoundary default fallback', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('shows a plain message and a reference instead of the raw error text', () => {
    render(
      <SectionErrorBoundary>
        <Explode />
      </SectionErrorBoundary>
    );

    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument();
    expect(screen.queryByText(/firebaseAdmin/)).not.toBeInTheDocument();
    expect(
      screen.getByText('This part of the page could not load. Try again in a moment.')
    ).toBeInTheDocument();
    expect(screen.getByText(/^Reference: err_/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Try again/ })).toBeInTheDocument();
  });

  it('keeps the page-level wording for page boundaries', () => {
    render(
      <PageErrorBoundary>
        <Explode />
      </PageErrorBoundary>
    );

    expect(screen.getByRole('heading', { name: 'Page Error' })).toBeInTheDocument();
    expect(
      screen.getByText('This page could not load. Try again, or reload the page.')
    ).toBeInTheDocument();
    expect(screen.queryByText(/firebaseAdmin/)).not.toBeInTheDocument();
  });
});
