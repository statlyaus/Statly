// Server-side room store utility (not a Server Action)

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
  participantData: new Map<string, Map<string, string>>(), // draftId -> participantId -> JSON payload
  readyMaps: new Map<string, Record<string, boolean>>(), // draftId -> memberId -> ready state
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
  private getTTL(): number {
    const hours = Number(process.env.DRAFT_ROOM_TTL_HOURS || 24);
    const validHours = Math.min(168, Math.max(1, Math.floor(hours))); // Cap at 1 week
    return validHours * 60 * 60; // seconds
  }

  private partDataKey(draftId: string) {
    return `draftroom:${draftId}:participants:data`;
  }

  private readyKey(draftId: string) {
    return `draftroom:${draftId}:ready`;
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
          raw 
        });
        return null;
      }
    }
    return MEM_STORE.rooms.get(draftId) || null;
  }

  async saveRoom(state: DraftRoomState): Promise<void> {
    const client = redisClient.getClient();
    if (client) {
      await client.set(roomKey(state.id), JSON.stringify(state), 'EX', this.getTTL());
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
      await client.del(this.partDataKey(draftId));
      await client.del(this.readyKey(draftId));
      await client.srem(roomsSetKey(), draftId);
      return;
    }
    MEM_STORE.rooms.delete(draftId);
    MEM_STORE.participants.delete(draftId);
    MEM_STORE.participantData.delete(draftId);
    MEM_STORE.readyMaps.delete(draftId);
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
      await client.hset(this.partDataKey(draftId), participantId, JSON.stringify({ 
        participantId, 
        joinedAt: new Date().toISOString() 
      }));
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

  async setParticipantData(draftId: string, participantId: string, data: Record<string, unknown>): Promise<void> {
    const client = redisClient.getClient();
    const payload = JSON.stringify({ ...data, participantId });
    if (client) {
      await client.hset(this.partDataKey(draftId), participantId, payload);
      return;
    }
    // In-memory fallback: store in participant data map
    const draftMap = MEM_STORE.participantData.get(draftId) || new Map<string, string>();
    draftMap.set(participantId, payload);
    MEM_STORE.participantData.set(draftId, draftMap);
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
    const map = MEM_STORE.participantData.get(draftId);
    const result: Record<string, unknown> = {};
    if (map) {
      for (const [k, v] of map.entries()) {
        try {
          result[k] = JSON.parse(v);
        } catch (err) {
          result[k] = { __raw: v, _parseError: err instanceof Error ? err.message : String(err) };
        }
      }
    }
    return result;
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

  // Lobby readiness persistence using dedicated in-memory map instead of reserved key
  async setReady(draftId: string, memberId: string, ready: boolean): Promise<void> {
    const client = redisClient.getClient();
    if (client) {
      if (ready) {
        await client.hset(this.readyKey(draftId), memberId, '1');
      } else {
        // store explicit 0 to reflect not ready; could also hdel to shrink
        await client.hset(this.readyKey(draftId), memberId, '0');
      }
      await client.expire(this.readyKey(draftId), this.getTTL());
      return;
    }
    
    // In-memory fallback: use dedicated ready map instead of reserved participant data key
    this.ensureReadyMap(draftId);
    const readyMap = MEM_STORE.readyMaps.get(draftId)!;
    readyMap[memberId] = !!ready;
  }

  async getReadyMap(draftId: string): Promise<Record<string, boolean>> {
    const client = redisClient.getClient();
    if (client) {
      const hash = await client.hgetall(this.readyKey(draftId));
      const out: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(hash)) {
        out[k] = v === '1' || v === 'true';
      }
      return out;
    }
    
    // In-memory fallback: return dedicated ready map
    this.ensureReadyMap(draftId);
    return MEM_STORE.readyMaps.get(draftId) || {};
  }

  // Helper to ensure ready map exists in memory
  private ensureReadyMap(draftId: string): void {
    if (!MEM_STORE.readyMaps.has(draftId)) {
      MEM_STORE.readyMaps.set(draftId, {});
    }
  }
}

export const draftRoomStore = new DraftRoomStore();