'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';

import { buttonStyles } from '@/components/ui/controlStyles';
import type { BasketballLeagueDetail } from '@/server/basketball/leagues/basketballLeagueDto';

import { callBasketballApi } from '../shell/basketballApi';
import { basketballLeagueHref } from '../shell/basketballFormat';
import { ErrorSummary } from '../shell/formParts';
import {
  LEAGUE_FIELD_IDS,
  groupFieldErrors,
  leagueValuesFromDetail,
  newLeagueValues,
  summaryErrors,
  toLeaguePayload,
  type FieldErrors,
  type LeagueFormValues,
} from './leagueForm';
import { AuctionSection } from './sections/AuctionSection';
import { BasicsSection } from './sections/BasicsSection';
import { CalendarSection } from './sections/CalendarSection';
import { CategoriesSection } from './sections/CategoriesSection';
import { RosterSlotsSection } from './sections/RosterSlotsSection';
import { TeamsSection } from './sections/TeamsSection';
import type { LeagueSectionProps } from './sections/sectionProps';

type Props =
  { mode: 'create'; league?: undefined } | { mode: 'edit'; league: BasketballLeagueDetail };

/**
 * League settings for a new profile (POST, then the Roster page) or an existing one (PATCH, then a
 * refresh). Each setting says in one line what it changes in Statly. The server validates; its
 * field errors appear beside each field and in a summary that takes focus.
 */
export function BasketballLeagueForm({ mode, league }: Props) {
  const router = useRouter();
  const [values, setValues] = useState<LeagueFormValues>(() =>
    league ? leagueValuesFromDetail(league) : newLeagueValues()
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const [focusRequest, setFocusRequest] = useState(0);

  useEffect(() => {
    if (focusRequest > 0) summaryRef.current?.focus();
  }, [focusRequest]);

  const summary = useMemo(() => summaryErrors(errors), [errors]);
  const error = (key: string) => errors[key]?.join(' ');
  const create = mode === 'create';

  function update<K extends keyof LeagueFormValues>(key: K, value: LeagueFormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    setSaved(false);
  }

  function showErrors(fieldErrors: FieldErrors, messages: string[]) {
    setErrors(groupFieldErrors(fieldErrors, values));
    setFormErrors(messages);
    setFocusRequest((count) => count + 1);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setSaved(false);
    const built = toLeaguePayload(values, mode);
    if (!built.ok) {
      showErrors(built.fieldErrors, []);
      return;
    }

    setPending(true);
    const result = league
      ? await callBasketballApi<BasketballLeagueDetail>(
          `/api/basketball/leagues/${encodeURIComponent(league.id)}`,
          'PATCH',
          built.payload
        )
      : await callBasketballApi<BasketballLeagueDetail>(
          '/api/basketball/leagues',
          'POST',
          built.payload
        );

    if (!result.ok) {
      setPending(false);
      const hasFieldErrors = Object.keys(result.fieldErrors).length > 0;
      showErrors(
        result.fieldErrors,
        hasFieldErrors && result.formErrors.length === 0
          ? []
          : [...result.formErrors, result.message]
      );
      return;
    }

    setErrors({});
    setFormErrors([]);
    if (create) {
      // Keep the button busy while the Roster page loads.
      router.push(basketballLeagueHref(result.data.id, 'roster'));
      return;
    }
    setPending(false);
    setSaved(true);
    router.refresh();
  }

  const errorCount = summary.length + formErrors.length;
  const section: LeagueSectionProps = { values, update, error, ids: LEAGUE_FIELD_IDS };

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-busy={pending || undefined}
      className="[&_[aria-invalid=true]]:border-destructive"
    >
      {errorCount > 0 ? (
        <div className="mb-2">
          <ErrorSummary
            ref={summaryRef}
            title={`Check ${errorCount} ${errorCount === 1 ? 'field' : 'fields'}`}
            formErrors={formErrors}
            errors={summary}
          />
        </div>
      ) : null}

      <BasicsSection {...section} />
      <CategoriesSection {...section} />
      <TeamsSection {...section} create={create} />
      <RosterSlotsSection {...section} />
      <CalendarSection {...section} />
      <AuctionSection {...section} />

      <div className="flex flex-col-reverse gap-3 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-end">
        {saved ? (
          <p role="status" className="text-sm font-medium text-foreground sm:mr-auto">
            Settings saved.
          </p>
        ) : null}
        {create ? (
          <Link href="/basketball" className={buttonStyles({ variant: 'outline' })}>
            Cancel
          </Link>
        ) : null}
        <button type="submit" disabled={pending} className={buttonStyles({ variant: 'primary' })}>
          {pending
            ? create
              ? 'Creating…'
              : 'Saving…'
            : create
              ? 'Create league'
              : 'Save settings'}
        </button>
      </div>
    </form>
  );
}
