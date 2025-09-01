import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: draftId } = await params;
  
  try {
    // Fetch picks and draft timing data
    const [picksOrdered, draftTimes] = await Promise.all([
      prisma.pick.findMany({ 
        where: { draftId }, 
        select: { auto: true, madeAt: true, memberId: true }, 
        orderBy: { overall: 'asc' } 
      }),
      prisma.draft.findUnique({ 
        where: { id: draftId }, 
        select: { startedAt: true, completedAt: true } 
      }),
    ]);
    
    const totalPicks = picksOrdered.length;
    const autoPickCount = picksOrdered.filter((p) => p.auto).length;
    const pauseCount = 0;
    const totalDuration = draftTimes?.startedAt && draftTimes?.completedAt 
      ? Math.max(0, (draftTimes.completedAt.getTime() - draftTimes.startedAt.getTime()) / 1000) 
      : 0;

    // Per-pick durations (sec) based on deltas between madeAt of consecutive picks
    const durations: number[] = [];
    for (let i = 1; i < picksOrdered.length; i++) {
      const prev = picksOrdered[i - 1].madeAt.getTime();
      const cur = picksOrdered[i].madeAt.getTime();
      durations.push(Math.max(0, (cur - prev) / 1000));
    }
    
    const averagePickTime = durations.length 
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) 
      : 0;
    const sorted = [...durations].sort((a, b) => a - b);
    const medianPickTimeSec = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
    const p95PickTimeSec = sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : 0;

    // Per-participant summaries
    const perCounts = new Map<string, { picks: number; auto: number; timeSum: number; samples: number }>();
    for (let i = 0; i < picksOrdered.length; i++) {
      const m = picksOrdered[i].memberId;
      const rec = perCounts.get(m) || { picks: 0, auto: 0, timeSum: 0, samples: 0 };
      rec.picks += 1;
      if (picksOrdered[i].auto) rec.auto += 1;
      if (i > 0) {
        const dt = Math.max(0, (picksOrdered[i].madeAt.getTime() - picksOrdered[i - 1].madeAt.getTime()) / 1000);
        rec.timeSum += dt;
        rec.samples += 1;
      }
      perCounts.set(m, rec);
    }
    
    const participantEngagement: Record<string, number> = {};
    const perParticipant = Array.from(perCounts.entries()).map(([memberId, v]) => {
      participantEngagement[memberId] = v.picks;
      const avg = v.samples ? Math.round(v.timeSum / v.samples) : 0;
      const autoRate = v.picks ? Math.round((v.auto / v.picks) * 100) : 0;
      return { memberId, picksMade: v.picks, avgPickTimeSec: avg, autoPickRatePct: autoRate };
    });
    
    // Picks per minute timeseries
    const series: Array<{ t: string; count: number }> = [];
    if (picksOrdered.length) {
      const startMs = picksOrdered[0].madeAt.getTime();
      const bucket = new Map<number, number>();
      for (const p of picksOrdered) {
        const minute = Math.floor((p.madeAt.getTime() - startMs) / 60000);
        bucket.set(minute, (bucket.get(minute) || 0) + 1);
      }
      const sortedKeys = Array.from(bucket.keys()).sort((a, b) => a - b);
      const last = sortedKeys.at(-1) ?? 0;
      for (let k = 0; k <= last; k++) {
        const ts = new Date(startMs + k * 60000).toISOString();
        series.push({ t: ts, count: bucket.get(k) || 0 });
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        totalPicks,
        averagePickTime,
        autoPickCount,
        pauseCount,
        totalDuration,
        participantEngagement,
        medianPickTimeSec,
        p95PickTimeSec,
        perParticipant: perParticipant || [],
        picksPerMinute: series || [],
      },
    });
  } catch (error) {
    logger.error('Failed to get draft analytics', { 
      draftId, 
      error: error instanceof Error ? error.message : String(error) 
    });
    return NextResponse.json(
      { success: false, error: { message: 'Failed to get analytics' } }, 
      { status: 500 }
    );
  }
}