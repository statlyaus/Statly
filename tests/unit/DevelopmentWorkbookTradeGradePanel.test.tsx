import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DevelopmentWorkbookTradeGradePanel } from '@/components/draft/DevelopmentWorkbookTradeGradePanel';
import type { AflOutcomesDevelopmentTradeGradeEvidence } from '@/server/aflTradeIntelligence/source/developmentWorkbookTradeOutcomeProjection';

const evidence: AflOutcomesDevelopmentTradeGradeEvidence = {
  schemaVersion: 'afl-outcomes-development-trade-grade/v1',
  tradeId: 'workbook-2025-fixture',
  status: 'partial',
  source: {
    originalFilename: 'AFL Drafts Trades.xlsx',
    sha256: 'a'.repeat(64),
    observedAt: '2026-08-07T00:00:00.000Z',
  },
  coverage: {
    totalAssets: 2,
    matchedAssets: 1,
    gradedAssets: 1,
    unresolvedAssets: 1,
    matchedWithoutGradeAssets: 0,
  },
  assets: [
    {
      assetId: 'asset-1',
      clubSlug: 'carlton',
      clubName: 'Carlton',
      assetType: 'player',
      assetText: 'Reidy (0 games)',
      status: 'graded',
      matchMethod: 'receiving_club_trade_player',
      reasonCode: null,
      outcome: {
        eventId: '2025_0001',
        acquisitionCategory: 'trade',
        acquisitionType: 'Trade',
        playerName: 'Liam Reidy',
        grade: 'D',
        games: '1',
        goals: '0',
        coachesVotes: '0',
        brownlowVotes: '0',
        awards: null,
      },
    },
    {
      assetId: 'asset-2',
      clubSlug: 'fremantle',
      clubName: 'Fremantle',
      assetType: 'future_pick',
      assetText: '#2026R2 (Carlton) (-)',
      status: 'unresolved',
      matchMethod: null,
      reasonCode: 'future_pick_unresolved',
      outcome: null,
    },
  ],
};

describe('DevelopmentWorkbookTradeGradePanel', () => {
  it('shows recorded grades and coverage without presenting a Statly trade verdict', () => {
    render(<DevelopmentWorkbookTradeGradePanel evidence={evidence} />);

    expect(screen.getByRole('heading', { name: 'Recorded outcome grades' })).toBeVisible();
    expect(screen.getByText('Development only')).toBeVisible();
    expect(screen.getByLabelText('Recorded grade D')).toBeVisible();
    expect(screen.getByText('Liam Reidy')).toBeVisible();
    expect(screen.getByText('1 of 2')).toBeVisible();
    expect(screen.getByText('Future pick has not been resolved through lineage.')).toBeVisible();
    expect(screen.getByText(/does not provide a grading formula/)).toBeVisible();
    expect(screen.getByText(/does not.*name a winner/)).toBeVisible();

    const carltonHeading = screen.getByRole('heading', { name: 'Carlton received' });
    expect(within(carltonHeading.closest('article')!).getByText('Liam Reidy')).toBeVisible();
    expect(screen.queryByText(/trade grade|fairness score/i)).toBeNull();
  });
});
