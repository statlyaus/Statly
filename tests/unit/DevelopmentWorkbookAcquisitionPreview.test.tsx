import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DevelopmentWorkbookAcquisitionPreview } from '@/components/draft/DevelopmentWorkbookAcquisitionPreview';

describe('DevelopmentWorkbookAcquisitionPreview', () => {
  it('labels workbook-only data and preserves acquisition mechanisms', () => {
    render(
      <DevelopmentWorkbookAcquisitionPreview
        query={{ year: null, club: '', q: '', category: 'rookie_draft', limit: 25 }}
        preview={{
          total: 1,
          years: [2025],
          categoryCounts: {
            national_draft: 0,
            rookie_draft: 1,
            mid_season_draft: 0,
            pre_season_draft: 0,
            mini_draft: 0,
            trade: 0,
            free_agency: 0,
            pre_draft: 0,
            post_draft: 0,
            training_squad_selection: 0,
          },
          items: [
            {
              eventId: '2025_0001',
              year: 2025,
              category: 'rookie_draft',
              acquisitionType: 'Rookie',
              signing: null,
              pick: '12',
              draftNumber: 12,
              clubName: 'Carlton',
              playerName: 'Fixture Player',
              age: 20,
              heightCm: 188,
              weightKg: 85,
              originalClub: 'Fixture Club',
              grade: 'B',
              games: '15',
              goals: '3',
              coachesVotes: '2',
              brownlowVotes: '1',
              awards: null,
            },
          ],
        }}
      />
    );

    expect(screen.getByRole('heading', { name: 'Workbook acquisition preview' })).toBeVisible();
    expect(screen.getByText('Development only')).toBeVisible();
    expect(screen.getAllByText('Rookie draft')).not.toHaveLength(0);
    expect(screen.getByRole('heading', { name: 'Fixture Player' })).toBeVisible();
    expect(screen.getByText('Source grade B')).toBeVisible();
    expect(screen.getByText(/not a reviewed factual release/i)).toBeVisible();
    expect(
      screen.getByRole('form', { name: 'Filter development workbook acquisitions' })
    ).toBeVisible();
  });
});
