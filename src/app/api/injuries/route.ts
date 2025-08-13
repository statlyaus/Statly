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

async function scrapeAFLComInjuries(): Promise<InjuryData[]> {
  try {
    const response = await fetch('https://www.afl.com.au/injury-list', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-AU,en;q=0.5',
        'Referer': 'https://www.afl.com.au/',
        'Cache-Control': 'no-cache'
      },
      cache: 'no-store'
    });

    if (!response.ok) {
      throw new Error(`AFL.com HTTP ${response.status}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    const injuries: InjuryData[] = [];

    // Look for injury data in AFL.com structure
    $('.injury-list, .player-injury, [data-testid*="injury"]').each((index, element) => {
      const $element = $(element);
      
      const playerName = $element.find('.player-name, .name, h3, h4').first().text().trim();
      const teamName = $element.find('.team-name, .club, .team').first().text().trim();
      const injuryType = $element.find('.injury-type, .injury, .condition').first().text().trim();
      const status = $element.find('.status, .return, .timeline').first().text().trim();
      
      if (playerName && teamName && injuryType) {
        const standardizedTeam = TEAM_MAPPING[teamName] || teamName;
        
        const injury: InjuryData = {
          id: `${playerName.toLowerCase().replace(/[^\w]/g, '-')}-${standardizedTeam.toLowerCase().replace(/[^\w]/g, '-')}`,
          name: playerName,
          team: standardizedTeam,
          position: 'Unknown',
          injury: injuryType,
          status: status || 'Injured',
          details: `${injuryType}${status ? ` - ${status}` : ''}`
        };
        
        injuries.push(injury);
      }
    });

    return injuries;

  } catch (error) {
    console.error('Error scraping AFL.com:', error);
    throw error;
  }
}

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

    // Try multiple parsing strategies for Footywire's structure
    
    // Strategy 1: Look for injury tables
    $('table').each((tableIndex, table) => {
      const $table = $(table);
      const tableText = $table.text().toLowerCase();
      
      // Check if this table contains injury data
      if (tableText.includes('injury') || tableText.includes('player') || tableText.includes('team')) {
        $table.find('tr').each((rowIndex, row) => {
          const $row = $(row);
          const cells = $row.find('td, th');
          
          if (cells.length >= 3) {
            const cellTexts = cells.map((i, cell) => $(cell).text().trim()).get();
            
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
                position: 'Unknown', // Position not usually in injury lists
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

    // Strategy 2: Look for div-based injury lists
    if (injuries.length === 0) {
      $('div').each((divIndex, div) => {
        const $div = $(div);
        const divText = $div.text().toLowerCase();
        
        if (divText.includes('injury') && divText.includes('player')) {
          const lines = $div.text().split('\n').map(line => line.trim()).filter(line => line.length > 0);
          
          // Process lines to extract injury data
          for (let i = 0; i < lines.length - 2; i += 3) {
            const playerName = lines[i];
            const teamName = lines[i + 1];
            const injuryInfo = lines[i + 2];
            
            if (playerName && teamName && injuryInfo) {
              const standardizedTeam = TEAM_MAPPING[teamName] || teamName;
              
              const injury: InjuryData = {
                id: `${playerName.toLowerCase().replace(/[^\w]/g, '-')}-${standardizedTeam.toLowerCase().replace(/[^\w]/g, '-')}`,
                name: playerName,
                team: standardizedTeam,
                position: 'Unknown',
                injury: injuryInfo,
                status: 'Injured',
                details: injuryInfo
              };
              
              injuries.push(injury);
            }
          }
        }
      });
    }

    // Strategy 3: Text pattern matching
    if (injuries.length === 0) {
      const fullText = $('body').text();
      const teamPattern = /(?:Adelaide|Brisbane|Carlton|Collingwood|Essendon|Fremantle|Geelong|Gold Coast|GWS|Hawthorn|Melbourne|North Melbourne|Port Adelaide|Richmond|St Kilda|Sydney|West Coast|Western Bulldogs)/gi;
      
      const matches = fullText.match(teamPattern);
      if (matches) {
        // This is a fallback - would need more sophisticated parsing
        // For now, we'll fall back to mock data but with a note about live data attempt
      }
    }

    return injuries;

  } catch (error) {
    console.error('Error scraping Footywire:', error);
    throw error;
  }
}

export async function GET() {
  try {
    let injuries: InjuryData[] = [];
    let source = 'mock';
    
    // Try Footywire first
    try {
      injuries = await scrapeFootywireInjuries();
      if (injuries.length > 0) {
        source = 'footywire';
        return Response.json({
          success: true,
          data: injuries,
          source,
          count: injuries.length,
          lastUpdated: new Date().toISOString()
        });
      }
    } catch (_footywireError) {
      // Silently try next source
    }
    
    // Try AFL.com as backup
    try {
      injuries = await scrapeAFLComInjuries();
      if (injuries.length > 0) {
        source = 'afl.com';
        return Response.json({
          success: true,
          data: injuries,
          source,
          count: injuries.length,
          lastUpdated: new Date().toISOString()
        });
      }
    } catch (_aflError) {
      // Silently fall back to mock
    }
    
    // If both sources fail, use mock data
    return Response.json({
      success: true,
      data: mockInjuryData,
      source: 'mock',
      count: mockInjuryData.length,
      lastUpdated: new Date().toISOString()
    });
    
  } catch (_error) {
    return Response.json({
      success: true,
      data: mockInjuryData,
      source: 'mock',
      count: mockInjuryData.length,
      lastUpdated: new Date().toISOString()
    });
  }
}
