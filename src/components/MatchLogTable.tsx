// src/Components/MatchLogTable.tsx
import React from 'react';

type MatchLog = {
  round: number;
  opponent: string;
  goals?: number;
  disposals?: number;
  marks?: number;
  tackles?: number;
  fantasyPoints?: number;
};

type MatchLogTableProps = {
  matchLogs: MatchLog[];
};

const MatchLogTable = ({ matchLogs }: MatchLogTableProps) => {
  if (!matchLogs || matchLogs.length === 0) {
    return <p className="text-sm text-gray-500">No match data available.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full table-auto text-sm border-collapse">
        <thead className="bg-gray-100">
          <tr>
            <th className="px-3 py-2 text-left">Round</th>
            <th className="px-3 py-2 text-left">Opponent</th>
            <th className="px-3 py-2 text-left">Goals</th>
            <th className="px-3 py-2 text-left">Disposals</th>
            <th className="px-3 py-2 text-left">Marks</th>
            <th className="px-3 py-2 text-left">Tackles</th>
            <th className="px-3 py-2 text-left">Points</th>
          </tr>
        </thead>
        <tbody>
          {matchLogs.map((log, idx) => (
            <tr key={idx} className="border-t hover:bg-gray-50">
              <td className="px-3 py-2">{log.round}</td>
              <td className="px-3 py-2">{log.opponent}</td>
              <td className="px-3 py-2">{log.goals ?? '-'}</td>
              <td className="px-3 py-2">{log.disposals ?? '-'}</td>
              <td className="px-3 py-2">{log.marks ?? '-'}</td>
              <td className="px-3 py-2">{log.tackles ?? '-'}</td>
              <td className="px-3 py-2"></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default MatchLogTable;
