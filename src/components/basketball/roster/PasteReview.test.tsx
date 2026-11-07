import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type {
  NbaPlayerCandidate,
  PastedRosterLine,
} from '@/server/basketball/leagues/basketballLeagueDto';

import { PasteReview } from './PasteReview';

function candidate(
  id: string,
  fullName: string,
  rostered: NbaPlayerCandidate['rostered'] = null
): NbaPlayerCandidate {
  return { id, fullName, teamCode: 'NYK', positions: ['SG'], rostered };
}

const LINES: PastedRosterLine[] = [
  {
    line: 1,
    text: 'PG Marcus Hale BOS',
    name: 'Marcus Hale',
    status: 'matched',
    candidates: [candidate('p-hale', 'Marcus Hale')],
  },
  {
    line: 2,
    text: 'J. Price',
    name: 'J. Price',
    status: 'ambiguous',
    candidates: [candidate('p-jalen', 'Jalen Price'), candidate('p-jordan', 'Jordan Price')],
  },
  {
    line: 3,
    text: 'D Brooks',
    name: 'D Brooks',
    status: 'suggested',
    candidates: [candidate('p-brooks', 'Devin Brooks', { teamId: 'rival', teamName: 'Rival' })],
  },
  { line: 4, text: 'Nobody Here', name: 'Nobody Here', status: 'none', candidates: [] },
];

function renderReview(onConfirm = vi.fn()) {
  render(
    <PasteReview
      lines={LINES}
      targetTeamId="mine"
      targetLabel="My Team"
      busy={false}
      onConfirm={onConfirm}
      onCancel={vi.fn()}
    />
  );
  return onConfirm;
}

describe('PasteReview', () => {
  it('preselects matched and suggested players and waits for a choice on ambiguous lines', () => {
    const onConfirm = renderReview();

    const line1 = screen.getByRole('group', { name: /Line 1/ });
    expect(within(line1).getByRole('radio', { name: /Marcus Hale/ })).toBeChecked();
    const line3 = screen.getByRole('group', { name: /Line 3/ });
    expect(within(line3).getByRole('radio', { name: /Devin Brooks/ })).toBeChecked();
    expect(line3).toHaveTextContent('On Rival: adding moves him');

    const line2 = screen.getByRole('group', { name: /Line 2/ });
    expect(
      within(line2)
        .getAllByRole('radio')
        .some((radio) => (radio as HTMLInputElement).checked)
    ).toBe(false);
    expect(screen.getByText('Choose a player or Skip on 1 line.')).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: /Add .* to My Team/ });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('adds the chosen players in pasted order once every line is resolved', () => {
    const onConfirm = renderReview();

    fireEvent.click(
      within(screen.getByRole('group', { name: /Line 2/ })).getByRole('radio', {
        name: /Jordan Price/,
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add 3 players to My Team' }));

    expect(onConfirm).toHaveBeenCalledWith(['p-hale', 'p-jordan', 'p-brooks']);
  });

  it('leaves out skipped lines and lines with no match', () => {
    const onConfirm = renderReview();

    expect(screen.getByRole('group', { name: /Line 4/ })).toHaveTextContent('No match');
    fireEvent.click(
      within(screen.getByRole('group', { name: /Line 2/ })).getByRole('radio', { name: 'Skip' })
    );
    fireEvent.click(
      within(screen.getByRole('group', { name: /Line 1/ })).getByRole('radio', { name: 'Skip' })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add 1 player to My Team' }));

    expect(onConfirm).toHaveBeenCalledWith(['p-brooks']);
  });

  it('will not add the same player twice', () => {
    const onConfirm = vi.fn();
    // The same name pasted twice proposes the same player on both lines.
    render(
      <PasteReview
        lines={[LINES[0], { ...LINES[0], line: 5, text: 'Marcus Hale' }]}
        targetTeamId="mine"
        targetLabel="Bench Mob"
        busy={false}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    );

    expect(
      screen.getByText('Marcus Hale is chosen on lines 1 and 5. Skip one.')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /to Bench Mob/ })).toBeDisabled();
  });

  describe('compact, for players on other teams', () => {
    const MANY: PastedRosterLine[] = [
      ...LINES,
      {
        line: 5,
        text: 'BN Owen Carter BOS',
        name: 'Owen Carter',
        status: 'matched',
        candidates: [candidate('p-carter', 'Owen Carter', { teamId: 'mine', teamName: 'My Team' })],
      },
      {
        line: 6,
        text: 'Luca Moretti',
        name: 'Luca Moretti',
        status: 'matched',
        candidates: [candidate('p-moretti', 'Luca Moretti', { teamId: null, teamName: null })],
      },
      { line: 7, text: 'Rim Runners', name: 'Rim Runners', status: 'none', candidates: [] },
    ];

    function renderCompact(onConfirm = vi.fn()) {
      render(
        <PasteReview
          lines={MANY}
          targetTeamId={null}
          targetLabel="Rostered elsewhere"
          compact
          busy={false}
          onConfirm={onConfirm}
          onCancel={vi.fn()}
        />
      );
      return onConfirm;
    }

    it('counts each kind of line and keeps matched and unmatched lines behind disclosures', () => {
      renderCompact();

      const summary = screen.getByRole('list', { name: 'What was found' });
      expect(
        within(summary)
          .getAllByRole('listitem')
          .map((item) => item.textContent)
      ).toEqual([
        '3 matched',
        '1 to check',
        '1 to choose',
        '2 with no match',
        '2 already on a team you entered: left alone',
      ]);
      // Lines that need a look are open; matched lines and lines with no match are collapsed.
      expect(screen.getByRole('group', { name: /Line 2/ })).toBeVisible();
      expect(screen.getByRole('group', { name: /Line 3/ })).toBeVisible();
      expect(screen.getByText('Show 3 matched players').closest('details')).not.toHaveAttribute(
        'open'
      );
      expect(screen.getByText('Show 2 lines with no match').closest('details')).not.toHaveAttribute(
        'open'
      );
      expect(screen.getByRole('group', { name: /Line 3/ })).toHaveTextContent(
        'On Rival: left alone'
      );
      expect(screen.getByRole('group', { name: /Line 5/ })).toHaveTextContent(
        'On My Team: left alone'
      );
      expect(screen.getByRole('group', { name: /Line 6/ })).toHaveTextContent(
        'Already marked as taken'
      );
    });

    it('opens the matched lines when the same player is chosen twice', () => {
      render(
        <PasteReview
          lines={[MANY[0], { ...MANY[0], line: 8, text: 'Marcus Hale' }]}
          targetTeamId={null}
          targetLabel="Rostered elsewhere"
          compact
          busy={false}
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />
      );

      expect(
        screen.getByText('Marcus Hale is chosen on lines 1 and 8. Skip one.')
      ).toBeInTheDocument();
      expect(screen.getByText('Show 2 matched players').closest('details')).toHaveAttribute('open');
    });

    it('sends every chosen player but counts only those it will mark as taken', () => {
      const onConfirm = renderCompact();

      fireEvent.click(
        within(screen.getByRole('group', { name: /Line 2/ })).getByRole('radio', {
          name: /Jalen Price/,
        })
      );
      // The server is the authority on who is left alone, so every chosen player is sent.
      fireEvent.click(screen.getByRole('button', { name: 'Mark 3 players as taken' }));

      expect(onConfirm).toHaveBeenCalledWith([
        'p-hale',
        'p-jalen',
        'p-brooks',
        'p-carter',
        'p-moretti',
      ]);
    });
  });
});
