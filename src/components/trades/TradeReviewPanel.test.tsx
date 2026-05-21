import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import TradeReviewPanel from './TradeReviewPanel';
import type { TradeDetails, TradeSummary } from './tradeApi';
import type { CanonicalStatKey } from '@/lib/stats/statColumns';

function makeReviewTrade(overrides: Partial<TradeSummary> = {}): TradeSummary {
  return {
    tradeId: 'trade-1',
    proposerUserId: 'manager-1',
    recipientUserId: 'manager-2',
    status: 'REVIEW_PENDING',
    createdAt: '2026-05-20T00:00:00.000Z',
    reviewMode: 'ADMIN',
    reviewStatus: 'PENDING',
    reviewRequestedAt: '2026-05-20T00:00:00.000Z',
    items: [
      {
        playerId: 'player-1',
        playerName: 'Player One',
        fromUserId: 'manager-1',
        toUserId: 'manager-2',
      },
    ],
    ...overrides,
  };
}

function makeDetails(trade: TradeSummary, overrides: Partial<TradeDetails> = {}): TradeDetails {
  return {
    ...trade,
    items: trade.items ?? [],
    reviewVotes: [],
    audit: [],
    ...overrides,
  };
}

function renderPanel(
  trade: TradeSummary,
  reviewControls: Partial<React.ComponentProps<typeof TradeReviewPanel>['reviewControls']> = {}
) {
  const controls = {
    approveEnabled: false,
    rejectEnabled: false,
    vetoEnabled: false,
    finalizeEnabled: false,
    loadingAction: null,
    onApprove: vi.fn(() => Promise.resolve()),
    onReject: vi.fn(() => Promise.resolve()),
    onVeto: vi.fn(() => Promise.resolve()),
    onFinalize: vi.fn(() => Promise.resolve()),
    ...reviewControls,
  };

  render(
    <TradeReviewPanel
      selectedTrade={trade}
      selectedDetails={makeDetails(trade)}
      detailLoading={false}
      gives={trade.items ?? []}
      receives={[]}
      currentUserId="commissioner-1"
      teamNameByUserId={
        new Map([
          ['manager-1', 'Home Team'],
          ['manager-2', 'Away Team'],
          ['commissioner-1', 'Commissioners'],
        ])
      }
      rosterCache={{}}
      visibleKeys={[]}
      labels={{}}
      reviewNetImpact={{ net: 0, label: 'Even' }}
      reviewTopGains={[]}
      reviewTopRisks={[]}
      reviewImpactLoading={false}
      reviewImpact={{
        outTotals: {} as Record<CanonicalStatKey, number>,
        inTotals: {} as Record<CanonicalStatKey, number>,
        deltaTotals: {} as Record<CanonicalStatKey, number>,
      }}
      acceptEnabled={false}
      declineEnabled={false}
      counterEnabled={false}
      cancelEnabled={false}
      actionLoading={false}
      actionType={null}
      actionTradeId={null}
      runAction={vi.fn(() => Promise.resolve())}
      beginCounter={vi.fn(() => Promise.resolve())}
      reviewControls={controls}
    />
  );

  return controls;
}

describe('TradeReviewPanel review controls', () => {
  it('surfaces commissioner approve and reject controls for admin review trades', () => {
    const controls = renderPanel(makeReviewTrade(), {
      approveEnabled: true,
      rejectEnabled: true,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Approve trade' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reject trade' }));

    expect(controls.onApprove).toHaveBeenCalledTimes(1);
    expect(controls.onReject).toHaveBeenCalledTimes(1);
  });

  it('surfaces an eligible league veto control for veto review trades', () => {
    const controls = renderPanel(
      makeReviewTrade({
        reviewMode: 'VETO',
        reviewWindowEndsAt: '2026-05-21T00:00:00.000Z',
      }),
      {
        vetoEnabled: true,
      }
    );

    fireEvent.click(screen.getByRole('button', { name: 'Veto trade' }));

    expect(controls.onVeto).toHaveBeenCalledTimes(1);
  });
});
