'use client';

import React from 'react';

import { TeamLogo } from '@/components/TeamLogo';
import { UITable, tableClasses } from '@/components/ui/table';
import { getTeamAbbreviation } from '@/lib/teamLogos';

export interface PlayerRankingRow {
  id: string;
  name: string;
  team?: string;
  position?: string;
  totalValue: number;
  rank: number;
}

interface RankingsTableProps {
  players: PlayerRankingRow[];
}

const RankingsTable: React.FC<RankingsTableProps> = ({ players }) => {
  return (
    <div className={tableClasses.container}>
      <UITable>
        <caption className="sr-only">Player rankings table</caption>
        <thead className={tableClasses.thead}>
          <tr>
            <th scope="col" className={tableClasses.th}>
              Rank
            </th>
            <th scope="col" className={tableClasses.th}>
              Player
            </th>
            <th scope="col" className={tableClasses.th}>
              Team
            </th>
            <th scope="col" className={tableClasses.th}>
              Position
            </th>
            <th scope="col" className={`${tableClasses.th} text-right`}>
              Total Value
            </th>
          </tr>
        </thead>
        <tbody className={tableClasses.tbody}>
          {players.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-3 py-8 text-center text-sm text-muted-foreground">
                No ranked players available.
              </td>
            </tr>
          ) : null}
          {players.map((player) => (
            <tr key={player.id} className="transition-colors hover:bg-muted/40">
              <th scope="row" className={tableClasses.td}>
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                  {player.rank}
                </span>
              </th>
              <td className={tableClasses.td}>
                <div className="font-semibold">{player.name}</div>
              </td>
              <td className={tableClasses.td}>
                <span
                  className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
                  title={player.team || undefined}
                >
                  {player.team ? (
                    <>
                      <TeamLogo team={player.team} size={16} withCircle decorative />
                      <span>{getTeamAbbreviation(player.team)}</span>
                    </>
                  ) : (
                    '-'
                  )}
                </span>
              </td>
              <td className={tableClasses.td}>
                <span className="font-medium text-muted-foreground">{player.position || '-'}</span>
              </td>
              <td className={tableClasses.tdNumeric}>
                <span className="font-mono">{player.totalValue.toFixed(2)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </UITable>
    </div>
  );
};

RankingsTable.displayName = 'RankingsTable';
export default RankingsTable;
