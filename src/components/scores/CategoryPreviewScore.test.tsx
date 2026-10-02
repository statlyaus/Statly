import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CategoryPreviewScore } from './CategoryPreviewScore';

describe('CategoryPreviewScore', () => {
  it('shows one captioned column per scoring category with nothing scored yet', () => {
    render(<CategoryPreviewScore categories={['goals', 'tackles', 'inside50s']} />);

    const table = screen.getByRole('table', {
      name: /preview of your weekly matchup, no fixtures yet/i,
    });
    expect(within(table).getAllByRole('columnheader')).toHaveLength(3 + 1);
    expect(within(table).getByTitle('Goals')).toBeInTheDocument();
    expect(within(table).getByTitle('Tackles')).toBeInTheDocument();
    expect(within(table).getByTitle('Inside 50s')).toBeInTheDocument();
    expect(within(table).getAllByText(/not started/i)).toHaveLength(3);
    expect(within(table).queryByText(/won|lost/i)).not.toBeInTheDocument();
  });

  it('ignores category keys the app does not know instead of inventing columns', () => {
    render(<CategoryPreviewScore categories={['goals', 'not-a-real-category']} />);

    const table = screen.getByRole('table');
    expect(within(table).getByTitle('Goals')).toBeInTheDocument();
    expect(within(table).getAllByRole('columnheader')).toHaveLength(1 + 1);
    expect(within(table).queryByText(/not-a-real-category/i)).not.toBeInTheDocument();
  });

  it('renders nothing when the league has no valid categories', () => {
    const { container } = render(<CategoryPreviewScore categories={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
