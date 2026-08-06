import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const outcomeService = vi.hoisted(() => ({ list: vi.fn() }));

vi.mock('@/server/aflTradeIntelligence/outcomes/prePublicationOutcomeReadService', () => ({
  aflDraftTradePrePublicationOutcomeReadService: outcomeService,
}));

vi.mock('@/components/draft/AflDraftTradeOutcomesExplorer', () => ({
  AflDraftTradeOutcomesExplorer: ({
    query,
    filterNotice,
  }: {
    query: { metric: string | null; cursor: string | null };
    filterNotice: string | null;
  }) => (
    <div>
      <span data-testid="metric">{query.metric ?? 'all'}</span>
      <span data-testid="cursor">{query.cursor ?? 'none'}</span>
      {filterNotice ? <p role="status">{filterNotice}</p> : null}
    </div>
  ),
}));

import AflDraftTradeOutcomesPage from '../../src/app/(public)/draft/outcomes/page';
import { AflDraftTradeOutcomeReadError } from '@/server/aflTradeIntelligence/outcomes/outcomeReadService';

describe('AFL Draft & Trade outcomes page', () => {
  beforeEach(() => {
    outcomeService.list.mockReset();
  });

  it('recovers an unsupported bookmarked metric against the active release', async () => {
    outcomeService.list
      .mockRejectedValueOnce(
        new AflDraftTradeOutcomeReadError(
          'UNSUPPORTED_METRIC',
          'The active release does not support this metric.'
        )
      )
      .mockResolvedValueOnce({ consistency: { selection: 'active' } });

    render(
      await AflDraftTradeOutcomesPage({
        searchParams: Promise.resolve({
          metric: 'brownlow_votes',
          cursor: 'release-bound-cursor',
        }),
      })
    );

    expect(outcomeService.list).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ metric: 'brownlow_votes', cursor: 'release-bound-cursor' })
    );
    expect(outcomeService.list).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ metric: null, cursor: null })
    );
    expect(screen.getByTestId('metric')).toHaveTextContent('all');
    expect(screen.getByTestId('cursor')).toHaveTextContent('none');
    expect(screen.getByRole('status')).toHaveTextContent(
      /does not include brownlow votes.*showing all metrics supported/i
    );
  });
});
