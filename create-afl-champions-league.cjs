const fetch = require('node-fetch');

async function createAFLChampionsLeague() {
  try {
    const serverUrl = 'http://localhost:3000';
    
    console.log('[LEAGUE] Creating AFL Champions League 2025...');
    
    const leagueData = {
      name: "AFL Champions League 2025",
      description: "The ultimate AFL fantasy league featuring 12 teams, comprehensive 9-category scoring system, and competitive bot teams. Draft the best AFL players and compete for the championship!",
      season: 2025,
      maxTeams: 12,
      isPrivate: false,
      settings: {
        draftSettings: {
          type: "snake",
          timePerPick: 120,
          startDate: "2025-01-15T10:00:00.000Z"
        },
        scoringCategories: [
          { name: "disposals", weight: 1.0 },
          { name: "goals", weight: 6.0 },
          { name: "behinds", weight: 1.0 },
          { name: "marks", weight: 1.0 },
          { name: "tackles", weight: 1.5 },
          { name: "hitouts", weight: 1.0 },
          { name: "inside_50s", weight: 1.0 },
          { name: "rebound_50s", weight: 1.0 },
          { name: "contested_marks", weight: 3.0 }
        ],
        teamSettings: {
          minPlayers: 22,
          maxPlayers: 30,
          positionLimits: {
            "DEF": 6,
            "MID": 8,
            "RUC": 2,
            "FWD": 6
          }
        },
        tradeSettings: {
          enabled: true,
          reviewPeriod: 24,
          deadline: "2025-08-01T23:59:59.000Z"
        },
        waiverSettings: {
          enabled: true,
          type: "rolling",
          processTime: "02:00"
        }
      },
      createdBy: "2qlfdHSCFTPlxoKFSUfNLSlCDRe2"
    };

    const response = await fetch(`${serverUrl}/api/leagues`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(leagueData)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const result = await response.json();
    console.log('[LEAGUE] ✅ Successfully created league:', result.league.name);
    console.log('[LEAGUE] League ID:', result.league.id);
    console.log('[LEAGUE] League settings:', JSON.stringify(result.league.settings, null, 2));
    
    // Add user as league member
    console.log('[LEAGUE] Adding creator as league member...');
    const membershipResponse = await fetch(`${serverUrl}/api/leagues/${result.league.id}/memberships`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userId: "2qlfdHSCFTPlxoKFSUfNLSlCDRe2",
        teamName: "Champion Squad",
        isOwner: true
      })
    });

    if (membershipResponse.ok) {
      const membership = await membershipResponse.json();
      console.log('[LEAGUE] ✅ Successfully joined league as:', membership.teamName);
    } else {
      console.log('[LEAGUE] ⚠️ Warning: Could not join league automatically');
    }

    return result;
    
  } catch (error) {
    console.error('[LEAGUE] ❌ Error creating league:', error.message);
    throw error;
  }
}

createAFLChampionsLeague()
  .then(() => {
    console.log('[LEAGUE] 🎉 AFL Champions League creation completed!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('[LEAGUE] 💥 Failed to create league:', error);
    process.exit(1);
  });
