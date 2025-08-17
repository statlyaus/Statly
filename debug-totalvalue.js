// Debug script to check calculateTotalValue function
const { calculateTotalValue } = require('./src/types/fantasyCategories');

// Test with sample data structure from API
const samplePlayerStats = {
  games: 1,
  kicks: 15,
  handballs: 10,
  marks: 8,
  tackles: 5,
  goals: 2,
  hitouts: 0,
  clearances: 3, // inside50s
  inside50s: 3,
  rebound50s: 2,
  clangers: 3,
  contestedPossessions: 8,
  uncontestedPossessions: 12,
  freesFor: 1,
  freesAgainst: 0,
  onePercenters: 20, // effectiveDisposals
  goalAssists: 1, // scoreInvolvements
  turnovers: 2,
  intercepts: 4,
  metresGained: 350,
  contestedMarks: 3,
  effectiveDisposals: 20,
  scoreInvolvements: 1,
  timeOnGroundPct: 85,
  disposalEffPct: 80,
  seasonTotal: 0,
  avgFantasyPoints: 0,
  lastGameFantasyPoints: 0,
};

console.log('Sample player stats:', samplePlayerStats);
console.log('Calculated total value:', calculateTotalValue(samplePlayerStats));

// Test with empty/undefined values
const emptyStats = {
  games: 1,
  kicks: 0,
  handballs: 0,
  marks: 0,
  tackles: 0,
  goals: 0,
  hitouts: 0,
  clearances: 0,
  inside50s: 0,
  rebound50s: 0,
  clangers: 0,
  contestedPossessions: 0,
  uncontestedPossessions: 0,
  freesFor: 0,
  freesAgainst: 0,
  onePercenters: 0,
  goalAssists: 0,
  turnovers: 0,
  intercepts: 0,
  metresGained: 0,
  contestedMarks: 0,
  effectiveDisposals: 0,
  scoreInvolvements: 0,
  timeOnGroundPct: 0,
  disposalEffPct: 0,
  seasonTotal: 0,
  avgFantasyPoints: 0,
  lastGameFantasyPoints: 0,
};

console.log('Empty stats:', emptyStats);
console.log('Calculated total value for empty stats:', calculateTotalValue(emptyStats));

// Test with undefined values
const undefinedStats = {
  games: 1,
};

console.log('Undefined stats:', undefinedStats);
console.log('Calculated total value for undefined stats:', calculateTotalValue(undefinedStats));
