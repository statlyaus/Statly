import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DraftScheduleField } from '@/components/draft/DraftScheduleField';
import type { DraftScheduleValue } from '@/lib/draftSchedule';

function ScheduleHarness({
  initialValue = { date: '', time: '', timeZone: 'Australia/Melbourne' },
  allowUnscheduled = true,
}: {
  initialValue?: DraftScheduleValue;
  allowUnscheduled?: boolean;
}) {
  const [value, setValue] = useState(initialValue);

  return (
    <DraftScheduleField
      value={value}
      onChange={setValue}
      allowUnscheduled={allowUnscheduled}
      minimumInstant={new Date('2026-07-29T07:05:00.000Z')}
    />
  );
}

describe('DraftScheduleField', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-29T07:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps an optional schedule collapsed until the commissioner chooses to add one', () => {
    const { container } = render(<ScheduleHarness />);

    expect(screen.getByText('Draft not scheduled')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add draft schedule' })).toBeInTheDocument();
    expect(container.querySelector('input[type="datetime-local"]')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Start time')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add draft schedule' }));

    expect(screen.getByText('Choose a draft date')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Schedule later' })).toHaveFocus();
    expect(screen.getByText('Select one available day from the calendar.')).toBeInTheDocument();
    expect(screen.getByLabelText('Start time')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'League time zone' })).toHaveValue(
      'Australia/Melbourne'
    );
    expect(screen.getByRole('button', { name: /previous month/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /next month/i })).toBeInTheDocument();
  });

  it('applies a friendly preset and announces the resolved league-local schedule', () => {
    const { container } = render(<ScheduleHarness />);

    fireEvent.click(screen.getByRole('button', { name: 'Add draft schedule' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Schedule the draft for tomorrow at 7:00 pm' })
    );

    expect(screen.getByLabelText('Start time')).toHaveValue('19:00');
    const summary = screen.getByText('Thursday 30 July 2026 at 7:00 pm AEST');
    expect(summary).toBeInTheDocument();
    expect(summary.closest('[aria-live="polite"]')).toHaveClass(
      'bg-[color:var(--league-success-soft)]'
    );

    const selectedDate = container.querySelector('[data-day="2026-07-30"]');
    expect(selectedDate).toHaveAttribute('aria-selected', 'true');
    expect(selectedDate?.className).toContain('[&>button]:bg-primary');

    const unavailableDate = container.querySelector('[data-day="2026-07-28"]');
    expect(unavailableDate).toHaveAttribute('data-disabled', 'true');
    expect(unavailableDate?.className).not.toContain('line-through');
  });

  it('clears an optional schedule and restores the explicit deferred state', () => {
    render(
      <ScheduleHarness
        initialValue={{
          date: '2026-08-01',
          time: '19:00',
          timeZone: 'Australia/Melbourne',
        }}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Schedule later' }));

    expect(screen.getByText('Draft not scheduled')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add draft schedule' })).toHaveFocus();
    expect(screen.queryByLabelText('Start time')).not.toBeInTheDocument();
  });

  it('keeps a required schedule expanded and exposes invalid state programmatically', () => {
    render(<ScheduleHarness allowUnscheduled={false} />);

    expect(screen.getByLabelText('Start time')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a draft date and start time.');
    expect(screen.queryByRole('button', { name: 'Schedule later' })).not.toBeInTheDocument();
  });

  it('renders an invalid time-zone error without evaluating zone-dependent summaries', () => {
    render(
      <ScheduleHarness
        allowUnscheduled={false}
        initialValue={{ date: '2026-08-01', time: '19:00', timeZone: 'Mars/Olympus_Mons' }}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Choose a valid league time zone.');
    expect(screen.getByRole('combobox', { name: 'League time zone' })).toHaveValue(
      'Mars/Olympus_Mons'
    );
    expect(
      screen.queryByRole('button', { name: 'Schedule the draft for tomorrow at 7:00 pm' })
    ).not.toBeInTheDocument();
  });
});
