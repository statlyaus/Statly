import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';

interface DraftPageProps {
  params: { id: string };
}

// GET /api/leagues/[id]/draft - Get or create draft for league
export async function GET(_req: NextRequest, { params }: DraftPageProps): Promise<NextResponse> {
  try {
    const { id: leagueId } = params;

    // Development shortcut: support test league without requiring Firestore
    if (leagueId === 'test-league-id') {
      return NextResponse.json({
        success: true,
        data: {
          hasDraft: false,
          draftId: null,
          league: { id: 'test-league-id', name: 'Test AFL Champions League' },
          message: 'Test league: no draft exists yet',
        },
      });
    }

    // Check league exists
    const leagueRef = adminDb.collection('leagues').doc(leagueId);
    const leagueSnap = await leagueRef.get();
    if (!leagueSnap.exists) {
      return NextResponse.json({ success: false, error: 'League not found' }, { status: 404 });
    }
    const league = { id: leagueSnap.id, ...leagueSnap.data() } as Record<string, unknown>;

    // Resolve existing draft via mapping or league field
    const mappingRef = adminDb.collection('leagueDrafts').doc(leagueId);
    const mappingSnap = await mappingRef.get();
    let draftId: string | null = null;
    if (mappingSnap.exists) {
      draftId = (mappingSnap.data()?.draftId as string) || null;
    } else if ((league as any).draftId) {
      draftId = String((league as any).draftId);
    }

    if (!draftId) {
      return NextResponse.json({
        success: true,
        data: {
          hasDraft: false,
          draftId: null,
          league,
          message: 'No draft found for this league. Use the Draft tab to set up a draft.',
        },
      });
    }

    // Load draft summary
    const draftRef = adminDb.collection('drafts').doc(draftId);
    const draftSnap = await draftRef.get();
    if (!draftSnap.exists) {
      // Mapping points to missing draft; treat as no draft
      return NextResponse.json({
        success: true,
        data: {
          hasDraft: false,
          draftId: null,
          league,
          message: 'Draft mapping exists but draft not found. You may recreate a draft.',
        },
      });
    }

    const draft = { id: draftSnap.id, ...draftSnap.data() };
    return NextResponse.json({
      success: true,
      data: {
        hasDraft: true,
        draftId,
        league,
        draft,
      },
    });
  } catch (error) {
    console.error('Error fetching league draft:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch league draft' },
      { status: 500 }
    );
  }
}

// POST /api/leagues/[id]/draft - Create draft for league
export async function POST(req: NextRequest, { params }: DraftPageProps): Promise<NextResponse> {
  try {
    const { id: leagueId } = params;
    
    let body: Partial<{
      name: string;
      draftType: 'snake' | 'linear';
      timePerPick: number;
    }>;
    
    try {
      body = await req.json();
    } catch (parseError) {
      // Sanitize headers before logging to remove sensitive information
      const sanitizedHeaders: Record<string, string> = {};
      const sensitiveKeys = ['authorization', 'cookie', 'set-cookie', 'proxy-authorization', 'x-csrf-token'];
      
      for (const [key, value] of req.headers.entries()) {
        if (sensitiveKeys.includes(key.toLowerCase())) {
          sanitizedHeaders[key] = '[REDACTED]';
        } else {
          sanitizedHeaders[key] = value;
        }
      }
      
      console.error('JSON parsing failed for draft creation:', {
        leagueId,
        error: parseError instanceof Error ? parseError.message : 'Unknown parse error',
        requestInfo: {
          method: req.method,
          url: req.url,
          headers: sanitizedHeaders
        }
      });
      return NextResponse.json(
        { success: false, error: 'Invalid JSON in request body' },
        { status: 400 }
      );
    }

    // Validate input
    if (body.draftType && !['snake', 'linear'].includes(body.draftType)) {
      return NextResponse.json({ success: false, error: 'Invalid draft type' }, { status: 400 });
    }
    if (body.timePerPick && (body.timePerPick < 30 || body.timePerPick > 600)) {
      return NextResponse.json({ success: false, error: 'Time per pick must be between 30 and 600 seconds' }, { status: 400 });
    }

    // Validate league
    const leagueRef = adminDb.collection('leagues').doc(leagueId);
    const leagueSnap = await leagueRef.get();
    if (!leagueSnap.exists) {
      return NextResponse.json({ success: false, error: 'League not found' }, { status: 404 });
    }
    const league = { id: leagueSnap.id, ...leagueSnap.data() } as any;

    // Load members to seed participants
    const membersSnap = await adminDb
      .collection('leagueMembers')
      .where('leagueId', '==', leagueId)
      .get();
    const members = membersSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as any);

    // Compute initial draft document
    const now = new Date();
    const draftId = adminDb.collection('drafts').doc().id;
// Validate and normalize draft orders
const draftSlots = new Set<number>();
const participants = members.map((m: any, index: number) => {
  const slot = (m.draftSlot as number) || index + 1;
  if (draftSlots.has(slot)) {
    throw new Error(`Duplicate draft slot ${slot} detected`);
  }
  draftSlots.add(slot);
  return {
    userId: m.userId,
    memberId: m.id,
    displayName: m.teamName || `Team ${index + 1}`,
    draftOrder: slot,
    isOnline: false,
    queue: [],
    autoPickEnabled: true,
    lastActivity: FieldValue.serverTimestamp(),
  };
});

    // Use transaction to atomically create mapping + draft and update league
    let created = false;
    await adminDb.runTransaction(async (tx) => {
      const mapRef = adminDb.collection('leagueDrafts').doc(leagueId);
      const mapSnap = await tx.get(mapRef);
      if (mapSnap.exists) {
        return; // already mapped; do not create a duplicate
      }

      const draftRef = adminDb.collection('drafts').doc(draftId);
      tx.set(draftRef, {
        id: draftId,
        leagueId,
        name: body.name || `${league.name || 'League'} Draft`,
        status: 'PENDING',
        draftType: (body.draftType || 'snake').toUpperCase(),
        leagueSize: members.length || league.maxTeams || 8,
        currentPick: 1,
        currentRound: 1,
        currentTurn: 0,
        timeRemaining: body.timePerPick || 120,
        timerActive: false,
        participants,
        picks: [],
        settings: {
          pickTimeLimit: body.timePerPick || 120,
          allowTrades: false,
          autoPickEnabled: true,
        },
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        lastActivity: FieldValue.serverTimestamp(),
        createdAtDate: now.toISOString(),
      });

      tx.set(mapRef, {
        leagueId,
        draftId,
        createdAt: FieldValue.serverTimestamp(),
      });

      tx.set(leagueRef, { draftId, updated_at: FieldValue.serverTimestamp() }, { merge: true });

      created = true;
    });

    if (!created) {
      // If mapping already exists, return existing draft
      const existingMap = await adminDb.collection('leagueDrafts').doc(leagueId).get();
      const existingDraftId = (existingMap.data()?.draftId as string) || null;
      return NextResponse.json(
        existingDraftId
          ? { success: true, data: { message: 'Draft already exists', draftId: existingDraftId } }
          : { success: false, error: 'Draft already exists but could not resolve ID' },
        existingDraftId ? { status: 200 } : { status: 409 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        data: {
          draftId,
          league,
          participants: participants.map((p) => ({
            userId: p.userId,
            memberId: p.memberId,
            displayName: p.displayName,
            draftOrder: p.draftOrder,
          })),
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error creating league draft:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create league draft' },
      { status: 500 }
    );
  }
}
