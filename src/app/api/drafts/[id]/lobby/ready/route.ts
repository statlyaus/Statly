import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { draftRoomStore } from '@/server/roomStore';
import { prisma } from '@/lib/prisma';

function requireAdmin(req: NextRequest): boolean {
  const secret = req.headers.get('x-admin-secret');
  const required = process.env.ADMIN_SECRET;
  return !!required && secret === required;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const isAdmin = requireAdmin(request);
  if (!isAdmin) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { id: draftId } = await params;
    const url = new URL(request.url);
    const format = url.searchParams.get('format') || 'array';

    let readyMap = await draftRoomStore.getReadyMap(draftId);
    let source: 'redis' | 'db' | 'empty' = Object.keys(readyMap || {}).length ? 'redis' : 'empty';

    if (!Object.keys(readyMap || {}).length) {
      try {
        // Try to load from database as fallback
        const rows = await prisma.$queryRaw<Array<{ memberId: string; ready: boolean }>>`
          SELECT "memberId", "ready" FROM "LobbyReady" WHERE "draftId" = ${draftId}
        `;
        const dbMap: Record<string, boolean> = {};
        for (const r of rows) dbMap[r.memberId] = r.ready;
        readyMap = dbMap;
        source = rows.length ? 'db' : 'empty';
      } catch {
        // Ignore db errors here; return empty
      }
    }

    if (format === 'map') {
      return NextResponse.json({
        success: true,
        data: { draftId, source, ready: readyMap },
      });
    }

    const arr = Object.entries(readyMap || {}).map(([memberId, ready]) => ({
      memberId,
      ready: !!ready,
    }));

    return NextResponse.json({
      success: true,
      data: { draftId, source, readyList: arr },
    });
  } catch (e) {
    return NextResponse.json(
      {
        success: false,
        error: (e as Error).message,
      },
      { status: 500 }
    );
  }
}
