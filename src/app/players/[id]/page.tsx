import { notFound } from 'next/navigation';
import { adminDb } from '@/lib/firebaseAdmin';
import type { QueryDocumentSnapshot } from 'firebase-admin/firestore';

// Assuming a global Player type exists, e.g., in src/types.ts
interface Player {
  id: string;
  name: string;
  team: string;
  position: string;
  stats: Record<string, unknown>;
}

async function getPlayer(id: string): Promise<Player | null> {
  if (!adminDb) {
    console.error('Firebase Admin DB is not initialized. Check server logs.');
    return null;
  }
  const playerRef = adminDb.collection('players').doc(id);
  const doc = await playerRef.get();

  if (!doc.exists) {
    return null;
  }
  return { id: doc.id, ...(doc.data() as Omit<Player, 'id'>) };
}

export async function generateStaticParams() {
  if (!adminDb) {
    return [];
  }
  const playersSnapshot = await adminDb.collection('players').get();
  return playersSnapshot.docs.map((doc: QueryDocumentSnapshot) => ({
    id: doc.id,
  }));
}

type PlayerPageProps = {
  params: { id: string };
};

export default async function PlayerPage({ params }: PlayerPageProps) {
  const player = await getPlayer(params.id);

  if (!player) {
    notFound();
  }

  return (
    <div className="container mx-auto p-6 bg-white rounded-lg shadow-md">
      <h1 className="text-4xl font-bold mb-2">{player.name}</h1>
      <p className="text-xl text-gray-600 mb-4">
        {player.team} - {player.position}
      </p>
      <pre className="bg-gray-100 p-4 rounded-md">
        <code>{JSON.stringify(player.stats, null, 2)}</code>
      </pre>
    </div>
  );
}