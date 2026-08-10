import {
  AflOutcomesDevelopmentWorkbookError,
  type AflOutcomesDevelopmentWorkbook,
} from './developmentWorkbookStructure';

export const AFL_OUTCOMES_DEVELOPMENT_ACQUISITION_CATEGORIES = [
  'national_draft',
  'rookie_draft',
  'mid_season_draft',
  'pre_season_draft',
  'mini_draft',
  'trade',
  'free_agency',
  'pre_draft',
  'post_draft',
  'training_squad_selection',
] as const;

export type AflOutcomesDevelopmentAcquisitionCategory =
  (typeof AFL_OUTCOMES_DEVELOPMENT_ACQUISITION_CATEGORIES)[number];

export const AFL_OUTCOMES_DEVELOPMENT_ACQUISITION_CATEGORY_LABELS: Readonly<
  Record<AflOutcomesDevelopmentAcquisitionCategory, string>
> = {
  national_draft: 'National draft',
  rookie_draft: 'Rookie draft',
  mid_season_draft: 'Mid-season draft',
  pre_season_draft: 'Pre-season draft',
  mini_draft: 'Mini-draft',
  trade: 'Trade acquisition',
  free_agency: 'Free agency',
  pre_draft: 'Pre-draft acquisition',
  post_draft: 'Post-draft acquisition',
  training_squad_selection: 'Training squad selection',
};

const categoryByWorkbookValue: Readonly<Record<string, AflOutcomesDevelopmentAcquisitionCategory>> =
  {
    National: 'national_draft',
    Rookie: 'rookie_draft',
    'Mid-Season': 'mid_season_draft',
    'Pre-Season': 'pre_season_draft',
    'Mini-Draft': 'mini_draft',
    Trade: 'trade',
    'Free Agency': 'free_agency',
    'Pre-Draft': 'pre_draft',
    'Post-Draft': 'post_draft',
    'Training Squad Selection': 'training_squad_selection',
  };

export interface AflOutcomesDevelopmentAcquisitionItem {
  eventId: string;
  year: number;
  category: AflOutcomesDevelopmentAcquisitionCategory;
  acquisitionType: string;
  signing: string | null;
  pick: string | null;
  draftNumber: number | null;
  clubName: string;
  playerName: string;
  age: number | null;
  heightCm: number | null;
  weightKg: number | null;
  originalClub: string | null;
  grade: string | null;
  games: string | null;
  goals: string | null;
  coachesVotes: string | null;
  brownlowVotes: string | null;
  awards: string | null;
}

export interface AflOutcomesDevelopmentAcquisitionProjection {
  items: readonly AflOutcomesDevelopmentAcquisitionItem[];
  categoryCounts: Readonly<Record<AflOutcomesDevelopmentAcquisitionCategory, number>>;
  years: readonly number[];
}

function textOrNull(value: string): string | null {
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function integerOrNull(value: string): number | null {
  const normalized = value.trim();
  return /^\d+$/.test(normalized) ? Number(normalized) : null;
}

function categoryFor(acquisitionType: string): AflOutcomesDevelopmentAcquisitionCategory {
  const category = categoryByWorkbookValue[acquisitionType];
  if (!category) {
    throw new AflOutcomesDevelopmentWorkbookError(
      'UNSUPPORTED_ACQUISITION_TYPE',
      `Annual workbook row contains unsupported acquisition type "${acquisitionType}".`
    );
  }
  return category;
}

export function projectAflOutcomesDevelopmentWorkbookAcquisitions(
  workbook: AflOutcomesDevelopmentWorkbook
): AflOutcomesDevelopmentAcquisitionProjection {
  const categoryCounts = Object.fromEntries(
    AFL_OUTCOMES_DEVELOPMENT_ACQUISITION_CATEGORIES.map((category) => [category, 0])
  ) as Record<AflOutcomesDevelopmentAcquisitionCategory, number>;

  const items = workbook.annualSheets.flatMap(({ sheet, rows }) =>
    rows.map(({ cells }) => {
      const acquisitionType = cells[3].trim();
      const category = categoryFor(acquisitionType);
      categoryCounts[category] += 1;
      return {
        eventId: cells[0],
        year: Number(sheet),
        category,
        acquisitionType,
        signing: textOrNull(cells[6]),
        pick: textOrNull(cells[2]),
        draftNumber: integerOrNull(cells[4]),
        clubName: cells[5].trim(),
        playerName: cells[7].trim(),
        age: integerOrNull(cells[8]),
        heightCm: integerOrNull(cells[9]),
        weightKg: integerOrNull(cells[10]),
        originalClub: textOrNull(cells[11]),
        grade: textOrNull(cells[12]),
        games: textOrNull(cells[13]),
        goals: textOrNull(cells[14]),
        coachesVotes: textOrNull(cells[15]),
        brownlowVotes: textOrNull(cells[16]),
        awards: textOrNull(cells[17]),
      };
    })
  );

  items.sort((left, right) => right.year - left.year || left.eventId.localeCompare(right.eventId));
  return {
    items,
    categoryCounts,
    years: [...workbook.report.annualSheets].map(({ year }) => year).sort((a, b) => b - a),
  };
}
