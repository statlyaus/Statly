'use client';

import type { ComponentProps } from 'react';
import { DayPicker, DayFlag, SelectionState, UI, type ChevronProps } from 'react-day-picker';
import { enAU } from 'react-day-picker/locale';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react';

import { cn } from '@/lib/utils';

function CalendarChevron({ className, disabled, orientation = 'right' }: ChevronProps) {
  const Icon =
    orientation === 'left'
      ? ChevronLeft
      : orientation === 'up'
        ? ChevronUp
        : orientation === 'down'
          ? ChevronDown
          : ChevronRight;

  return <Icon aria-hidden="true" className={cn('h-4 w-4', disabled && 'opacity-50', className)} />;
}

export function Calendar({
  className,
  classNames,
  components,
  locale = enAU,
  showOutsideDays = true,
  ...props
}: ComponentProps<typeof DayPicker>) {
  return (
    <DayPicker
      locale={locale}
      showOutsideDays={showOutsideDays}
      navLayout="around"
      className={cn('w-full select-none text-foreground', className)}
      classNames={{
        [UI.Root]: cn('w-full', classNames?.[UI.Root]),
        [UI.Months]: cn('w-full', classNames?.[UI.Months]),
        [UI.Month]: cn('relative w-full', classNames?.[UI.Month]),
        [UI.MonthCaption]: cn(
          'relative flex h-11 items-center justify-center',
          classNames?.[UI.MonthCaption]
        ),
        [UI.CaptionLabel]: cn(
          'text-sm font-semibold text-foreground',
          classNames?.[UI.CaptionLabel]
        ),
        [UI.Nav]: cn(
          'pointer-events-none absolute inset-x-0 top-0 flex h-11 items-center justify-between',
          classNames?.[UI.Nav]
        ),
        [UI.PreviousMonthButton]: cn(
          'pointer-events-auto absolute left-0 top-0 z-10 inline-flex h-11 w-11 items-center justify-center rounded-lg border border-border bg-background text-foreground transition-colors hover:border-accent-foreground/30 hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40',
          classNames?.[UI.PreviousMonthButton]
        ),
        [UI.NextMonthButton]: cn(
          'pointer-events-auto absolute right-0 top-0 z-10 inline-flex h-11 w-11 items-center justify-center rounded-lg border border-border bg-background text-foreground transition-colors hover:border-accent-foreground/30 hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40',
          classNames?.[UI.NextMonthButton]
        ),
        [UI.Chevron]: cn('text-foreground', classNames?.[UI.Chevron]),
        [UI.MonthGrid]: cn('mt-3 w-full table-fixed border-collapse', classNames?.[UI.MonthGrid]),
        [UI.Weekdays]: cn('border-b border-border', classNames?.[UI.Weekdays]),
        [UI.Weekday]: cn(
          'h-9 p-0 text-center text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground',
          classNames?.[UI.Weekday]
        ),
        [UI.Week]: cn('border-0', classNames?.[UI.Week]),
        [UI.Day]: cn('h-11 p-0 text-center align-middle', classNames?.[UI.Day]),
        [UI.DayButton]: cn(
          'mx-auto inline-flex h-10 w-10 items-center justify-center rounded-lg border border-transparent text-sm font-medium text-foreground transition-colors hover:border-accent-foreground/30 hover:bg-accent hover:text-accent-foreground focus-visible:relative focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:h-11 sm:w-11',
          classNames?.[UI.DayButton]
        ),
        [UI.Footer]: cn('sr-only', classNames?.[UI.Footer]),
        [DayFlag.today]: cn(
          '[&>button]:border-accent-foreground/45 [&>button]:bg-accent [&>button]:font-semibold [&>button]:text-accent-foreground',
          classNames?.[DayFlag.today]
        ),
        [DayFlag.outside]: cn(
          '[&>button]:text-muted-foreground [&>button]:opacity-60',
          classNames?.[DayFlag.outside]
        ),
        [DayFlag.disabled]: cn(
          '[&>button]:cursor-not-allowed [&>button]:text-muted-foreground [&>button]:opacity-40 [&>button]:hover:border-transparent [&>button]:hover:bg-transparent [&>button]:hover:text-muted-foreground',
          classNames?.[DayFlag.disabled]
        ),
        [DayFlag.hidden]: cn('invisible', classNames?.[DayFlag.hidden]),
        [DayFlag.focused]: cn(
          '[&>button]:ring-2 [&>button]:ring-ring',
          classNames?.[DayFlag.focused]
        ),
        [SelectionState.selected]: cn(
          '[&>button]:border-primary [&>button]:bg-primary [&>button]:font-semibold [&>button]:text-primary-foreground [&>button]:hover:bg-primary',
          classNames?.[SelectionState.selected]
        ),
      }}
      components={{
        Chevron: CalendarChevron,
        ...components,
      }}
      {...props}
    />
  );
}
