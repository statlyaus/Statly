import * as cheerio from 'cheerio';
import { mockInjuryData } from '../../../Data/mockInjuryData';

// UI-facing injury type shape
type InjuryData = {
  id: string;
  name: string;
  team: string; // Short team label e.g., 'Adelaide'
  // Position is UI-only and may be unknown; make it optional/nullable
  position?: string | null;
  injury: string; // Human-readable
  status: string; // Human-readable status/ETA
  expectedReturn?: string;
  details?: string | null;
};

interface NormalizedInjuryData {
  team_id: string;
  team_name: string;
  player: string;
  injury_raw: string;
  returning_raw: string;
  status: 'TEST' | 'TBC' | 'SEASON' | 'PROTOCOLS' | 'WEEKS' | 'DAYS' | 'UNKNOWN';
  eta_weeks_min: number | null;
  eta_weeks_max: number | null;
  eta_days_min: number | null;
  eta_days_max: number | null;
  notes: string | null;
}

// Team mapping to standardize team names and codes
const TEAM_MAPPING: Record<string, { id: string; name: string }> = {
  'Adelaide Crows': { id: 'ADL', name: 'Adelaide Crows' },
  Adelaide: { id: 'ADL', name: 'Adelaide Crows' },
  'Brisbane Lions': { id: 'BRI', name: 'Brisbane Lions' },
  Brisbane: { id: 'BRI', name: 'Brisbane Lions' },
  'Carlton Blues': { id: 'CAR', name: 'Carlton Blues' },
  Carlton: { id: 'CAR', name: 'Carlton Blues' },
  'Collingwood Magpies': { id: 'COL', name: 'Collingwood Magpies' },
  Collingwood: { id: 'COL', name: 'Collingwood Magpies' },
  'Essendon Bombers': { id: 'ESS', name: 'Essendon Bombers' },
  Essendon: { id: 'ESS', name: 'Essendon Bombers' },
  'Fremantle Dockers': { id: 'FRE', name: 'Fremantle Dockers' },
  Fremantle: { id: 'FRE', name: 'Fremantle Dockers' },
  'Geelong Cats': { id: 'GEE', name: 'Geelong Cats' },
  Geelong: { id: 'GEE', name: 'Geelong Cats' },
  'Gold Coast Suns': { id: 'GCS', name: 'Gold Coast Suns' },
  'Gold Coast': { id: 'GCS', name: 'Gold Coast Suns' },
  'GWS Giants': { id: 'GWS', name: 'GWS Giants' },
  GWS: { id: 'GWS', name: 'GWS Giants' },
  'Hawthorn Hawks': { id: 'HAW', name: 'Hawthorn Hawks' },
  Hawthorn: { id: 'HAW', name: 'Hawthorn Hawks' },
  'Melbourne Demons': { id: 'MEL', name: 'Melbourne Demons' },
  Melbourne: { id: 'MEL', name: 'Melbourne Demons' },
  'North Melbourne Kangaroos': { id: 'NME', name: 'North Melbourne Kangaroos' },
  'North Melbourne': { id: 'NME', name: 'North Melbourne Kangaroos' },
  'Port Adelaide Power': { id: 'POR', name: 'Port Adelaide Power' },
  'Port Adelaide': { id: 'POR', name: 'Port Adelaide Power' },
  'Richmond Tigers': { id: 'RIC', name: 'Richmond Tigers' },
  Richmond: { id: 'RIC', name: 'Richmond Tigers' },
  'St Kilda Saints': { id: 'STK', name: 'St Kilda Saints' },
  'St Kilda': { id: 'STK', name: 'St Kilda Saints' },
  'Sydney Swans': { id: 'SYD', name: 'Sydney Swans' },
  Sydney: { id: 'SYD', name: 'Sydney Swans' },
  'West Coast Eagles': { id: 'WCE', name: 'West Coast Eagles' },
  'West Coast': { id: 'WCE', name: 'West Coast Eagles' },
  'Western Bulldogs': { id: 'WBD', name: 'Western Bulldogs' },
  Western: { id: 'WBD', name: 'Western Bulldogs' },
};

type Timeframe = {
  status: NormalizedInjuryData['status'];
  eta_weeks_min: number | null;
  eta_weeks_max: number | null;
  eta_days_min: number | null;
  eta_days_max: number | null;
  notes: string | null;
};

function parseReturnTimeframe(returning: string): Timeframe {
  if (!returning || returning.trim() === '') {
    return {
      status: 'UNKNOWN',
      eta_weeks_min: null,
      eta_weeks_max: null,
      eta_days_min: null,
      eta_days_max: null,
      notes: null,
    };
  }

  const normalized = returning.toLowerCase().trim();
  const original = returning.trim();

  // Rule: "Test" → status=TEST, ETAs null
  if (normalized === 'test') {
    return {
      status: 'TEST',
      eta_weeks_min: null,
      eta_weeks_max: null,
      eta_days_min: null,
      eta_days_max: null,
      notes: null,
    };
  }

  // Rule: "TBC" → status=TBC
  if (normalized === 'tbc' || normalized === 'to be confirmed') {
    return {
      status: 'TBC',
      eta_weeks_min: null,
      eta_weeks_max: null,
      eta_days_min: null,
      eta_days_max: null,
      notes: null,
    };
  }

  // Rule: "Season" → status=SEASON
  if (normalized === 'season' || normalized.includes('season')) {
    return {
      status: 'SEASON',
      eta_weeks_min: null,
      eta_weeks_max: null,
      eta_days_min: null,
      eta_days_max: null,
      notes: null,
    };
  }

  // Rule: "Protocols" or "Concussion protocols" → status=PROTOCOLS
  if (normalized.includes('protocol') || normalized.includes('concussion')) {
    return {
      status: 'PROTOCOLS',
      eta_weeks_min: null,
      eta_weeks_max: null,
      eta_days_min: null,
      eta_days_max: null,
      notes: null,
    };
  }

  // Rule: (\d+)\s*-\s*(\d+)\s*week(s)? → status=WEEKS, min/max accordingly
  const weekRangeMatch = normalized.match(/(\d+)\s*-\s*(\d+)\s*weeks?/);
  if (weekRangeMatch) {
    const min = parseInt(weekRangeMatch[1]);
    const max = parseInt(weekRangeMatch[2]);
    const hasNotes =
      normalized.includes('(') || normalized.includes('reassess') || normalized.includes('review');

    return {
      status: 'WEEKS',
      eta_weeks_min: min,
      eta_weeks_max: max,
      eta_days_min: null,
      eta_days_max: null,
      notes: hasNotes ? original : null,
    };
  }

  // Rule: (\d+)\+\s*weeks → status=WEEKS, eta_weeks_min=n, eta_weeks_max=null
  const weeksPlusMatch = normalized.match(/(\d+)\+\s*weeks?/);
  if (weeksPlusMatch) {
    const weeks = parseInt(weeksPlusMatch[1]);
    return {
      status: 'WEEKS',
      eta_weeks_min: weeks,
      eta_weeks_max: null,
      eta_days_min: null,
      eta_days_max: null,
      notes: null,
    };
  }

  // Rule: (\d+)\s*week(s)? → status=WEEKS, eta_weeks_min=max(1, n), eta_weeks_max=n
  const weekSingleMatch = normalized.match(/(\d+)\s*weeks?/);
  if (weekSingleMatch) {
    const weeks = parseInt(weekSingleMatch[1]);
    const minWeeks = Math.max(1, weeks);
    const hasNotes =
      normalized.includes('(') || normalized.includes('reassess') || normalized.includes('review');

    return {
      status: 'WEEKS',
      eta_weeks_min: minWeeks,
      eta_weeks_max: weeks,
      eta_days_min: null,
      eta_days_max: null,
      notes: hasNotes ? original : null,
    };
  }

  // Rule: (\d+)\s*-\s*(\d+)\s*day(s)? → status=DAYS, min/max accordingly
  const dayRangeMatch = normalized.match(/(\d+)\s*-\s*(\d+)\s*days?/);
  if (dayRangeMatch) {
    const min = parseInt(dayRangeMatch[1]);
    const max = parseInt(dayRangeMatch[2]);
    const hasNotes =
      normalized.includes('(') || normalized.includes('reassess') || normalized.includes('review');

    return {
      status: 'DAYS',
      eta_weeks_min: null,
      eta_weeks_max: null,
      eta_days_min: min,
      eta_days_max: max,
      notes: hasNotes ? original : null,
    };
  }

  // Rule: (\d+)\+\s*days → status=DAYS, eta_days_min=n, eta_days_max=null
  const daysPlusMatch = normalized.match(/(\d+)\+\s*days?/);
  if (daysPlusMatch) {
    const days = parseInt(daysPlusMatch[1]);
    return {
      status: 'DAYS',
      eta_days_min: days,
      eta_days_max: null,
      eta_weeks_min: null,
      eta_weeks_max: null,
      notes: null,
    } as Timeframe;
  }

  // Rule: (\d+)\s*day(s)? → status=DAYS, eta_days_min=max(1, n), eta_days_max=n
  const daySingleMatch = normalized.match(/(\d+)\s*days?/);
  if (daySingleMatch) {
    const days = parseInt(daySingleMatch[1]);
    const minDays = Math.max(1, days);
    const hasNotes =
      normalized.includes('(') || normalized.includes('reassess') || normalized.includes('review');

    return {
      status: 'DAYS',
      eta_weeks_min: null,
      eta_weeks_max: null,
      eta_days_min: minDays,
      eta_days_max: days,
      notes: hasNotes ? original : null,
    };
  }

  // Rule: Empty/unknown/missing text → status=UNKNOWN
  // For odd strings (e.g., "1-3 weeks (reassess)") set notes
  return {
    status: 'UNKNOWN',
    eta_weeks_min: null,
    eta_weeks_max: null,
    eta_days_min: null,
    eta_days_max: null,
    notes: original,
  };
}

function normalizeInjuryData(rawData: {
  name: string;
  team: string;
  injury: string;
  status: string;
}): NormalizedInjuryData {
  const teamInfo = TEAM_MAPPING[rawData.team] || {
    id: rawData.team.substring(0, 3).toUpperCase(),
    name: rawData.team,
  };

  const timeframe = parseReturnTimeframe(rawData.status);

  return {
    team_id: teamInfo.id,
    team_name: teamInfo.name,
    player: rawData.name,
    injury_raw: rawData.injury,
    returning_raw: rawData.status,
    ...timeframe,
  };
}

async function scrapeFootywireInjuries(): Promise<NormalizedInjuryData[]> {
  try {
    console.log('Scraping: Starting Footywire scrape');

    const response = await fetch('https://www.footywire.com/afl/footy/injury_list', {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(10000), // 10 second timeout
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();

    if (!html || html.trim() === '') {
      throw new Error('Empty HTML response from Footywire');
    }

    console.log(`Scraping: Received ${html.length} characters of HTML`);

    const $ = cheerio.load(html);
    const injuries: NormalizedInjuryData[] = [];

    // Parse injury tables from Footywire
    $('table').each((_tableIndex, table) => {
      const $table = $(table);
      const tableText = $table.text().toLowerCase();

      // Check if this table contains injury data
      if (
        tableText.includes('injury') ||
        tableText.includes('player') ||
        tableText.includes('team')
      ) {
        $table.find('tr').each((_rowIndex, row) => {
          const $row = $(row);
          const cells = $row.find('td, th');

          if (cells.length >= 3) {
            const cellTexts = cells.map((_i, cell) => $(cell).text().trim()).get();

            // Try to identify player name, team, and injury
            const playerName = cellTexts[0];
            const teamName = cellTexts[1];
            const injuryInfo = cellTexts[2];
            const statusInfo = cellTexts[3] || injuryInfo;

            // Validate the data
            if (
              playerName &&
              playerName.length > 2 &&
              !playerName.toLowerCase().includes('player') &&
              !playerName.toLowerCase().includes('name') &&
              teamName &&
              teamName.length > 2 &&
              !teamName.toLowerCase().includes('team') &&
              injuryInfo &&
              injuryInfo.length > 2 &&
              !injuryInfo.toLowerCase().includes('injury')
            ) {
              try {
                const normalizedInjury = normalizeInjuryData({
                  name: playerName,
                  team: teamName,
                  injury: injuryInfo,
                  status: statusInfo,
                });

                injuries.push(normalizedInjury);
              } catch (normalizationError) {
                console.warn('Scraping: Failed to normalize injury data:', {
                  playerName,
                  teamName,
                  injuryInfo,
                  statusInfo,
                  error:
                    normalizationError instanceof Error
                      ? normalizationError.message
                      : 'Unknown error',
                });
              }
            }
          }
        });
      }
    });

    console.log(`Scraping: Parsed ${injuries.length} injuries from HTML`);
    return injuries;
  } catch (error) {
    console.error('Scraping: Error occurred:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
}

// Convert mock data to normalized format
// function convertMockDataToNormalized(): NormalizedInjuryData[] {
//   return mockInjuryData.map((injury) =>
//     normalizeInjuryData({
//       name: injury.name,
//       team: injury.team,
//       injury: injury.injury,
//       status: injury.status,
//     })
//   );
// }

export async function GET(request: Request) {
  try {
    console.log('Injury API: Starting request');
    const url = new URL(request.url);
    const teamFilterParam = url.searchParams.get('team');
    const teamFilter = teamFilterParam ? teamFilterParam.trim() : null;

    // Try to fetch real data from Footywire first
    try {
      console.log('Injury API: Attempting to scrape Footywire');
      const realInjuries = await scrapeFootywireInjuries();
      console.log(`Injury API: Scraped ${realInjuries.length} injuries from Footywire`);

      if (realInjuries.length > 0) {
        // Transform to UI shape, filter, de-dupe, and sanity-check counts
        const uiData = transformAndFilter(realInjuries, teamFilter);
        // If implausible size, fall back to structured mock for safety
        if (uiData.length > 300) {
          console.warn(
            'Injury API: Scrape returned implausible size, falling back to structured mock',
            uiData.length
          );
          const mock = buildUiFromMock(teamFilter);
          return Response.json({
            success: true,
            data: mock,
            source: 'mock_fallback_scrape_too_large',
            count: mock.length,
            lastUpdated: new Date().toISOString(),
            schema_version: '2.0',
            teamFilter,
          });
        }

        return Response.json({
          success: true,
          data: uiData,
          source: 'footywire',
          count: uiData.length,
          lastUpdated: new Date().toISOString(),
          schema_version: '2.0',
          teamFilter,
        });
      }
    } catch (scrapingError) {
      // If scraping fails, fall back to normalized mock data
      console.error('Injury API: Footywire scraping failed:', scrapingError);
    }

    // Fallback to mock data (already shaped for UI)
    const mock = buildUiFromMock(teamFilter);
    return Response.json({
      success: true,
      data: mock,
      source: 'mock_fallback',
      count: mock.length,
      lastUpdated: new Date().toISOString(),
      schema_version: '2.0',
      teamFilter,
    });
  } catch (error) {
    console.error('Injury API: Critical error occurred:', error);

    // Always ensure we return valid JSON, even in error cases
    try {
      const mock = buildUiFromMock(null);
      return Response.json({
        success: true,
        data: mock,
        source: 'mock_error',
        count: mock.length,
        lastUpdated: new Date().toISOString(),
        schema_version: '2.0',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    } catch (mockError) {
      // Last resort - return empty but valid JSON
      console.error('Injury API: Mock data conversion also failed:', mockError);
      return Response.json({
        success: false,
        data: [],
        source: 'error',
        count: 0,
        lastUpdated: new Date().toISOString(),
        schema_version: '2.0',
        error: 'Failed to load any injury data',
      });
    }
  }
}

// ----------------------- Helpers: Transform & Filter ------------------------

// Map long team names to short UI labels matching the dashboard filters
const TEAM_SHORT: Record<string, string> = {
  'Adelaide Crows': 'Adelaide',
  'Brisbane Lions': 'Brisbane',
  'Carlton Blues': 'Carlton',
  'Collingwood Magpies': 'Collingwood',
  'Essendon Bombers': 'Essendon',
  'Fremantle Dockers': 'Fremantle',
  'Geelong Cats': 'Geelong',
  'Gold Coast Suns': 'Gold Coast',
  'GWS Giants': 'GWS',
  'Hawthorn Hawks': 'Hawthorn',
  'Melbourne Demons': 'Melbourne',
  'North Melbourne Kangaroos': 'North Melbourne',
  'Port Adelaide Power': 'Port Adelaide',
  'Richmond Tigers': 'Richmond',
  'St Kilda Saints': 'St Kilda',
  'Sydney Swans': 'Sydney',
  'West Coast Eagles': 'West Coast',
  'Western Bulldogs': 'Western Bulldogs',
};

function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function toUiInjury(n: NormalizedInjuryData): InjuryData {
  const teamShort = TEAM_SHORT[n.team_name] || n.team_name;
  const id = `${slugify(n.player)}-${slugify(teamShort)}`;
  // Prefer notes or returning_raw for expectedReturn/status readability
  const expectedReturn = n.notes || n.returning_raw || undefined;
  const status = n.returning_raw || (n.status as string) || 'Unknown';
  return {
    id,
    name: n.player,
    team: teamShort,
    position: undefined,
    injury: n.injury_raw,
    status,
    expectedReturn,
    details: n.notes || undefined,
  } as const;
}

function transformAndFilter(list: NormalizedInjuryData[], teamFilter: string | null): InjuryData[] {
  const seen = new Set<string>();
  const out: InjuryData[] = [];
  for (const n of list) {
    const ui = toUiInjury(n);
    if (teamFilter && ui.team.toLowerCase() !== teamFilter.toLowerCase()) continue;
    if (seen.has(ui.id)) continue;
    seen.add(ui.id);
    out.push(ui);
  }
  return out;
}

function buildUiFromMock(teamFilter: string | null): InjuryData[] {
  const items = teamFilter
    ? mockInjuryData.filter((m) => m.team.toLowerCase() === teamFilter.toLowerCase())
    : mockInjuryData;
  // Ensure shape aligns with InjuryData exactly
  return items.map((m) => ({
    id: m.id,
    name: m.name,
    team: m.team,
    position: m.position || undefined,
    injury: m.injury,
    status: m.status,
    expectedReturn: m.expectedReturn,
    details: m.details || undefined,
  }));
}
