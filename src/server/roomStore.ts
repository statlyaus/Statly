'use server';

import { logger } from '@/lib/logger';
import { redisClient } from '@/lib/redis';

export type RoomStatus = 'waiting' | 'active' | 'paused' | 'completed';

export interface DraftRoomState {
  id: string;
  currentPick: number;
  timeRemaining: number;
  lastActivity: string; // ISO
  status: RoomStatus;
  maxParticipants: number;
  timePerPick: number;
}

export interface DraftRoomParticipantData {
  participantId: string;
  socketId: string;
  userId?: string;
  memberId?: string;
  displayName?: string;
  joinedAt: string;
  lastSeenAt: string;
}

const MEM_STORE = {
  rooms: new Map<string, DraftRoomState>(),
  participants: new Map<string, Set<string>>(),
};

function makeDefaults(draftId: string): DraftRoomState {
  return {
    id: draftId,
    currentPick: 1,
    timeRemaining: 120,
    lastActivity: new Date().toISOString(),
    status: 'waiting',
    maxParticipants: 12,
    timePerPick: 120,
  };
}

function prefix() {
  return process.env.REDIS_ROOM_PREFIX || 'draftroom';
}

function roomKey(draftId: string) {
  return `${prefix()}:${draftId}:state`;
}

function participantsKey(draftId: string) {
  return `${prefix()}:${draftId}:participants`;
}

function participantDataKey(draftId: string) {
  return `${prefix()}:${draftId}:participants:data`;
}

function roomsSetKey() {
  return `${prefix()}s:all`;
}

function getParticipantTtlMs() {
  return Number(process.env.DRAFT_ROOM_PARTICIPANT_TTL_MS || 10 * 60 * 1000);
}

function normalizeParticipantData(
  participantId: string,
  data: Record<string, unknown>
): DraftRoomParticipantData {
  const now = new Date().toISOString();
  const joinedAt =
    typeof data.joinedAt === 'string' && data.joinedAt.trim().length > 0 ? data.joinedAt : now;

  return {
    participantId,
    socketId:
      typeof data.socketId === 'string' && data.socketId.trim().length > 0
        ? data.socketId
        : participantId,
    userId: typeof data.userId === 'string' ? data.userId : undefined,
    memberId: typeof data.memberId === 'string' ? data.memberId : undefined,
    displayName: typeof data.displayName === 'string' ? data.displayName : undefined,
    joinedAt,
    lastSeenAt:
      typeof data.lastSeenAt === 'string' && data.lastSeenAt.trim().length > 0
        ? data.lastSeenAt
        : joinedAt,
  };
}

export class DraftRoomStore {
  async getRoom(draftId: string): Promise<DraftRoomState | null> {
    const client = redisClient.getClient();
    if (client) {
      const raw = await client.get(roomKey(draftId));
      if (!raw) return null;
      try {
        return JSON.parse(raw) as DraftRoomState;
      } catch (err) {
        logger.warn('Failed to parse DraftRoomState from Redis', {
          key: roomKey(draftId),
          error: err instanceof Error ? err.message : String(err),
          raw,
        });
        return null;
      }
    }
    return MEM_STORE.rooms.get(draftId) || null;
  }

  async saveRoom(state: DraftRoomState): Promise<void> {
    const client = redisClient.getClient();
    if (client) {
      await client.set(roomKey(state.id), JSON.stringify(state), 'EX', 24 * 60 * 60);
      await client.sadd(roomsSetKey(), state.id);
      return;
    }
    MEM_STORE.rooms.set(state.id, state);
  }

  async deleteRoom(draftId: string): Promise<void> {
    const client = redisClient.getClient();
    if (client) {
      await client.del(roomKey(draftId));
      await client.del(participantsKey(draftId));
      await client.srem(roomsSetKey(), draftId);
      return;
    }
    MEM_STORE.rooms.delete(draftId);
    MEM_STORE.participants.delete(draftId);
  }

  async initRoomIfMissing(draftId: string): Promise<DraftRoomState> {
    const existing = await this.getRoom(draftId);
    if (existing) return existing;
    const defaults = makeDefaults(draftId);
    await this.saveRoom(defaults);
    return defaults;
  }

  async addParticipant(draftId: string, participantId: string): Promise<number> {
    const client = redisClient.getClient();
    const participant = normalizeParticipantData(participantId, {
      participantId,
      socketId: participantId,
    });
    if (client) {
      await client.sadd(participantsKey(draftId), participantId);
      await client.hset(participantDataKey(draftId), participantId, JSON.stringify(participant));
      const count = await client.scard(participantsKey(draftId));
      return count;
    }
    const set = MEM_STORE.participants.get(draftId) || new Set<string>();
    set.add(participantId);
    MEM_STORE.participants.set(draftId, set);
    return set.size;
  }

  async removeParticipant(draftId: string, participantId: string): Promise<number> {
    const client = redisClient.getClient();
    if (client) {
      await client.srem(participantsKey(draftId), participantId);
      await client.hdel(participantDataKey(draftId), participantId);
      const count = await client.scard(participantsKey(draftId));
      return count;
    }
    const set = MEM_STORE.participants.get(draftId) || new Set<string>();
    set.delete(participantId);
    MEM_STORE.participants.set(draftId, set);
    return set.size;
  }

  async setParticipantData(
    draftId: string,
    participantId: string,
    data: Record<string, unknown>
  ): Promise<void> {
    const client = redisClient.getClient();
    const payload = JSON.stringify(normalizeParticipantData(participantId, data));
    if (client) {
      await client.hset(participantDataKey(draftId), participantId, payload);
      return;
    }
    // in-memory fallback: store inside room state (not ideal, but ensures availability)
    const state = MEM_STORE.rooms.get(draftId) || makeDefaults(draftId);
    (state as any)._participantsData = (state as any)._participantsData || {};

    // Normalize payload to match Redis behavior: parse JSON string to object
    let normalizedPayload: unknown;
    if (typeof payload === 'string') {
      try {
        normalizedPayload = JSON.parse(payload);
      } catch (err) {
        normalizedPayload = {
          __raw: payload,
          _parseError: err instanceof Error ? err.message : String(err),
        };
        logger.warn('Malformed participant data JSON in memory fallback', {
          draftId,
          participantId,
        });
      }
    } else {
      normalizedPayload = payload;
    }

    (state as any)._participantsData[participantId] = normalizedPayload;
    MEM_STORE.rooms.set(draftId, state);
  }

  async getParticipantsData(draftId: string): Promise<Record<string, DraftRoomParticipantData>> {
    const client = redisClient.getClient();
    if (client) {
      const hash = await client.hgetall(participantDataKey(draftId));
      const result: Record<string, DraftRoomParticipantData> = {};
      for (const [k, v] of Object.entries(hash)) {
        try {
          result[k] = normalizeParticipantData(k, JSON.parse(v) as Record<string, unknown>);
        } catch (err) {
          logger.warn('Malformed participant data JSON', { draftId, participantKey: k });
        }
      }
      return result;
    }
    const state = MEM_STORE.rooms.get(draftId) as any;
    return state?._participantsData || {};
  }

  async touchParticipant(draftId: string, participantId: string): Promise<void> {
    const current = (await this.getParticipantsData(draftId))[participantId];
    if (!current) {
      return;
    }

    await this.setParticipantData(draftId, participantId, {
      ...current,
      lastSeenAt: new Date().toISOString(),
    });
  }

  async reconcileParticipants(
    draftId: string,
    activeParticipantIds: Iterable<string>
  ): Promise<{ count: number; removed: string[] }> {
    const activeIds = new Set(activeParticipantIds);
    const participants = await this.getParticipantsData(draftId);
    const staleIds = Object.keys(participants).filter(
      (participantId) => !activeIds.has(participantId)
    );

    if (staleIds.length === 0) {
      return {
        count: await this.getParticipantCount(draftId),
        removed: [],
      };
    }

    await Promise.all(
      staleIds.map((participantId) => this.removeParticipant(draftId, participantId))
    );

    return {
      count: await this.getParticipantCount(draftId),
      removed: staleIds,
    };
  }

  async pruneExpiredParticipants(
    draftId: string,
    maxAgeMs = getParticipantTtlMs()
  ): Promise<{ count: number; removed: string[] }> {
    const cutoff = Date.now() - maxAgeMs;
    const participants = await this.getParticipantsData(draftId);
    const expiredIds = Object.entries(participants)
      .filter(([, data]) => {
        const freshness = Date.parse(data.lastSeenAt || data.joinedAt);
        return Number.isFinite(freshness) ? freshness < cutoff : true;
      })
      .map(([participantId]) => participantId);

    if (expiredIds.length === 0) {
      return {
        count: await this.getParticipantCount(draftId),
        removed: [],
      };
    }

    await Promise.all(
      expiredIds.map((participantId) => this.removeParticipant(draftId, participantId))
    );

    return {
      count: await this.getParticipantCount(draftId),
      removed: expiredIds,
    };
  }

  async getParticipantCount(draftId: string): Promise<number> {
    const client = redisClient.getClient();
    if (client) {
      return client.scard(participantsKey(draftId));
    }
    const set = MEM_STORE.participants.get(draftId);
    return set?.size || 0;
  }

  async getRoomsCount(): Promise<number> {
    const client = redisClient.getClient();
    if (client) {
      return client.scard(roomsSetKey());
    }
    return MEM_STORE.rooms.size;
  }
}

export const draftRoomStore = new DraftRoomStore();
