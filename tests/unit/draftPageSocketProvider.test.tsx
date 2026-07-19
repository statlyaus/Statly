import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import DraftPage from '@/app/(app)/drafts/[id]/page';

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'draft-1' }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('lucide-react', () => ({
  AlertTriangle: () => <svg data-testid="alert-triangle" />,
  LockKeyhole: () => <svg data-testid="lock-keyhole" />,
}));

vi.mock('@/AuthContext', () => ({
  useAuth: () => ({
    user: { uid: 'statly-dev-tester' },
  }),
}));

vi.mock('@/components/navigation', () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/ui/ErrorBoundary', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/contexts/DraftContext', () => ({
  DraftProvider: ({
    draftId,
    userId,
    children,
  }: {
    draftId: string;
    userId: string;
    children: React.ReactNode;
  }) => (
    <div data-testid="draft-provider" data-draft-id={draftId} data-user-id={userId}>
      {children}
    </div>
  ),
}));

vi.mock('@/components/draft/UnifiedDraftRoom', () => ({
  default: ({ draftId, userId }: { draftId: string; userId: string }) => (
    <div data-testid="draft-room" data-draft-id={draftId} data-user-id={userId} />
  ),
}));

describe('DraftPage provider composition', () => {
  it('uses the app-level socket while preserving the draft provider and room', () => {
    render(<DraftPage />);

    expect(screen.queryByTestId('socket-provider')).not.toBeInTheDocument();
    expect(screen.getByTestId('draft-provider')).toHaveAttribute('data-draft-id', 'draft-1');
    expect(screen.getByTestId('draft-room')).toHaveAttribute('data-user-id', 'statly-dev-tester');
  });
});
