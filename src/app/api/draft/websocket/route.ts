import { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { adminAuth } from '@/lib/firebaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// WebSocket upgrade handler
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const draftId = searchParams.get('draftId');
  const userId = searchParams.get('userId');

  if (!draftId || !userId) {
    return new NextResponse('Missing draftId or userId', { status: 400 });
  }

  try {
    // Verify user authentication
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new NextResponse('Unauthorized', { status: 401 });
    }

    const token = authHeader.substring(7);
    const decoded = await adminAuth.verifyIdToken(token);
    
    if (decoded.uid !== userId) {
      return new NextResponse('Forbidden', { status: 403 });
    }

    // Verify user is part of the draft
    const draft = await prisma.draft.findUnique({
      where: { id: draftId },
      include: {
        league: {
          include: {
            members: {
              where: { userId },
            },
          },
        },
      },
    });

    if (!draft || draft.league.members.length === 0) {
      return new NextResponse('Draft not found or access denied', { status: 404 });
    }

    // Upgrade to WebSocket
    const { socket, response } = await request.socket.server.upgrade(request);
    
    // Store WebSocket connection
    if (!request.socket.server.draftConnections) {
      request.socket.server.draftConnections = new Map();
    }
    
    if (!request.socket.server.draftConnections.has(draftId)) {
      request.socket.server.draftConnections.set(draftId, new Map());
    }
    
    const draftConnections = request.socket.server.draftConnections.get(draftId)!;
    draftConnections.set(userId, socket);

    // Send welcome message
    socket.send(JSON.stringify({
      type: 'connected',
      data: {
        draftId,
        userId,
        timestamp: new Date().toISOString(),
      },
    }));

    // Handle WebSocket messages
    socket.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString());
        await handleWebSocketMessage(draftId, userId, message, request.socket.server);
      } catch (error) {
        logger.error('Error handling WebSocket message', { draftId, userId, error });
        socket.send(JSON.stringify({
          type: 'error',
          data: { message: 'Invalid message format' },
        }));
      }
    });

    // Handle connection close
    socket.on('close', () => {
      draftConnections.delete(userId);
      if (draftConnections.size === 0) {
        request.socket.server.draftConnections.delete(draftId);
      }
      
      // Notify other participants
      broadcastToDraft(draftId, userId, {
        type: 'participant:left',
        data: { userId, timestamp: new Date().toISOString() },
      }, request.socket.server);
    });

    // Handle errors
    socket.on('error', (error) => {
      logger.error('WebSocket error', { draftId, userId, error });
    });

    logger.info('WebSocket connection established', { draftId, userId });
    return response;

  } catch (error) {
    logger.error('Failed to establish WebSocket connection', { draftId, userId, error });
    return new NextResponse('Internal server error', { status: 500 });
  }
}

// Handle incoming WebSocket messages
async function handleWebSocketMessage(
  draftId: string,
  userId: string,
  message: any,
  server: any
) {
  const { type, data } = message;

  switch (type) {
    case 'ping':
      // Respond to ping with pong
      const connection = server.draftConnections?.get(draftId)?.get(userId);
      if (connection) {
        connection.send(JSON.stringify({
          type: 'pong',
          data: { timestamp: data.timestamp },
        }));
      }
      break;

    case 'pick:made':
      // Handle pick made
      await handlePickMade(draftId, userId, data, server);
      break;

    case 'queue:update':
      // Handle queue update
      await handleQueueUpdate(draftId, userId, data, server);
      break;

    case 'draft:pause':
      // Handle draft pause
      await handleDraftPause(draftId, userId, server);
      break;

    case 'draft:resume':
      // Handle draft resume
      await handleDraftResume(draftId, userId, server);
      break;

    default:
      logger.warn('Unknown WebSocket message type', { type, draftId, userId });
  }
}

// Handle pick made
async function handlePickMade(draftId: string, userId: string, data: any, server: any) {
  try {
    // Validate pick
    const { playerId } = data;
    
    // Update draft state in database
    const pick = await prisma.draftPick.create({
      data: {
        draftId,
        playerId,
        memberId: data.memberId,
        overall: data.overall,
        round: data.round,
        slot: data.slot,
        auto: false,
        madeAt: new Date(),
      },
      include: {
        player: true,
        member: {
          include: {
            user: true,
          },
        },
      },
    });

    // Broadcast pick to all participants
    broadcastToDraft(draftId, userId, {
      type: 'pick:made',
      data: {
        pick: {
          id: pick.id,
          overall: pick.overall,
          round: pick.round,
          slot: pick.slot,
          player: {
            id: pick.player.id,
            name: pick.player.name,
            position: pick.player.position,
            club: pick.player.club,
          },
          member: {
            id: pick.member.id,
            userId: pick.member.userId,
            displayName: pick.member.user.displayName,
            teamName: pick.member.teamName,
          },
          auto: pick.auto,
          madeAt: pick.madeAt.toISOString(),
        },
        currentPick: data.currentPick,
        round: data.round,
        direction: data.direction,
      },
    }, server);

    logger.info('Pick made successfully', { draftId, userId, playerId, pickId: pick.id });

  } catch (error) {
    logger.error('Failed to handle pick made', { draftId, userId, error });
    
    // Send error back to user
    const connection = server.draftConnections?.get(draftId)?.get(userId);
    if (connection) {
      connection.send(JSON.stringify({
        type: 'error',
        data: { message: 'Failed to make pick' },
      }));
    }
  }
}

// Handle queue update
async function handleQueueUpdate(draftId: string, userId: string, data: any, server: any) {
  try {
    const { queue } = data;
    
    // Update queue in database
    await prisma.leagueMember.updateMany({
      where: {
        userId,
        league: {
          drafts: {
            some: { id: draftId },
          },
        },
      },
      data: {
        // Store queue as JSON in a custom field or separate table
        // This is a simplified implementation
      },
    });

    // Broadcast queue update to all participants
    broadcastToDraft(draftId, userId, {
      type: 'queue:update',
      data: { userId, queue, timestamp: new Date().toISOString() },
    }, server);

  } catch (error) {
    logger.error('Failed to handle queue update', { draftId, userId, error });
  }
}

// Handle draft pause
async function handleDraftPause(draftId: string, userId: string, server: any) {
  try {
    // Verify user is league owner
    const draft = await prisma.draft.findUnique({
      where: { id: draftId },
      include: {
        league: {
          include: {
            members: {
              where: { userId, role: 'OWNER' },
            },
          },
        },
      },
    });

    if (!draft || draft.league.members.length === 0) {
      throw new Error('Only league owners can pause drafts');
    }

    // Update draft status
    await prisma.draft.update({
      where: { id: draftId },
      data: { status: 'PAUSED' },
    });

    // Broadcast pause to all participants
    broadcastToDraft(draftId, userId, {
      type: 'draft:paused',
      data: { pausedBy: userId, timestamp: new Date().toISOString() },
    }, server);

  } catch (error) {
    logger.error('Failed to handle draft pause', { draftId, userId, error });
  }
}

// Handle draft resume
async function handleDraftResume(draftId: string, userId: string, server: any) {
  try {
    // Verify user is league owner
    const draft = await prisma.draft.findUnique({
      where: { id: draftId },
      include: {
        league: {
          include: {
            members: {
              where: { userId, role: 'OWNER' },
            },
          },
        },
      },
    });

    if (!draft || draft.league.members.length === 0) {
      throw new Error('Only league owners can resume drafts');
    }

    // Update draft status
    await prisma.draft.update({
      where: { id: draftId },
      data: { status: 'LIVE' },
    });

    // Broadcast resume to all participants
    broadcastToDraft(draftId, userId, {
      type: 'draft:resumed',
      data: { resumedBy: userId, timestamp: new Date().toISOString() },
    }, server);

  } catch (error) {
    logger.error('Failed to handle draft resume', { draftId, userId, error });
  }
}

// Broadcast message to all participants in a draft
function broadcastToDraft(draftId: string, excludeUserId: string, message: any, server: any) {
  const draftConnections = server.draftConnections?.get(draftId);
  if (!draftConnections) return;

  const messageStr = JSON.stringify(message);
  
  for (const [userId, connection] of draftConnections.entries()) {
    if (userId !== excludeUserId && connection.readyState === 1) { // WebSocket.OPEN
      try {
        connection.send(messageStr);
      } catch (error) {
        logger.error('Failed to send message to participant', { draftId, userId, error });
      }
    }
  }
}
