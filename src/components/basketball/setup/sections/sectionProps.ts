import type { LeagueFieldIds, LeagueFormValues } from '../leagueForm';

/** What every section of the league form takes from the form that owns the state. */
export interface LeagueSectionProps {
  values: LeagueFormValues;
  update: <K extends keyof LeagueFormValues>(key: K, value: LeagueFormValues[K]) => void;
  /** The field's server or input error, joined; keys are API paths such as `rosterSlots.PG`. */
  error: (key: string) => string | undefined;
  ids: LeagueFieldIds;
}
