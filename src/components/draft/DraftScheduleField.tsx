'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { CalendarDays, CheckCircle2, Clock3, Plus, Sparkles, X } from 'lucide-react';

import { Calendar } from '@/components/ui/calendar';
import {
  calendarDateToDraftDate,
  draftScheduleDateForCalendar,
  draftScheduleFromInstant,
  formatDraftScheduleSummary,
  isDraftScheduleEmpty,
  resolveDraftSchedule,
  type DraftScheduleValue,
} from '@/lib/draftSchedule';
import { COMMON_TIMEZONES, isValidTimeZone } from '@/lib/timezone';
import { cn } from '@/lib/utils';

interface DraftScheduleFieldProps {
  value: DraftScheduleValue;
  onChange: (value: DraftScheduleValue) => void;
  heading?: string;
  description?: string;
  allowUnscheduled?: boolean;
  minimumInstant?: Date;
  className?: string;
}

interface SchedulePreset {
  label: string;
  ariaLabel: string;
  value: DraftScheduleValue;
}

function offsetDatePart(datePart: string, offsetDays: number): string {
  const [year, month, day] = datePart.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + offsetDays, 12));
  return [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()]
    .map((part, index) => String(part).padStart(index === 0 ? 4 : 2, '0'))
    .join('-');
}

function getNextSaturdayDatePart(datePart: string): string {
  const [year, month, day] = datePart.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  const daysUntilSaturday = (6 - date.getUTCDay() + 7) % 7 || 7;
  return offsetDatePart(datePart, daysUntilSaturday);
}

function buildSchedulePresets(now: Date, timeZone: string): SchedulePreset[] {
  const current = draftScheduleFromInstant(now, timeZone);
  return [
    {
      label: 'Tomorrow · 7:00 pm',
      ariaLabel: 'Schedule the draft for tomorrow at 7:00 pm',
      value: { date: offsetDatePart(current.date, 1), time: '19:00', timeZone },
    },
    {
      label: 'Next Saturday · 2:00 pm',
      ariaLabel: 'Schedule the draft for next Saturday at 2:00 pm',
      value: { date: getNextSaturdayDatePart(current.date), time: '14:00', timeZone },
    },
  ];
}

interface ScheduleCalendarPaneProps {
  instructionId: string;
  minimumDate?: Date;
  selectedDate?: Date;
  summary: string | null;
  timeZone?: string;
  onSelectDate: (date: Date) => void;
}

function ScheduleCalendarPane({
  instructionId,
  minimumDate,
  selectedDate,
  summary,
  timeZone,
  onSelectDate,
}: ScheduleCalendarPaneProps) {
  return (
    <div className="min-w-0 rounded-xl border border-[color:var(--league-accent)]/30 bg-[color:var(--league-accent-soft)]/65 p-2 sm:p-3">
      <div className="mb-3 flex items-start gap-3 rounded-lg bg-[color:var(--league-surface)] px-3 py-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[color:var(--league-accent)] text-xs font-bold text-white">
          1
        </span>
        <div>
          <p id={instructionId} className="text-sm font-semibold text-[color:var(--league-text)]">
            Choose a draft date
          </p>
          <p className="mt-0.5 text-xs leading-5 text-[color:var(--league-text-muted)]">
            Select one available day from the calendar.
          </p>
        </div>
      </div>
      <Calendar
        mode="single"
        aria-labelledby={instructionId}
        selected={selectedDate}
        defaultMonth={selectedDate ?? minimumDate}
        onSelect={(date) => {
          if (date) onSelectDate(date);
        }}
        disabled={minimumDate ? { before: minimumDate } : undefined}
        timeZone={timeZone}
        footer={summary ? `Selected ${summary}` : 'Choose a draft date.'}
        className="rounded-lg bg-[color:var(--league-surface)] p-2 [--accent-foreground:var(--league-accent)] [--accent:var(--league-accent-soft)] [--background:var(--league-surface)] [--border:var(--league-border)] [--foreground:var(--league-text)] [--muted-foreground:var(--league-text-muted)] [--primary-foreground:var(--league-primary-foreground)] [--primary:var(--league-primary)] [--ring:var(--league-primary)]"
      />
    </div>
  );
}

interface ScheduleTimeZoneOption {
  value: string;
  label: string;
}

interface ScheduleDetailsPaneProps {
  value: DraftScheduleValue;
  timeId: string;
  timeZoneId: string;
  fieldDescription: string;
  errorId: string;
  summaryId: string;
  errorMessage: string | null;
  summary: string | null;
  presets: SchedulePreset[];
  timeZoneOptions: readonly ScheduleTimeZoneOption[];
  onChange: (next: Partial<DraftScheduleValue>) => void;
  onApplyPreset: (preset: SchedulePreset) => void;
}

function ScheduleDetailsPane({
  value,
  timeId,
  timeZoneId,
  fieldDescription,
  errorId,
  summaryId,
  errorMessage,
  summary,
  presets,
  timeZoneOptions,
  onChange,
  onApplyPreset,
}: ScheduleDetailsPaneProps) {
  const hasResolvedSchedule = Boolean(summary && !errorMessage);

  return (
    <div className="flex min-w-0 flex-col gap-4 rounded-xl border border-[color:var(--league-border)] bg-[color:var(--league-page)] p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[color:var(--league-primary)] text-xs font-bold text-[color:var(--league-primary-foreground)]">
          2
        </span>
        <div>
          <p className="text-sm font-semibold text-[color:var(--league-text)]">
            Set the local start time
          </p>
          <p className="mt-0.5 text-xs leading-5 text-[color:var(--league-text-muted)]">
            Confirm the clock time and league time zone.
          </p>
        </div>
      </div>

      <div>
        <label htmlFor={timeId} className="text-sm font-semibold text-[color:var(--league-text)]">
          Start time
        </label>
        <div className="relative mt-2">
          <Clock3
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            id={timeId}
            type="time"
            value={value.time}
            onChange={(event) => onChange({ time: event.target.value })}
            aria-describedby={fieldDescription}
            aria-invalid={Boolean(errorMessage)}
            className="h-11 w-full rounded-lg border border-[color:var(--league-border)] bg-[color:var(--league-surface)] pl-10 pr-3 text-sm font-medium text-[color:var(--league-text)] outline-none transition focus:border-[color:var(--league-primary)] focus:ring-2 focus:ring-[color:var(--league-primary)]/25"
          />
        </div>
      </div>

      <div>
        <label
          htmlFor={timeZoneId}
          className="text-sm font-semibold text-[color:var(--league-text)]"
        >
          League time zone
        </label>
        <select
          id={timeZoneId}
          value={value.timeZone}
          onChange={(event) => onChange({ timeZone: event.target.value })}
          aria-describedby={fieldDescription}
          aria-invalid={Boolean(errorMessage)}
          className="mt-2 h-11 w-full rounded-lg border border-[color:var(--league-border)] bg-[color:var(--league-surface)] px-3 text-sm font-medium text-[color:var(--league-text)] outline-none transition focus:border-[color:var(--league-primary)] focus:ring-2 focus:ring-[color:var(--league-primary)]/25"
        >
          {timeZoneOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <p className="mt-2 text-xs leading-5 text-[color:var(--league-text-muted)]">
          The saved draft time will use this league time zone.
        </p>
      </div>

      <div>
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--league-text-muted)]">
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
          Quick choices
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {presets.map((preset) => (
            <button
              key={preset.label}
              type="button"
              aria-label={preset.ariaLabel}
              onClick={() => onApplyPreset(preset)}
              className="min-h-10 rounded-lg border border-[color:var(--league-border)] bg-[color:var(--league-surface)] px-3 py-2 text-sm font-medium text-[color:var(--league-text)] transition-colors hover:border-[color:var(--league-accent)]/50 hover:bg-[color:var(--league-accent-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)] focus-visible:ring-offset-2"
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      <div
        id={summaryId}
        aria-live="polite"
        className={cn(
          'mt-auto rounded-xl border px-4 py-3',
          hasResolvedSchedule
            ? 'border-[color:var(--league-success)]/30 bg-[color:var(--league-success-soft)]'
            : 'border-[color:var(--league-border)] bg-[color:var(--league-surface-muted)]'
        )}
      >
        {hasResolvedSchedule ? (
          <div className="flex gap-3">
            <CheckCircle2
              className="mt-0.5 h-5 w-5 shrink-0 text-[color:var(--league-success)]"
              aria-hidden="true"
            />
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--league-success)]">
                Draft starts
              </p>
              <p className="mt-1 text-sm font-semibold leading-6 text-[color:var(--league-text)]">
                {summary}
              </p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-[color:var(--league-text-muted)]">
            Choose a date and time to confirm the league schedule.
          </p>
        )}
      </div>

      {errorMessage && (
        <p id={errorId} role="alert" className="text-sm font-medium text-destructive">
          {errorMessage}
        </p>
      )}
    </div>
  );
}

export function DraftScheduleField({
  value,
  onChange,
  heading = 'Draft schedule',
  description = 'Choose when the draft room should open for league managers.',
  allowUnscheduled = true,
  minimumInstant,
  className,
}: DraftScheduleFieldProps) {
  const generatedId = useId();
  const headingId = `${generatedId}-heading`;
  const descriptionId = `${generatedId}-description`;
  const dateInstructionId = `${generatedId}-date-instruction`;
  const timeId = `${generatedId}-time`;
  const timeZoneId = `${generatedId}-timezone`;
  const errorId = `${generatedId}-error`;
  const summaryId = `${generatedId}-summary`;
  const effectiveMinimum = minimumInstant ?? new Date();
  const empty = isDraftScheduleEmpty(value);
  const [isExpanded, setIsExpanded] = useState(!allowUnscheduled || !empty);
  const addScheduleButtonRef = useRef<HTMLButtonElement>(null);
  const scheduleLaterButtonRef = useRef<HTMLButtonElement>(null);
  const focusAfterToggleRef = useRef<'add' | 'defer' | null>(null);

  useEffect(() => {
    if (!empty) setIsExpanded(true);
  }, [empty]);

  useEffect(() => {
    const target = focusAfterToggleRef.current;
    if (!target) return;

    focusAfterToggleRef.current = null;
    if (target === 'defer') {
      scheduleLaterButtonRef.current?.focus();
    } else {
      addScheduleButtonRef.current?.focus();
    }
  }, [isExpanded]);

  const timeZoneIsValid = isValidTimeZone(value.timeZone);
  const selectedDate = draftScheduleDateForCalendar(value);
  const minimumDate = timeZoneIsValid
    ? draftScheduleDateForCalendar(draftScheduleFromInstant(effectiveMinimum, value.timeZone))
    : undefined;
  const resolution = resolveDraftSchedule(value, effectiveMinimum);
  const errorMessage =
    !allowUnscheduled && resolution.status === 'empty'
      ? 'Choose a draft date and start time.'
      : resolution.status === 'invalid'
        ? resolution.error.message
        : null;
  const fieldDescription = [descriptionId, errorMessage ? errorId : null].filter(Boolean).join(' ');
  const summary = timeZoneIsValid ? formatDraftScheduleSummary(value) : null;
  const presets = timeZoneIsValid ? buildSchedulePresets(effectiveMinimum, value.timeZone) : [];
  const timeZoneOptions = COMMON_TIMEZONES.some((option) => option.value === value.timeZone)
    ? COMMON_TIMEZONES
    : [
        { value: value.timeZone, label: `${value.timeZone} (detected)`, offset: '' },
        ...COMMON_TIMEZONES,
      ];

  const updateValue = (next: Partial<DraftScheduleValue>) => {
    onChange({ ...value, ...next });
  };

  const clearSchedule = () => {
    onChange({ date: '', time: '', timeZone: value.timeZone });
    if (allowUnscheduled) {
      focusAfterToggleRef.current = 'add';
      setIsExpanded(false);
    }
  };

  const expandSchedule = () => {
    focusAfterToggleRef.current = 'defer';
    setIsExpanded(true);
  };

  const selectDate = (date: Date) => {
    if (!timeZoneIsValid) return;
    updateValue({
      date: calendarDateToDraftDate(date, value.timeZone),
      time: value.time || '19:00',
    });
  };

  const applyPreset = (preset: SchedulePreset) => {
    onChange(preset.value);
  };

  return (
    <fieldset
      aria-labelledby={headingId}
      aria-describedby={descriptionId}
      aria-invalid={Boolean(errorMessage)}
      className={cn(
        'rounded-2xl border border-[color:var(--league-border)] bg-[color:var(--league-surface)] text-[color:var(--league-text)] shadow-sm',
        className
      )}
    >
      <legend className="sr-only">{heading}</legend>

      <div className="flex flex-col gap-4 border-b border-[color:var(--league-border)] p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
        <div className="flex min-w-0 gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[color:var(--league-accent-soft)] text-[color:var(--league-accent)]">
            <CalendarDays className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h3 id={headingId} className="text-base font-semibold text-[color:var(--league-text)]">
              {heading}
            </h3>
            <p
              id={descriptionId}
              className="mt-1 max-w-2xl text-sm leading-6 text-[color:var(--league-text-muted)]"
            >
              {description}
            </p>
          </div>
        </div>

        {allowUnscheduled && isExpanded && (
          <button
            ref={scheduleLaterButtonRef}
            type="button"
            onClick={clearSchedule}
            className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-[color:var(--league-border)] bg-[color:var(--league-surface)] px-3 text-sm font-medium text-[color:var(--league-text)] transition-colors hover:bg-[color:var(--league-surface-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)] focus-visible:ring-offset-2"
          >
            <X className="h-4 w-4" aria-hidden="true" />
            Schedule later
          </button>
        )}
      </div>

      {!isExpanded ? (
        <div className="p-4 sm:p-5">
          <div className="flex flex-col gap-4 rounded-xl border border-dashed border-[color:var(--league-border)] bg-[color:var(--league-surface-muted)] p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-[color:var(--league-text)]">
                Draft not scheduled
              </p>
              <p className="mt-1 text-sm text-[color:var(--league-text-muted)]">
                You can set the date now or schedule it later from commissioner tools.
              </p>
            </div>
            <button
              ref={addScheduleButtonRef}
              type="button"
              onClick={expandSchedule}
              className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-[color:var(--league-primary)] px-4 text-sm font-semibold text-[color:var(--league-primary-foreground)] transition-colors hover:bg-[color:var(--league-primary-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)] focus-visible:ring-offset-2"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add draft schedule
            </button>
          </div>
        </div>
      ) : (
        <div className="grid gap-5 p-4 sm:p-5 lg:grid-cols-[minmax(18rem,1fr)_minmax(16rem,0.82fr)]">
          <ScheduleCalendarPane
            instructionId={dateInstructionId}
            minimumDate={minimumDate}
            selectedDate={selectedDate}
            summary={summary}
            timeZone={timeZoneIsValid ? value.timeZone : undefined}
            onSelectDate={selectDate}
          />

          <ScheduleDetailsPane
            value={value}
            timeId={timeId}
            timeZoneId={timeZoneId}
            fieldDescription={fieldDescription}
            errorId={errorId}
            summaryId={summaryId}
            errorMessage={errorMessage}
            summary={summary}
            presets={presets}
            timeZoneOptions={timeZoneOptions}
            onChange={updateValue}
            onApplyPreset={applyPreset}
          />
        </div>
      )}
    </fieldset>
  );
}
