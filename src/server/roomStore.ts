'use server';

import { redisClient } from '@/lib/redis';
import { logger } from '@/lib/logger';

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

function roomsSetKey() {
  return `${prefix()}s:all`;
}

export class DraftRoomStore {
  private partDataKey(draftId: string) {
    return `draftroom:${draftId}:participants:data`;
  }
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
    if (client) {
      await client.sadd(participantsKey(draftId), participantId);
      // optional: store participant metadata stub
      await client.hset(
        this.partDataKey(draftId),
        participantId,
        JSON.stringify({ participantId, joinedAt: new Date().toISOString() })
      );
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
      await client.hdel(this.partDataKey(draftId), participantId);
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
    const payload = JSON.stringify({ ...data, participantId });
    if (client) {
      await client.hset(this.partDataKey(draftId), participantId, payload);
      return;
    }
    // in-memory fallback: store inside room state (not ideal, but ensures availability)
    const state = MEM_STORE.rooms.get(draftId) || makeDefaults(draftId);
    (state as any)._participantsData = (state as any)._participantsData || {};
    (state as any)._participantsData[participantId] = payload;
    MEM_STORE.rooms.set(draftId, state);
  }

  async getParticipantsData(draftId: string): Promise<Record<string, unknown>> {
    const client = redisClient.getClient();
    if (client) {
      const hash = await client.hgetall(this.partDataKey(draftId));
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(hash)) {
        try {
          result[k] = JSON.parse(v);
        } catch (err) {
          result[k] = { __raw: v, _parseError: err instanceof Error ? err.message : String(err) };
          logger.warn('Malformed participant data JSON', { draftId, participantKey: k });
        }
      }
      return result;
    }
    const state = MEM_STORE.rooms.get(draftId) as any;
    return state?._participantsData || {};
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
