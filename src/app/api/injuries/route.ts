import { NextResponse } from 'next/server';
import * as cheerio from 'cheerio';

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

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const teamFilter = searchParams.get('team');

    // Fetch the Footywire injury page
    const response = await fetch('https://www.footywire.com/afl/footy/injury_list', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    
    const injuries: InjuryData[] = [];

    // Parse the injury table - this selector may need adjustment based on the actual HTML structure
    $('.table, .injury-table, table').each((_, table) => {
      $(table).find('tr').each((_, row) => {
        const cells = $(row).find('td');
        
        if (cells.length >= 4) {
          const playerName = $(cells[0]).text().trim();
          const teamName = $(cells[1]).text().trim();
          const position = $(cells[2]).text().trim();
          const injuryInfo = $(cells[3]).text().trim();
          const status = $(cells[4])?.text().trim() || 'Unknown';
          const expectedReturn = $(cells[5])?.text().trim();

          // Skip header rows or empty rows
          if (playerName && playerName.toLowerCase() !== 'player' && teamName && injuryInfo) {
            const standardizedTeam = TEAM_MAPPING[teamName] || teamName;
            
            const injury: InjuryData = {
              id: `${playerName.toLowerCase().replace(/\s+/g, '-')}-${standardizedTeam.toLowerCase().replace(/\s+/g, '-')}`,
              name: playerName,
              team: standardizedTeam,
              position: position || 'Unknown',
              injury: injuryInfo,
              status: status,
              expectedReturn: expectedReturn || undefined,
              details: injuryInfo
            };

            injuries.push(injury);
          }
        }
      });
    });

    // If no injuries found with table parsing, try alternative selectors
    if (injuries.length === 0) {
      // Try parsing divs or other structures
      $('.injury-item, .player-injury, .injury-row').each((_, element) => {
        const playerName = $(element).find('.player-name, .name').text().trim() || 
                          $(element).find('strong').first().text().trim();
        const teamName = $(element).find('.team-name, .team').text().trim();
        const injury = $(element).find('.injury-type, .injury').text().trim();
        
        if (playerName && teamName && injury) {
          const standardizedTeam = TEAM_MAPPING[teamName] || teamName;
          
          injuries.push({
            id: `${playerName.toLowerCase().replace(/\s+/g, '-')}-${standardizedTeam.toLowerCase().replace(/\s+/g, '-')}`,
            name: playerName,
            team: standardizedTeam,
            position: 'Unknown',
            injury: injury,
            status: 'Injured',
            details: injury
          });
        }
      });
    }

    // Filter by team if specified
    let filteredInjuries = injuries;
    if (teamFilter) {
      const normalizedFilter = teamFilter.toLowerCase();
      filteredInjuries = injuries.filter(injury => 
        injury.team.toLowerCase().includes(normalizedFilter) ||
        injury.team.toLowerCase().replace(/\s+/g, '') === normalizedFilter.replace(/\s+/g, '')
      );
    }

    // Remove duplicates based on player name and team
    const uniqueInjuries = filteredInjuries.filter((injury, index, array) => 
      array.findIndex(i => i.name === injury.name && i.team === injury.team) === index
    );

    console.log(`Fetched ${uniqueInjuries.length} injury records${teamFilter ? ` for team: ${teamFilter}` : ''}`);

    return NextResponse.json({
      success: true,
      data: uniqueInjuries,
      count: uniqueInjuries.length,
      lastUpdated: new Date().toISOString(),
      teamFilter: teamFilter || null
    });

  } catch (error) {
    console.error('Error fetching injury data:', error);
    
    // Return mock data in case of error for development
    const mockInjuries: InjuryData[] = [
      {
        id: 'max-gawn-melbourne',
        name: 'Max Gawn',
        team: 'Melbourne',
        position: 'RUC',
        injury: 'Knee (MCL)',
        status: 'Test',
        expectedReturn: '2-3 weeks',
        details: 'Medial collateral ligament strain, will be monitored'
      },
      {
        id: 'lance-franklin-sydney',
        name: 'Lance Franklin',
        team: 'Sydney',
        position: 'FWD',
        injury: 'Hamstring',
        status: '1-2 weeks',
        details: 'Minor hamstring strain, expected back soon'
      },
      {
        id: 'patrick-cripps-carlton',
        name: 'Patrick Cripps',
        team: 'Carlton',
        position: 'MID',
        injury: 'Shoulder',
        status: 'Test',
        details: 'Shoulder soreness, will be assessed'
      }
    ];

    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      data: mockInjuries, // Fallback data
      count: mockInjuries.length,
      lastUpdated: new Date().toISOString(),
      teamFilter: null,
      note: 'Using mock data due to fetch error'
    });
  }
}

export async function POST() {
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
}
