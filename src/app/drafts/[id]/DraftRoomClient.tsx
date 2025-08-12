"use client";

import { useState } from 'react';
import Tabs from '@/components/Tabs';
import Table from '@/components/Table';
import Modal from '@/components/Modal';
import CountdownTimer from '@/components/CountdownTimer';
import Button from '@/components/Button';

interface DraftPlayer {
  id: string;
  name: string;
  position: string;
}

interface DraftRoomClientProps {
  players: DraftPlayer[];
}

export default function DraftRoomClient({ players }: DraftRoomClientProps) {
  const [tab, setTab] = useState('players');
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-4">
      <CountdownTimer initialSeconds={60} onExpire={() => setOpen(true)} />
      <Tabs
        tabs={[
          { value: 'players', label: 'Players' },
          { value: 'my-team', label: 'My Team' },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === 'players' && (
        <Table className="text-left">
          <thead>
            <tr>
              <th className="px-2 py-1">Name</th>
              <th className="px-2 py-1">Pos</th>
            </tr>
          </thead>
          <tbody>
            {players?.map((p) => (
              <tr key={p.id} className="odd:bg-neutral-50">
                <td className="px-2 py-1">{p.name}</td>
                <td className="px-2 py-1">{p.position}</td>
              </tr>
            )) ?? (
              <tr>
                <td colSpan={2} className="px-2 py-1 text-center text-gray-500">
                  No players available
                </td>
              </tr>
            )}
          </tbody>
        </Table>
      )}
      {tab === 'my-team' && (
        <Table>
          <tbody>
            <tr>
              <td className="px-2 py-1">No players yet</td>
            </tr>
          </tbody>
        </Table>
      )}
      <Modal open={open} onClose={() => setOpen(false)}>
        <p className="mb-4">Time is up!</p>
        <Button onClick={() => setOpen(false)}>Close</Button>
      </Modal>
    </div>
  );
}
