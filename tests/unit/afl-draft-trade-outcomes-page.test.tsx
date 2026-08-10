import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { outcomeService } = vi.hoisted(() => ({ outcomeService: { list: vi.fn() } }));

vi.mock('@/server/aflTradeIntelligence/runtime/publicReadRuntime', () => ({
  getPublicAflTradeReadRuntime: async () => ({ outcomeReadService: outcomeService }),
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

  it('ignores retired workbook acquisition filters and reads only the governed release', async () => {
    outcomeService.list.mockResolvedValue({ consistency: { selection: 'none' } });

    render(
      await AflDraftTradeOutcomesPage({
        searchParams: Promise.resolve({ acquisition: 'mid_season_draft' }),
      })
    );

    expect(outcomeService.list).toHaveBeenCalledWith(
      expect.objectContaining({ scopeKey: 'public-afl-draft-trade-outcomes', limit: 25 })
    );
    expect(screen.queryByText(/workbook/i)).not.toBeInTheDocument();
  });
});
