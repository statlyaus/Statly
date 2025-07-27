export type Player = {
  id: number;
  name: string;
  team?: string;
  position: string;
  avg?: number;

  kicks?: number;
  kicks_rank?: number;
  handballs?: number;
  handballs_rank?: number;
  marks?: number;
  marks_rank?: number;
  tackles?: number;
  tackles_rank?: number;
  goals?: number;
  goals_rank?: number;
  hitouts?: number;
  hitouts_rank?: number;
  clearances?: number;
  clearances_rank?: number;
  inside50s?: number;
  inside50s_rank?: number;
  rebound50s?: number;
  rebound50s_rank?: number;
  contestedPossessions?: number;
  contestedPossessions_rank?: number;
};

export const myTeam = [
  {
    id: 1,
    name: "Patrick Dangerfield",
    team: "Geelong",
    position: "MID",
    avg: 92.4,
    kicks: 14,
    kicks_rank: 23,
    handballs: 12,
    handballs_rank: 30,
    marks: 5,
    marks_rank: 45,
    tackles: 4,
    tackles_rank: 50,
    goals: 1,
    goals_rank: 60,
    hitouts: 0,
    hitouts_rank: 100,
    clearances: 7,
    clearances_rank: 12,
    inside50s: 4,
    inside50s_rank: 25,
    rebound50s: 1,
    rebound50s_rank: 90,
    contestedPossessions: 10,
    contestedPossessions_rank: 18,
  },
  {
    id: 2,
    name: "Max Gawn",
    team: "Melbourne",
    position: "RUC",
    avg: 105.3,
    kicks: 10,
    kicks_rank: 33,
    handballs: 11,
    handballs_rank: 42,
    marks: 6,
    marks_rank: 35,
    tackles: 3,
    tackles_rank: 58,
    goals: 0,
    goals_rank: 120,
    hitouts: 35,
    hitouts_rank: 3,
    clearances: 4,
    clearances_rank: 25,
    inside50s: 2,
    inside50s_rank: 60,
    rebound50s: 1,
    rebound50s_rank: 88,
    contestedPossessions: 9,
    contestedPossessions_rank: 22,
  },
  {
    id: 3,
    name: "Jack Steele",
    team: "St Kilda",
    position: "MID",
    avg: 98.7,
    kicks: 13,
    kicks_rank: 27,
    handballs: 14,
    handballs_rank: 22,
    marks: 4,
    marks_rank: 52,
    tackles: 6,
    tackles_rank: 15,
    goals: 1,
    goals_rank: 55,
    hitouts: 0,
    hitouts_rank: 100,
    clearances: 6,
    clearances_rank: 18,
    inside50s: 5,
    inside50s_rank: 20,
    rebound50s: 0,
    rebound50s_rank: 95,
    contestedPossessions: 11,
    contestedPossessions_rank: 15,
  },
];

export const mockAvailablePlayers = [
  {
    id: 4,
    name: "Marcus Bontempelli",
    team: "Western Bulldogs",
    position: "MID",
    avg: 104.8,
    kicks: 15,
    kicks_rank: 18,
    handballs: 13,
    handballs_rank: 25,
    marks: 6,
    marks_rank: 30,
    tackles: 5,
    tackles_rank: 28,
    goals: 2,
    goals_rank: 40,
    hitouts: 0,
    hitouts_rank: 100,
    clearances: 8,
    clearances_rank: 7,
    inside50s: 6,
    inside50s_rank: 10,
    rebound50s: 1,
    rebound50s_rank: 85,
    contestedPossessions: 12,
    contestedPossessions_rank: 12,
  },
  {
    id: 5,
    name: "Darcy Moore",
    team: "Collingwood",
    position: "DEF",
    avg: 87.1,
    kicks: 11,
    kicks_rank: 39,
    handballs: 7,
    handballs_rank: 70,
    marks: 9,
    marks_rank: 10,
    tackles: 2,
    tackles_rank: 85,
    goals: 0,
    goals_rank: 130,
    hitouts: 0,
    hitouts_rank: 100,
    clearances: 1,
    clearances_rank: 80,
    inside50s: 1,
    inside50s_rank: 95,
    rebound50s: 5,
    rebound50s_rank: 15,
    contestedPossessions: 8,
    contestedPossessions_rank: 35,
  },
  {
    id: 6,
    name: "Charlie Curnow",
    team: "Carlton",
    position: "FWD",
    avg: 89.3,
    kicks: 12,
    kicks_rank: 35,
    handballs: 5,
    handballs_rank: 88,
    marks: 8,
    marks_rank: 14,
    tackles: 3,
    tackles_rank: 62,
    goals: 4,
    goals_rank: 8,
    hitouts: 0,
    hitouts_rank: 100,
    clearances: 2,
    clearances_rank: 60,
    inside50s: 3,
    inside50s_rank: 40,
    rebound50s: 0,
    rebound50s_rank: 100,
    contestedPossessions: 9,
    contestedPossessions_rank: 27,
  },
];