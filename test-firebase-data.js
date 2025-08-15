/**
 * Quick test to add sample data to Firebase via the API route
 */

// Test data that matches the expected API format
const testData = [
  {
    player_id: 'player_001',
    player_name: 'Charlie Curnow',
    team: 'Carlton',
    position: 'FWD',
    fantasy_points: 98,
    goals: 3,
    disposals: 18,
    marks: 8,
    tackles: 4,
    season: 2025,
    round_number: 1,
  },
  {
    player_id: 'player_002',
    player_name: 'Patrick Cripps',
    team: 'Carlton',
    position: 'MID',
    fantasy_points: 124,
    goals: 1,
    disposals: 32,
    marks: 6,
    tackles: 8,
    season: 2025,
    round_number: 1,
  },
  {
    player_id: 'player_003',
    player_name: 'Dustin Martin',
    team: 'Richmond',
    position: 'MID',
    fantasy_points: 108,
    goals: 2,
    disposals: 25,
    marks: 5,
    tackles: 6,
    season: 2025,
    round_number: 1,
  },
];

console.log('Test data created:', testData);
console.log('Navigate to /rankings page to see if live data loads');
console.log('Check browser console for API response details');
