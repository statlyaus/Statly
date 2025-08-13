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
  'Adelaide': { id: 'ADL', name: 'Adelaide Crows' },
  'Brisbane Lions': { id: 'BRI', name: 'Brisbane Lions' },
  'Brisbane': { id: 'BRI', name: 'Brisbane Lions' },
  'Carlton Blues': { id: 'CAR', name: 'Carlton Blues' },
  'Carlton': { id: 'CAR', name: 'Carlton Blues' },
  'Collingwood Magpies': { id: 'COL', name: 'Collingwood Magpies' },
  'Collingwood': { id: 'COL', name: 'Collingwood Magpies' },
  'Essendon Bombers': { id: 'ESS', name: 'Essendon Bombers' },
  'Essendon': { id: 'ESS', name: 'Essendon Bombers' },
  'Fremantle Dockers': { id: 'FRE', name: 'Fremantle Dockers' },
  'Fremantle': { id: 'FRE', name: 'Fremantle Dockers' },
  'Geelong Cats': { id: 'GEE', name: 'Geelong Cats' },
  'Geelong': { id: 'GEE', name: 'Geelong Cats' },
  'Gold Coast Suns': { id: 'GCS', name: 'Gold Coast Suns' },
  'Gold Coast': { id: 'GCS', name: 'Gold Coast Suns' },
  'GWS Giants': { id: 'GWS', name: 'GWS Giants' },
  'GWS': { id: 'GWS', name: 'GWS Giants' },
  'Hawthorn Hawks': { id: 'HAW', name: 'Hawthorn Hawks' },
  'Hawthorn': { id: 'HAW', name: 'Hawthorn Hawks' },
  'Melbourne Demons': { id: 'MEL', name: 'Melbourne Demons' },
  'Melbourne': { id: 'MEL', name: 'Melbourne Demons' },
  'North Melbourne Kangaroos': { id: 'NME', name: 'North Melbourne Kangaroos' },
  'North Melbourne': { id: 'NME', name: 'North Melbourne Kangaroos' },
  'Port Adelaide Power': { id: 'POR', name: 'Port Adelaide Power' },
  'Port Adelaide': { id: 'POR', name: 'Port Adelaide Power' },
  'Richmond Tigers': { id: 'RIC', name: 'Richmond Tigers' },
  'Richmond': { id: 'RIC', name: 'Richmond Tigers' },
  'St Kilda Saints': { id: 'STK', name: 'St Kilda Saints' },
  'St Kilda': { id: 'STK', name: 'St Kilda Saints' },
  'Sydney Swans': { id: 'SYD', name: 'Sydney Swans' },
  'Sydney': { id: 'SYD', name: 'Sydney Swans' },
  'West Coast Eagles': { id: 'WCE', name: 'West Coast Eagles' },
  'West Coast': { id: 'WCE', name: 'West Coast Eagles' },
  'Western Bulldogs': { id: 'WBD', name: 'Western Bulldogs' },
  'Western': { id: 'WBD', name: 'Western Bulldogs' }
};

function parseReturnTimeframe(returning: string): {
  status: NormalizedInjuryData['status'];
  eta_weeks_min: number | null;
  eta_weeks_max: number | null;
  eta_days_min: number | null;
  eta_days_max: number | null;
  notes: string | null;
} {
  const normalized = returning.toLowerCase().trim();
  
  // Test cases
  if (normalized === 'test') {
    return {
      status: 'TEST',
      eta_weeks_min: 0,
      eta_weeks_max: 0,
      eta_days_min: null,
      eta_days_max: null,
      notes: null
    };
  }
  
  // TBC cases
  if (normalized === 'tbc' || normalized === 'to be confirmed') {
    return {
      status: 'TBC',
      eta_weeks_min: null,
      eta_weeks_max: null,
      eta_days_min: null,
      eta_days_max: null,
      notes: null
    };
  }
  
  // Season ending
  if (normalized === 'season' || normalized.includes('season')) {
    return {
      status: 'SEASON',
      eta_weeks_min: null,
      eta_weeks_max: null,
      eta_days_min: null,
      eta_days_max: null,
      notes: null
    };
  }
  
  // Protocols (concussion, etc.)
  if (normalized.includes('protocol') || normalized.includes('concussion')) {
    return {
      status: 'PROTOCOLS',
      eta_weeks_min: null,
      eta_weeks_max: null,
      eta_days_min: null,
      eta_days_max: null,
      notes: returning
    };
  }
  
  // Week patterns
  const weekPatterns = [
    /(\d+)-(\d+)\s*weeks?/i,  // "2-3 weeks"
    /(\d+)\+?\s*weeks?/i,     // "2 weeks" or "6+ weeks"
    /(\d+)\s*week/i           // "1 week"
  ];
  
  for (const pattern of weekPatterns) {
    const match = normalized.match(pattern);
    if (match) {
      if (pattern.source.includes('-')) {
        // Range pattern like "2-3 weeks"
        return {
          status: 'WEEKS',
          eta_weeks_min: parseInt(match[1]),
          eta_weeks_max: parseInt(match[2]),
          eta_days_min: null,
          eta_days_max: null,
          notes: null
        };
      } else {
        // Single week pattern
        const weeks = parseInt(match[1]);
        return {
          status: 'WEEKS',
          eta_weeks_min: weeks,
          eta_weeks_max: weeks,
          eta_days_min: null,
          eta_days_max: null,
          notes: normalized.includes('+') ? 'Minimum timeframe' : null
        };
      }
    }
  }
  
  // Day patterns
  const dayPatterns = [
    /(\d+)-(\d+)\s*days?/i,   // "5-7 days"
    /(\d+)\s*days?/i          // "3 days"
  ];
  
  for (const pattern of dayPatterns) {
    const match = normalized.match(pattern);
    if (match) {
      if (pattern.source.includes('-')) {
        return {
          status: 'DAYS',
          eta_weeks_min: null,
          eta_weeks_max: null,
          eta_days_min: parseInt(match[1]),
          eta_days_max: parseInt(match[2]),
          notes: null
        };
      } else {
        const days = parseInt(match[1]);
        return {
          status: 'DAYS',
          eta_weeks_min: null,
          eta_weeks_max: null,
          eta_days_min: days,
          eta_days_max: days,
          notes: null
        };
      }
    }
  }
  
  // Default for unrecognized patterns
  return {
    status: 'UNKNOWN',
    eta_weeks_min: null,
    eta_weeks_max: null,
    eta_days_min: null,
    eta_days_max: null,
    notes: returning || null
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
    name: rawData.team 
  };
  
  const timeframe = parseReturnTimeframe(rawData.status);
  
  return {
    team_id: teamInfo.id,
    team_name: teamInfo.name,
    player: rawData.name,
    injury_raw: rawData.injury,
    returning_raw: rawData.status,
    ...timeframe
  };
}

async function scrapeFootywireInjuries(): Promise<NormalizedInjuryData[]> {
  const response = await fetch('https://www.footywire.com/afl/footy/injury_list', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache'
    },
    cache: 'no-store'
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
    if (tableText.includes('injury') || tableText.includes('player') || tableText.includes('team')) {
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
          if (playerName && 
              playerName.length > 2 && 
              !playerName.toLowerCase().includes('player') &&
              !playerName.toLowerCase().includes('name') &&
              teamName && 
              teamName.length > 2 &&
              !teamName.toLowerCase().includes('team') &&
              injuryInfo && 
              injuryInfo.length > 2 &&
              !injuryInfo.toLowerCase().includes('injury')) {
            
            const normalizedInjury = normalizeInjuryData({
              name: playerName,
              team: teamName,
              injury: injuryInfo,
              status: statusInfo
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
  return mockInjuryData.map(injury => normalizeInjuryData({
    name: injury.name,
    team: injury.team,
    injury: injury.injury,
    status: injury.status
  }));
}

export async function GET() {
  try {
    // Try to fetch real data from Footywire first
    try {
      const realInjuries = await scrapeFootywireInjuries();
      if (realInjuries.length > 0) {
        return Response.json({
          success: true,
          data: realInjuries,
          source: 'footywire',
          count: realInjuries.length,
          lastUpdated: new Date().toISOString(),
          schema_version: '2.0'
        });
      }
    } catch (scrapingError) {
      // If scraping fails, fall back to normalized mock data
      console.error('Footywire scraping failed:', scrapingError);
    }
    
    // Fallback to normalized mock data if scraping fails
    const normalizedMockData = convertMockDataToNormalized();
    return Response.json({
      success: true,
      data: normalizedMockData,
      source: 'mock_fallback',
      count: normalizedMockData.length,
      lastUpdated: new Date().toISOString(),
      schema_version: '2.0'
    });
    
  } catch (_error) {
    const normalizedMockData = convertMockDataToNormalized();
    return Response.json({
      success: true,
      data: normalizedMockData,
      source: 'mock_error',
      count: normalizedMockData.length,
      lastUpdated: new Date().toISOString(),
      schema_version: '2.0'
    });
  }
}
