'use client';

import { useState, useMemo } from 'react';
import type { CSSProperties } from 'react';

import { FixedSizeList as List } from 'react-window';

import { tableClasses } from '@/components/Table';

import PlayerFilters from './PlayerFilters';
import PlayerTableRow from './PlayerTableRow';

import type { Player } from '../types/players';
import type { ListChildComponentProps } from 'react-window';

const ROW_HEIGHT = 48;

type PlayerTableProps = {
  players: Player[];
  isMyPick?: boolean;
  watchedIds?: string[];
  /**
   * List of drafted player IDs (used for disabling draft button and row opacity).
   */
  draftedIds?: string[];
  onWatchToggle?: (playerId: string) => void;
  onConfirmDraft?: (player: Player) => void;
};

const PlayerTable = ({
  players = [],
  isMyPick = false,
  watchedIds = [],
  draftedIds = [],
  onWatchToggle = () => {},
  onConfirmDraft = () => {},
}: PlayerTableProps): React.ReactElement => {
  const [selectedTeam, setSelectedTeam] = useState<string>('All');
  const [selectedPosition, setSelectedPosition] = useState<string>('All');

  // Players prop is expected to be already filtered for undrafted players.
  const filteredPlayers = useMemo(() => {
    return players
      .filter((p) => selectedTeam === 'All' || p.team === selectedTeam)
      .filter((p) => selectedPosition === 'All' || p.position === selectedPosition);
  }, [players, selectedTeam, selectedPosition]);

  // Item renderer for virtualized list
  const ItemRenderer = ({
    index,
    style,
    data,
  }: {
    index: number;
    style: CSSProperties;
    data: {
      players: Player[];
      isMyPick: boolean;
      watchedIds: string[];
      draftedIds: string[];
      onWatchToggle: (playerId: string) => void;
      onConfirmDraft: (player: Player) => void;
    };
  }) => {
    const player = data.players[index];
    return (
      <div style={style}>
        <PlayerTableRow
          player={player}
          isMyPick={data.isMyPick}
          isWatched={data.watchedIds.includes(player.id)}
          isDrafted={data.draftedIds.includes(player.id)}
          onWatchToggle={data.onWatchToggle}
          onConfirmDraft={data.onConfirmDraft}
        />
      </div>
    );
  };

  if (!players.length) {
    return <p className="text-sm text-gray-500">No players available.</p>;
  }

  return (
    <div className="space-y-4">
      <PlayerFilters
        players={players}
        selectedTeam={selectedTeam}
        setSelectedTeam={setSelectedTeam}
        selectedPosition={selectedPosition}
        setSelectedPosition={setSelectedPosition}
      />
      {!isMyPick && (
        <p className="text-sm text-gray-500 italic">
          Waiting for your turn – you can still browse the player list.
        </p>
      )}

      <div className={tableClasses.container}>
        <table className="w-full text-sm table-auto border-collapse">
          <thead className={tableClasses.thead}>
            <tr>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">
                Name
              </th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">
                Team
              </th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">
                Pos
              </th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase w-8">
                Watch
              </th>
              <th className="px-3 py-2" aria-hidden="true"></th>
            </tr>
          </thead>
          <tbody className={tableClasses.trZebra}>
            {filteredPlayers.length > 200 ? (
              <tr>
                <td colSpan={5} className="p-0">
                  <List
                    height={Math.min(filteredPlayers.length, 10) * ROW_HEIGHT}
                    width="100%"
                    itemCount={filteredPlayers.length}
                    itemSize={ROW_HEIGHT}
                    itemData={{
                      players: filteredPlayers,
                      isMyPick,
                      watchedIds,
                      draftedIds,
                      onWatchToggle,
                      onConfirmDraft,
                    }}
                  >
                    {ItemRenderer}
                  </List>
                </td>
              </tr>
            ) : (
              filteredPlayers.map((player) => (
                <PlayerTableRow
                  key={player.id}
                  player={player}
                  isMyPick={isMyPick}
                  isWatched={watchedIds.includes(player.id)}
                  isDrafted={draftedIds.includes(player.id)}
                  onWatchToggle={onWatchToggle}
                  onConfirmDraft={onConfirmDraft}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default PlayerTable;
