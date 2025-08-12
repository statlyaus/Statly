import Tabs from '@/components/Tabs';
import Table from '@/components/Table';
import Modal from '@/components/Modal';
import CountdownTimer from '@/components/CountdownTimer';
import Button from '@/components/Button';
import { fetchFromAPI } from '@/lib/api';
import { notFound } from 'next/navigation';
import { Suspense, useState } from 'react';

interface DraftPlayer {
  id: string;
  name: string;
  position: string;
}

interface Draft {
  id: string;
  players: DraftPlayer[];
}

function DraftRoom({ players }: { players: DraftPlayer[] }) {
  'use client';
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
            {players.map((p) => (
              <tr key={p.id} className="odd:bg-neutral-50">
                <td className="px-2 py-1">{p.name}</td>
                <td className="px-2 py-1">{p.position}</td>
              </tr>
            ))}
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

export default async function DraftPage({ params }: { params: { id: string } }) {
  let draft: Draft | null = null;
  try {
    draft = await fetchFromAPI<Draft>(`/api/drafts/${params.id}`);
  } catch {
    // ignore
  }
  if (!draft) notFound();
  return (
    <main className="mx-auto max-w-3xl p-4 space-y-4">
      <h1 className="text-2xl font-semibold">Draft Room</h1>
      <Suspense fallback={<div>Loading...</div>}>
        <DraftRoom players={draft.players} />
      </Suspense>
    </main>
  );
}
