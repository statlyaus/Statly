import * as cheerio from 'cheerio';
import { mockInjuryData } from '@/data/mockInjuryData';

interface InjuryData {
  id: string;
  name: string;
  team: string;
  position: string;
  injury: string;
  status: string;
  expectedReturn?: string;
  details?: string;
}

// Team mapping to standardize team names
const TEAM_MAPPING: Record<string, string> = {
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
  'Western Bulldogs': 'Western Bulldogs'
};

async function scrapeFootywireInjuries(): Promise<InjuryData[]> {
  try {
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
    const injuries: InjuryData[] = [];

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
            const returnInfo = cellTexts[4] || '';
            
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
              
              const standardizedTeam = TEAM_MAPPING[teamName] || teamName;
              
              const injury: InjuryData = {
                id: `${playerName.toLowerCase().replace(/[^\w]/g, '-')}-${standardizedTeam.toLowerCase().replace(/[^\w]/g, '-')}`,
                name: playerName,
                team: standardizedTeam,
                position: 'Unknown',
                injury: injuryInfo,
                status: statusInfo,
                expectedReturn: returnInfo || undefined,
                details: `${injuryInfo}${statusInfo !== injuryInfo ? ` - ${statusInfo}` : ''}`
              };
              
              injuries.push(injury);
            }
          }
        });
      }
    });

    return injuries;

  } catch (error) {
    throw error;
  }
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
          lastUpdated: new Date().toISOString()
        });
      }
    } catch (scrapingError) {
      // If scraping fails, fall back to mock data
      console.error('Footywire scraping failed:', scrapingError);
    }
    
    // Fallback to mock data if scraping fails
    return Response.json({
      success: true,
      data: mockInjuryData,
      source: 'mock_fallback',
      count: mockInjuryData.length,
      lastUpdated: new Date().toISOString()
    });
    
  } catch (_error) {
    return Response.json({
      success: true,
      data: mockInjuryData,
      source: 'mock_error',
      count: mockInjuryData.length,
      lastUpdated: new Date().toISOString()
    });
  }
}
