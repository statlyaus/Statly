import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listYears: vi.fn(),
  listByYear: vi.fn(),
  getById: vi.fn(),
  listRefsByClub: vi.fn(),
  valueList: vi.fn(),
  valueDetail: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('not found');
  }),
}));

vi.mock('@/lib/logger', () => ({ logger: { error: mocks.loggerError } }));

vi.mock('@/lib/draftTrades/read', () => ({
  listDraftTradeYears: mocks.listYears,
  listDraftTradesByYear: mocks.listByYear,
  getDraftTradeById: mocks.getById,
  listDraftTradeRefsByClub: mocks.listRefsByClub,
}));

vi.mock('@/server/aflTradeIntelligence/runtime/publicReadRuntime', () => ({
  getPublicAflTradeReadRuntime: async () => ({
    valueReadService: { list: mocks.valueList, detail: mocks.valueDetail },
  }),
}));

vi.mock('@/components/draft/DraftTradesExplorer', () => ({
  DraftTradesExplorer: ({
    trades,
    atTradeValueResponse,
  }: {
    trades: Array<{ tradeId: string }>;
    atTradeValueResponse: unknown;
  }) => (
    <div data-testid="explorer" data-values={atTradeValueResponse === null ? 'none' : 'some'}>
      {trades.map(({ tradeId }) => tradeId).join(',')}
    </div>
  ),
}));

vi.mock('@/components/draft/DraftTradeDetail', () => ({
  DraftTradeDetail: ({
    detail,
    valueAnalysis,
  }: {
    detail: { trade: { tradeId: string } };
    valueAnalysis?: unknown;
  }) => (
    <div data-testid="detail" data-values={valueAnalysis === undefined ? 'none' : 'some'}>
      {detail.trade.tradeId}
    </div>
  ),
}));

vi.mock('@/components/draft/DraftClubTradeHistory', () => ({
  DraftClubTradeHistory: ({
    refs,
    statlyValuesByTradeId,
  }: {
    refs: Array<{ tradeId: string }>;
    statlyValuesByTradeId: Record<string, unknown>;
  }) => (
    <div data-testid="club" data-values={Object.keys(statlyValuesByTradeId).length}>
      {refs.map(({ tradeId }) => tradeId).join(',')}
    </div>
  ),
}));

import DraftTradesPage from '../../src/app/(public)/draft/trades/page';
import DraftTradeDetailPage from '../../src/app/(public)/draft/trades/[tradeId]/page';
import DraftClubDetailPage from '../../src/app/(public)/draft/clubs/[clubSlug]/page';
import { AflTradeValueReadError } from '@/server/aflTradeIntelligence/publication/valueReadService';

const projectionFault = () =>
  new AflTradeValueReadError('PROJECTION_READ_FAILED', 'projection artifact could not be read');

describe('a valuation read failure keeps the reviewed factual record visible', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.valueList.mockRejectedValue(projectionFault());
    mocks.valueDetail.mockRejectedValue(projectionFault());
  });

  it('trade explorer renders the trades and marks valuations unavailable', async () => {
    mocks.listYears.mockResolvedValue([2025]);
    mocks.listByYear.mockResolvedValue([{ tradeId: 'trade-1' }]);

    render(await DraftTradesPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByTestId('explorer')).toHaveTextContent('trade-1');
    expect(screen.getByTestId('explorer')).toHaveAttribute('data-values', 'none');
    expect(screen.getByText(/trade values are temporarily unavailable/i)).toBeInTheDocument();
    expect(screen.queryByText(/could not be loaded/i)).not.toBeInTheDocument();
    expect(mocks.loggerError).toHaveBeenCalled();
  });

  it('trade detail renders the record and marks valuations unavailable', async () => {
    mocks.getById.mockResolvedValue({ trade: { tradeId: 'trade-1' }, parties: [], assets: [] });

    render(await DraftTradeDetailPage({ params: Promise.resolve({ tradeId: 'trade-1' }) }));

    expect(screen.getByTestId('detail')).toHaveTextContent('trade-1');
    expect(screen.getByTestId('detail')).toHaveAttribute('data-values', 'none');
    expect(screen.getByText(/trade values are temporarily unavailable/i)).toBeInTheDocument();
  });

  it('club history renders the trades and marks valuations unavailable', async () => {
    mocks.listRefsByClub.mockResolvedValue([
      { tradeId: 'trade-1', clubName: 'Carlton', year: 2025 },
    ]);

    render(await DraftClubDetailPage({ params: Promise.resolve({ clubSlug: 'carlton' }) }));

    expect(screen.getByTestId('club')).toHaveTextContent('trade-1');
    expect(screen.getByTestId('club')).toHaveAttribute('data-values', '0');
    expect(screen.getByText(/trade values are temporarily unavailable/i)).toBeInTheDocument();
  });
});
