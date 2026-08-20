import { fireEvent, render, screen, within } from '@testing-library/react';

import { AflTradePackageEvaluationPanel } from '@/components/draft/AflTradePackageEvaluationPanel';
import { createGovernedPrivateEvaluationNarrativeFixture } from '../testUtils/governedPrivateEvaluationFixture';
import { createGovernedPrivateEvaluationMultiClubNarrativeFixture } from '../testUtils/governedPrivateEvaluationMultiClubFixture';

describe('AFL trade package evaluation panel', () => {
  it('shows one complete package grade per club and tells each asset story under one view switch', () => {
    const narrative = createGovernedPrivateEvaluationNarrativeFixture();
    render(<AflTradePackageEvaluationPanel narrative={narrative.content} />);

    expect(screen.getByRole('group', { name: 'Trade valuation views' })).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(2);
    const adelaide = screen.getByRole('article', { name: 'Adelaide package' });
    const stKilda = screen.getByRole('article', { name: 'St Kilda package' });
    expect(within(adelaide).getByText('Received')).toBeInTheDocument();
    expect(within(adelaide).getByText('Gave up')).toBeInTheDocument();
    expect(within(adelaide).getByText(/92 - 70 = \+22 fixed_horizon_pav/u)).toBeInTheDocument();
    expect(within(adelaide).getByLabelText(/Adelaide provisional package grade A\+/u)).toBeInTheDocument();
    expect(within(stKilda).getByLabelText(/St Kilda provisional package grade D/u)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Realized' }));
    expect(
      within(adelaide).getByText(/72 fixed_horizon_pav from 150 games at 0.48 per game/u)
    ).toBeInTheDocument();

    fireEvent.click(within(adelaide).getByText('Pick 14 calculation and lineage'));
    expect(
      within(adelaide).getAllByText(/48 observations across 12 draft classes/u)
    ).not.toHaveLength(0);
    expect(
      within(adelaide).getByText('Pick 14', { selector: '[data-lineage-label]' })
    ).toBeInTheDocument();
    expect(screen.queryByText(/asset grade/iu)).not.toBeInTheDocument();
  });

  it('switches current contribution stories without splitting assets from their club packages', () => {
    const narrative = createGovernedPrivateEvaluationNarrativeFixture();
    render(<AflTradePackageEvaluationPanel narrative={narrative.content} />);

    expect(screen.getAllByText(/92 = 72 realized \+ 20 remaining fixed_horizon_pav/u)).not.toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'At trade' }));
    expect(
      screen.getAllByText(/70 fixed_horizon_pav expected from 48 observations across 12 draft classes/u)
    ).not.toHaveLength(0);
    expect(screen.getAllByRole('article')).toHaveLength(2);
  });

  it.each([3, 4] as const)(
    'renders one complete package bank for every club in a %i-club transaction',
    (clubCount) => {
      const narrative = createGovernedPrivateEvaluationMultiClubNarrativeFixture(clubCount);
      render(<AflTradePackageEvaluationPanel narrative={narrative.content} />);

      expect(screen.getAllByRole('group', { name: 'Trade valuation views' })).toHaveLength(1);
      const packages = screen.getAllByRole('article');
      expect(packages).toHaveLength(clubCount);
      for (let index = 0; index < clubCount; index += 1) {
        const clubPackage = screen.getByRole('article', {
          name: `Fixture Club ${index + 1} package`,
        });
        expect(within(clubPackage).getByRole('region', { name: 'Received package' })).toBeInTheDocument();
        expect(within(clubPackage).getByRole('region', { name: 'Gave up package' })).toBeInTheDocument();
        expect(
          within(clubPackage).getByLabelText(
            `Fixture Club ${index + 1} provisional package grade B`
          )
        ).toBeInTheDocument();
      }
      const current = narrative.content.views.find(({ view }) => view === 'current')!;
      expect(
        current.clubs.reduce(
          (total, club) => total + club.arithmetic.estimatedAdvantageMean,
          0
        )
      ).toBe(0);
    }
  );
});
