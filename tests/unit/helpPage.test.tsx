import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import HelpPage from '@/app/(app)/help/page';
import { FANTASY_CATEGORIES, REAL_DATA_NINE_CATEGORY_PRESET } from '@/types/fantasyCategories';

describe('/help', () => {
  it('lists the default categories from the category registry', () => {
    render(<HelpPage />);

    for (const key of REAL_DATA_NINE_CATEGORY_PRESET) {
      expect(screen.getByText(FANTASY_CATEGORIES[key].label)).toBeInTheDocument();
    }
  });

  it('explains category head-to-head, not salary-cap fantasy', () => {
    const { container } = render(<HelpPage />);
    const text = container.textContent ?? '';

    expect(text).toContain('Each category:');
    expect(text).toContain('Most categories:');
    expect(text).toContain('lower wins');
    expect(text).toContain('6 am Melbourne');
    expect(text).toContain('7 pm Thursday, Sydney time');
    expect(text).not.toMatch(/price change|trades per week|points each/i);
  });

  it('offers no contact form or chat that sends nothing', () => {
    render(<HelpPage />);

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
