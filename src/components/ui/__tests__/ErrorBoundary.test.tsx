import { Component } from 'react';
import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { notFound, redirect } from 'next/navigation';
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

/** Stands in for the not-found and redirect boundaries Next.js renders above a page. */
class NextRouteBoundary extends Component<{ children: ReactNode }, { digest?: string }> {
  state: { digest?: string } = {};

  static getDerivedStateFromError(error: { digest?: string }) {
    return { digest: error.digest ?? 'no digest' };
  }

  render() {
    return this.state.digest ? (
      <p role="status">Next.js handled {this.state.digest}</p>
    ) : (
      this.props.children
    );
  }
}

describe('ErrorBoundary and Next.js navigation errors', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it.each([
    ['notFound()', () => notFound(), 'NEXT_HTTP_ERROR_FALLBACK;404'],
    ['redirect()', () => redirect('/login'), 'NEXT_REDIRECT'],
  ])('lets %s through to the Next.js boundary above it', (_name, navigate, digest) => {
    function Navigate(): ReactNode {
      navigate();
      return null;
    }

    render(
      <NextRouteBoundary>
        <SectionErrorBoundary>
          <Navigate />
        </SectionErrorBoundary>
      </NextRouteBoundary>
    );

    expect(screen.getByRole('status')).toHaveTextContent(`Next.js handled ${digest}`);
    expect(screen.queryByRole('heading', { name: 'Something went wrong' })).not.toBeInTheDocument();
  });

  it('still catches an ordinary error itself', () => {
    render(
      <NextRouteBoundary>
        <SectionErrorBoundary>
          <Explode />
        </SectionErrorBoundary>
      </NextRouteBoundary>
    );

    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
