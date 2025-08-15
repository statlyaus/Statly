// Quick test of the calculateTotalValue function
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

// Test the calculation manually
console.log('Test player stats:', stats);

// Per-game values
const gp = stats.games;
const perGame = {
  goals: stats.goals / gp,
  kicks: stats.kicks / gp,
  handballs: stats.handballs / gp,
  marks: stats.marks / gp,
  tackles: stats.tackles / gp,
  hitouts: stats.hitouts / gp,
  clearances: stats.clearances / gp,
  inside50s: stats.inside50s / gp,
  rebound50s: stats.rebound50s / gp,
  clangers: stats.clangers / gp,
  contestedPossessions: stats.contestedPossessions / gp,
  uncontestedPossessions: stats.uncontestedPossessions / gp,
  freesFor: stats.freesFor / gp,
  freesAgainst: stats.freesAgainst / gp,
  onePercenters: stats.onePercenters / gp,
  goalAssists: stats.goalAssists / gp,
  turnovers: stats.turnovers / gp,
  intercepts: stats.intercepts / gp,
  metresGained: stats.metresGained / gp,
  contestedMarks: stats.contestedMarks / gp,
  effectiveDisposals: stats.effectiveDisposals / gp,
  scoreInvolvements: stats.scoreInvolvements / gp,
};

console.log('Per-game values:', perGame);

// Weights
const WEIGHTS = {
  goals: 6,
  kicks: 0.5,
  handballs: 0.5,
  marks: 2.5,
  tackles: 4,
  hitouts: 1.5,
  clearances: 4,
  inside50s: 2,
  rebound50s: 3,
  clangers: -3,
  contestedPossessions: 3,
  uncontestedPossessions: 0.5,
  freesFor: 1,
  freesAgainst: -1,
  onePercenters: 3,
  goalAssists: 3,
  turnovers: -2,
  intercepts: 4,
  metresGained: 0.05,
  contestedMarks: 4,
  effectiveDisposals: 1,
  scoreInvolvements: 2,
};

// Calculate base total
let baseTotal =
  perGame.goals * WEIGHTS.goals +
  perGame.kicks * WEIGHTS.kicks +
  perGame.handballs * WEIGHTS.handballs +
  perGame.marks * WEIGHTS.marks +
  perGame.tackles * WEIGHTS.tackles +
  perGame.hitouts * WEIGHTS.hitouts +
  perGame.clearances * WEIGHTS.clearances +
  perGame.inside50s * WEIGHTS.inside50s +
  perGame.rebound50s * WEIGHTS.rebound50s +
  perGame.clangers * WEIGHTS.clangers +
  perGame.contestedPossessions * WEIGHTS.contestedPossessions +
  perGame.uncontestedPossessions * WEIGHTS.uncontestedPossessions +
  perGame.freesFor * WEIGHTS.freesFor +
  perGame.freesAgainst * WEIGHTS.freesAgainst +
  perGame.onePercenters * WEIGHTS.onePercenters +
  perGame.goalAssists * WEIGHTS.goalAssists +
  perGame.turnovers * WEIGHTS.turnovers +
  perGame.intercepts * WEIGHTS.intercepts +
  perGame.metresGained * WEIGHTS.metresGained +
  perGame.contestedMarks * WEIGHTS.contestedMarks +
  perGame.effectiveDisposals * WEIGHTS.effectiveDisposals +
  perGame.scoreInvolvements * WEIGHTS.scoreInvolvements;

console.log('Base total value:', baseTotal);

// Efficiency factors
const togFactor = Math.min(1.5, Math.max(0.7, (stats.timeOnGroundPct - 60) / 40 + 1));
const deFactor = Math.min(1.3, Math.max(0.8, (stats.disposalEffPct - 70) / 30 + 1));

console.log('TOG factor:', togFactor);
console.log('DE factor:', deFactor);

const finalTotal = baseTotal * togFactor * deFactor;
console.log('Final total value:', finalTotal);
