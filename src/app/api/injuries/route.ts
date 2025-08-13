import { NextResponse } from 'next/server';
import * as cheerio from 'cheerio';
import { getInjuriesByTeam } from '@/data/mockInjuryData';

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
    console.log('Fetching real injury data from Footywire...');
    
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
    console.log(`Fetched HTML: ${html.length} characters`);
    
    const $ = cheerio.load(html);
    const injuries: InjuryData[] = [];

    // Try multiple parsing strategies for Footywire's structure
    
    // Strategy 1: Look for injury tables
    $('table').each((tableIndex, table) => {
      const $table = $(table);
      const tableText = $table.text().toLowerCase();
      
      // Check if this table contains injury data
      if (tableText.includes('injury') || tableText.includes('player') || tableText.includes('team')) {
        console.log(`Analyzing table ${tableIndex + 1}...`);
        
        $table.find('tr').each((rowIndex, row) => {
          const $row = $(row);
          const cells = $row.find('td, th');
          
          if (cells.length >= 3) {
            const cellTexts = cells.map((i, cell) => $(cell).text().trim()).get();
            console.log(`Row ${rowIndex}: [${cellTexts.join(' | ')}]`);
            
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
              console.log(`Added injury: ${injury.name} (${injury.team}) - ${injury.injury}`);
            }
          }
        });
      }
    });

    // Strategy 2: Look for div-based injury lists
    if (injuries.length === 0) {
      console.log('No table data found, trying div-based parsing...');
      
      $('div').each((divIndex, div) => {
        const $div = $(div);
        const divText = $div.text().toLowerCase();
        
        if (divText.includes('injury') && divText.includes('player')) {
          const lines = $div.text().split('\n').map(line => line.trim()).filter(line => line.length > 0);
          console.log(`Found injury div with ${lines.length} lines`);
          
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
      console.log('No structured data found, trying pattern matching...');
      
      const fullText = $('body').text();
      const teamPattern = /(?:Adelaide|Brisbane|Carlton|Collingwood|Essendon|Fremantle|Geelong|Gold Coast|GWS|Hawthorn|Melbourne|North Melbourne|Port Adelaide|Richmond|St Kilda|Sydney|West Coast|Western Bulldogs)/gi;
      
      const matches = fullText.match(teamPattern);
      if (matches) {
        console.log(`Found ${matches.length} team references in text`);
        
        // This is a fallback - would need more sophisticated parsing
        // For now, we'll fall back to mock data but with a note about live data attempt
      }
    }

    console.log(`Successfully scraped ${injuries.length} real injuries from Footywire`);
    return injuries;

  } catch (error) {
    console.error('Error scraping Footywire:', error);
    throw error;
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const teamFilter = searchParams.get('team');
  
  try {
    // Attempt to get real data from Footywire
    const realInjuries = await scrapeFootywireInjuries();
    
    if (realInjuries.length > 0) {
      // Filter if team filter is provided
      const filteredInjuries = teamFilter ? 
        realInjuries.filter(injury => 
          injury.team.toLowerCase().includes(teamFilter.toLowerCase())
        ) : realInjuries;

      // Remove duplicates
      const uniqueInjuries = filteredInjuries.filter((injury, index, self) =>
        index === self.findIndex(i => i.id === injury.id)
      );

      console.log(`Returning ${uniqueInjuries.length} real injury records${teamFilter ? ` for team: ${teamFilter}` : ''}`);

      return NextResponse.json({
        success: true,
        data: uniqueInjuries,
        count: uniqueInjuries.length,
        lastUpdated: new Date().toISOString(),
        teamFilter: teamFilter || null,
        source: 'Footywire Live Data'
      });
    }
    
    // If no real data found, fall back to mock data but indicate it's a fallback
    throw new Error('No live data found');
    
  } catch (error) {
    console.error('Failed to fetch live data, using fallback:', error);
    
    // Use mock data as fallback
    const mockInjuries = getInjuriesByTeam(teamFilter || undefined);
    
    const filteredMockInjuries = teamFilter ? 
      mockInjuries.filter(injury => 
        injury.team.toLowerCase().includes(teamFilter.toLowerCase())
      ) : mockInjuries;

    const uniqueMockInjuries = filteredMockInjuries.filter((injury, index, self) =>
      index === self.findIndex(i => i.id === injury.id)
    );

    console.log(`Returning ${uniqueMockInjuries.length} fallback injury records${teamFilter ? ` for team: ${teamFilter}` : ''}`);

    return NextResponse.json({
      success: true,
      data: uniqueMockInjuries,
      count: uniqueMockInjuries.length,
      lastUpdated: new Date().toISOString(),
      teamFilter: teamFilter || null,
      source: 'Fallback Data',
      note: 'Live data scraping failed, showing sample data. This will be replaced with real data once scraping is working.',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
