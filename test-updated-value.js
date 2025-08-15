// Quick test of the updated calculateTotalValue function
import { calculateTotalValue } from './src/types/fantasyCategories.js';

const stats = {
  games: 20,
  kicks: 240,
  handballs: 140,
  marks: 80,
  tackles: 100,
  goals: 30,
  hitouts: 0,
  clearances: 40,
  inside50s: 60,
  rebound50s: 20,
  clangers: 30,
  contestedPossessions: 120,
  uncontestedPossessions: 260,
  freesFor: 15,
  freesAgainst: 12,
  onePercenters: 25,
  goalAssists: 8,
  timeOnGroundPct: 85,
  disposalEffPct: 75,
  turnovers: 40,
  intercepts: 30,
  metresGained: 8000,
  contestedMarks: 15,
  effectiveDisposals: 300,
  scoreInvolvements: 45,
};

console.log('Updated total value:', calculateTotalValue(stats));
