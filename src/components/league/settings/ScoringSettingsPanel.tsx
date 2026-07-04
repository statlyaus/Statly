import type { FantasyCategoryKey } from '@/types/fantasyCategories';
import { FANTASY_CATEGORIES } from '@/types/fantasyCategories';
import type {
  CategoryDirection,
  LeagueFixtureGenerationMode,
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

interface ScoringSettingsPanelProps {
  value: ScoringSettingsValue;
  disabled?: boolean;
  onChange: (value: ScoringSettingsValue) => void;
}

const SLOT_LABELS: Record<keyof LeagueLineupSlotSettings, string> = {
  FWD: 'Forwards',
  DEF: 'Defenders',
  MID: 'Midfielders',
  RUC: 'Rucks',
  UTIL: 'Utility',
};

export function ScoringSettingsPanel({ value, disabled, onChange }: ScoringSettingsPanelProps) {
  const isLocked = Boolean(value.scoringSettingsLockedAt);

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
        </div>
        {isLocked && (
          <span className="rounded-full border border-[color:var(--league-border)] px-3 py-1 text-xs font-semibold text-[color:var(--league-text-muted)]">
            Locked
          </span>
        )}
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
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
          Fixture generation
          <select
            value={value.fixtureGenerationMode}
            disabled={disabled || isLocked}
            onChange={(event) =>
              onChange({
                ...value,
                fixtureGenerationMode: event.target.value as LeagueFixtureGenerationMode,
              })
            }
            className="h-10 rounded-md border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-3 text-[color:var(--league-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)]"
          >
            <option value="AUTOMATIC">Automatic by league teams</option>
            <option value="MANUAL">Manual commissioner setup</option>
          </select>
        </label>
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
