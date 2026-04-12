import { NextResponse, type NextRequest } from 'next/server';
export const runtime = 'nodejs';

import { dcAvailable, listLivePlayerStatsDC } from '@/lib/dataConnectClient';
import { getLivePlayerStats } from '@/lib/etlIntegration';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const season = searchParams.get('season') ? parseInt(searchParams.get('season')!, 10) : undefined;
  const enableDC = process.env.ENABLE_DC === 'true';

  const firestore = await getLivePlayerStats(season);

  if (!enableDC) {
    return NextResponse.json(
      {
        dataConnect: { available: false, enabled: false },
        firestore: { count: firestore.length, sample: firestore.slice(0, 3) },
        note: 'Set ENABLE_DC=true and generate Data Connect operations to enable comparison.',
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const available = await dcAvailable();
  if (!available) {
    return NextResponse.json(
      {
        dataConnect: { available: false, enabled: true },
        firestore: { count: firestore.length, sample: firestore.slice(0, 3) },
        note: 'Data Connect SDK not found at src/lib/dataconnect/generated. Run codegen via the VS Code extension after creating operations in the console.',
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const dc = await listLivePlayerStatsDC();
  return NextResponse.json(
    {
      dataConnect: dc.ok
        ? {
            available: true,
            count: (dc.data as any[]).length,
            sample: (dc.data as any[]).slice(0, 3),
          }
        : { available: true, error: dc.error },
      firestore: { count: firestore.length, sample: firestore.slice(0, 3) },
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
