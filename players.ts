import type { NextApiRequest, NextApiResponse } from 'next';
import type { Player } from './src/types';

// Mock player data based on the structure used in pages/index.tsx
const mockPlayers: Player[] = [
  {
    id: '1',
    name: 'Dustin Martin',
    team: 'Richmond',
    position: 'MID/FWD',
    stats: { fantasyPoints: 125 },
  },
  {
    id: '2',
    name: 'Marcus Bontempelli',
    team: 'Western Bulldogs',
    position: 'MID',
    stats: { fantasyPoints: 122 },
  },
  {
    id: '3',
    name: 'Clayton Oliver',
    team: 'Melbourne',
    position: 'MID',
    stats: { fantasyPoints: 118 },
  },
  {
    id: '4',
    name: 'Max Gawn',
    team: 'Melbourne',
    position: 'RUC',
    stats: { fantasyPoints: 115 },
  },
  {
    id: '5',
    name: 'Tom Stewart',
    team: 'Geelong Cats',
    position: 'DEF',
    stats: { fantasyPoints: 110 },
  },
];

export default function handler(req: NextApiRequest, res: NextApiResponse<Player[]>) {
  // Sort players by fantasy points in descending order
  const sortedPlayers = [...mockPlayers].sort((a, b) => {
    const pointsA = a.stats?.['fantasyPoints'] || 0;
    const pointsB = b.stats?.['fantasyPoints'] || 0;
    return pointsB - pointsA;
  });

  res.status(200).json(sortedPlayers);
}