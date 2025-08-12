import Tabs from '@/components/Tabs';
import Table from '@/components/Table';
import Modal from '@/components/Modal';
import CountdownTimer from '@/components/CountdownTimer';
import Button from '@/components/Button';
import { fetchFromAPI } from '@/lib/api';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import DraftRoomClient from './DraftRoomClient';

interface DraftPlayer {
  id: string;
  name: string;
  position: string;
}

interface Draft {
  id: string;
  players: DraftPlayer[];
}

interface ApiResponse {
  success: boolean;
  data: Draft;
  timestamp: string;
}

export default async function DraftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let draft: Draft | null = null;
  try {
    const response = await fetchFromAPI<ApiResponse>(`/api/drafts/${id}`);
    draft = response.data;
  } catch {
    // ignore
  }
  if (!draft) notFound();
  return (
    <main className="mx-auto max-w-3xl p-4 space-y-4">
      <h1 className="text-2xl font-semibold">Draft Room</h1>
      <Suspense fallback={<div>Loading...</div>}>
        <DraftRoomClient players={draft.players} />
      </Suspense>
    </main>
  );
}
