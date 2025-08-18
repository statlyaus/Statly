import * as cheerio from 'cheerio';
import { mockInjuryData } from '@/data/mockInjuryData';

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

function parseReturnTimeframe(returning: string): {
  status: NormalizedInjuryData['status'];
  eta_weeks_min: number | null;
  eta_weeks_max: number | null;
  eta_days_min: number | null;
  eta_days_max: number | null;
  notes: string | null;
} {
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
    };
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
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const html = await response.text();
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
            const normalizedInjury = normalizeInjuryData({
              name: playerName,
              team: teamName,
              injury: injuryInfo,
              status: statusInfo,
            });

            injuries.push(normalizedInjury);
          }
        }
      });
    }
  });

  return injuries;
}

// Convert mock data to normalized format
function convertMockDataToNormalized(): NormalizedInjuryData[] {
  return mockInjuryData.map((injury) =>
    normalizeInjuryData({
      name: injury.name,
      team: injury.team,
      injury: injury.injury,
      status: injury.status,
    })
  );
}

export async function GET() {
  try {
    console.log('Injury API: Starting request');
    
    // Try to fetch real data from Footywire first
    try {
      console.log('Injury API: Attempting to scrape Footywire');
      const realInjuries = await scrapeFootywireInjuries();
      console.log(`Injury API: Scraped ${realInjuries.length} injuries from Footywire`);
      
      if (realInjuries.length > 0) {
        return Response.json({
          success: true,
          data: realInjuries,
          source: 'footywire',
          count: realInjuries.length,
          lastUpdated: new Date().toISOString(),
          schema_version: '2.0',
        });
      }
    } catch (scrapingError) {
      // If scraping fails, fall back to normalized mock data
      console.error('Injury API: Footywire scraping failed:', scrapingError);
    }

    // Fallback to normalized mock data if scraping fails
    console.log('Injury API: Using mock data fallback');
    const normalizedMockData = convertMockDataToNormalized();
    
    return Response.json({
      success: true,
      data: normalizedMockData,
      source: 'mock_fallback',
      count: normalizedMockData.length,
      lastUpdated: new Date().toISOString(),
      schema_version: '2.0',
    });
  } catch (error) {
    console.error('Injury API: Critical error occurred:', error);
    
    // Always ensure we return valid JSON, even in error cases
    try {
      const normalizedMockData = convertMockDataToNormalized();
      return Response.json({
        success: true,
        data: normalizedMockData,
        source: 'mock_error',
        count: normalizedMockData.length,
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
