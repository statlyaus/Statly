import {
  selectableLeagueFormatOptions,
  NO_LOSERS_EXPLANATION,
  parseLeagueFormat,
} from '@/lib/leagueFormatOptions';
import type { FantasyCategoryKey } from '@/types/fantasyCategories';
import { FANTASY_CATEGORIES } from '@/types/fantasyCategories';
import type {
  CategoryDirection,
  LeagueFixtureGenerationMode,
  LeagueFormat,
  LeagueLineupSlotSettings,
  LeagueScoringMode,
} from '@/types/leagues';

interface ScoringSettingsValue {
  scoringFormat: 'nine-category';
  categories: FantasyCategoryKey[];
  scoringMode: LeagueScoringMode;
  fixtureGenerationMode: LeagueFixtureGenerationMode;
  lineupSlots: LeagueLineupSlotSettings;
  categoryDirections: Partial<Record<FantasyCategoryKey, CategoryDirection>>;
  scoringSettingsLockedAt: string | null;
}

export interface LeagueFormatSettingsValue {
  leagueFormat: LeagueFormat;
  bloodsuckerMemberId: string | null;
  // Active members the commissioner can choose as the Bloodsucker.
  candidates: { memberId: string; teamName: string }[];
}

interface ScoringSettingsPanelProps {
  value: ScoringSettingsValue;
  // Why scoring can no longer change, from the settings API.
  lockReason?: string | null;
  disabled?: boolean;
  onChange: (value: ScoringSettingsValue) => void;
  // The league format is independent of scoring but sits beside it; it locks with the draft.
  format: LeagueFormatSettingsValue;
  formatLockReason?: string | null;
  onFormatChange: (format: LeagueFormatSettingsValue) => void;
}

const SELECT_CLASS =
  'h-10 rounded-md border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-3 text-[color:var(--league-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)]';

const SLOT_LABELS: Record<keyof LeagueLineupSlotSettings, string> = {
  FWD: 'Forwards',
  DEF: 'Defenders',
  MID: 'Midfielders',
  RUC: 'Rucks',
  UTIL: 'Utility',
};

export function ScoringSettingsPanel({
  value,
  lockReason,
  disabled,
  onChange,
  format,
  formatLockReason,
  onFormatChange,
}: ScoringSettingsPanelProps) {
  const isLocked = Boolean(lockReason ?? value.scoringSettingsLockedAt);
  const isFormatLocked = Boolean(formatLockReason);

  return (
    <section className="rounded-lg border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-base font-semibold text-[color:var(--league-text)]">
            Scoring Settings
          </h3>
          <p className="mt-1 text-sm text-[color:var(--league-text-muted)]">
            Configure H2H mode, active lineup slots, and category directions before fixtures lock.
          </p>
          {isLocked && (
            <p className="mt-1 text-sm text-[color:var(--league-text-muted)]">
              {lockReason ?? 'Scoring settings are locked because the competition was published.'}
            </p>
          )}
        </div>
        {isLocked && (
          <span className="rounded-full border border-[color:var(--league-border)] px-3 py-1 text-xs font-semibold text-[color:var(--league-text-muted)]">
            Locked
          </span>
        )}
      </div>

      <div className="mt-4 grid max-w-3xl gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-2 text-sm font-medium text-[color:var(--league-text)]">
          Scoring mode
          <select
            value={value.scoringMode}
            disabled={disabled || isLocked}
            onChange={(event) =>
              onChange({ ...value, scoringMode: event.target.value as LeagueScoringMode })
            }
            className="h-10 rounded-md border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-3 text-[color:var(--league-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)]"
          >
            <option value="H2H_EACH_CATEGORY">H2H Each Category</option>
            <option value="H2H_MOST_CATEGORIES">H2H Most Categories</option>
          </select>
        </label>
        <label className="flex flex-col gap-2 text-sm font-medium text-[color:var(--league-text)]">
          League format
          <select
            value={format.leagueFormat}
            disabled={disabled || isFormatLocked}
            onChange={(event) =>
              onFormatChange({
                ...format,
                leagueFormat: parseLeagueFormat(event.target.value),
              })
            }
            className={SELECT_CLASS}
          >
            {selectableLeagueFormatOptions(format.leagueFormat).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {format.leagueFormat === 'NO_LOSERS' && (
          <p className="text-xs font-normal leading-5 text-[color:var(--league-text-muted)] sm:col-span-2">
            {NO_LOSERS_EXPLANATION}
          </p>
        )}
        {format.leagueFormat === 'BLOODSUCKER' && (
          <label className="flex flex-col gap-2 text-sm font-medium text-[color:var(--league-text)] sm:col-span-2">
            Bloodsucker
            <select
              value={format.bloodsuckerMemberId ?? ''}
              disabled={disabled || isFormatLocked}
              onChange={(event) =>
                onFormatChange({ ...format, bloodsuckerMemberId: event.target.value || null })
              }
              className={SELECT_CLASS}
            >
              <option value="">Choose a Bloodsucker</option>
              {format.candidates.map((candidate) => (
                <option key={candidate.memberId} value={candidate.memberId}>
                  {candidate.teamName}
                </option>
              ))}
            </select>
            <span className="text-xs font-normal text-[color:var(--league-text-muted)]">
              {formatLockReason ??
                'Skips the draft and takes a player from each team it beats. Needs at least 8 teams (12 recommended), rolling waivers and no FAAB.'}
            </span>
          </label>
        )}
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {(Object.keys(SLOT_LABELS) as Array<keyof LeagueLineupSlotSettings>).map((slot) => (
          <label
            key={slot}
            className="flex flex-col gap-2 text-sm font-medium text-[color:var(--league-text)]"
          >
            {SLOT_LABELS[slot]}
            <input
              type="number"
              min={1}
              max={20}
              disabled={disabled || isLocked}
              value={value.lineupSlots[slot]}
              onChange={(event) =>
                onChange({
                  ...value,
                  lineupSlots: {
                    ...value.lineupSlots,
                    [slot]: Number.parseInt(event.target.value, 10) || 1,
                  },
                })
              }
              className="h-10 rounded-md border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-3 text-[color:var(--league-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)]"
            />
          </label>
        ))}
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {value.categories.map((category) => (
          <label
            key={category}
            className="flex flex-col gap-2 text-sm font-medium text-[color:var(--league-text)]"
          >
            {FANTASY_CATEGORIES[category]?.label ?? category}
            <select
              value={value.categoryDirections[category] ?? 'HIGH_WINS'}
              disabled={disabled || isLocked}
              onChange={(event) =>
                onChange({
                  ...value,
                  categoryDirections: {
                    ...value.categoryDirections,
                    [category]: event.target.value as CategoryDirection,
                  },
                })
              }
              className="h-10 rounded-md border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-3 text-[color:var(--league-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)]"
            >
              <option value="HIGH_WINS">Higher wins</option>
              <option value="LOW_WINS">Lower wins</option>
            </select>
          </label>
        ))}
      </div>
    </section>
  );
}
