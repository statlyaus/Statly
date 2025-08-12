import { fetchFromAPI } from '../lib/api';
import type { User, League, Draft, Pick, Queue } from '@prisma/client';

/**
 * Authentication
 */
export interface Credentials {
  email: string;
  password: string;
}

export async function login(data: Credentials): Promise<User> {
  return fetchFromAPI<User>('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function register(data: Credentials & { username: string }): Promise<User> {
  return fetchFromAPI<User>('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

/**
 * League
 */
export async function listLeagues(): Promise<League[]> {
  return fetchFromAPI<League[]>('/api/league');
}

export async function createLeague(data: Pick<League, 'name'>): Promise<League> {
  return fetchFromAPI<League>('/api/league', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

/**
 * Draft
 */
export async function getDraft(id: string): Promise<Draft> {
  return fetchFromAPI<Draft>(`/api/draft/${id}`);
}

export async function startDraft(leagueId: string): Promise<Draft> {
  return fetchFromAPI<Draft>('/api/draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ leagueId }),
  });
}

/**
 * Picks
 */
export async function submitPick(draftId: string, playerId: number): Promise<Pick> {
  return fetchFromAPI<Pick>(`/api/pick`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ draftId, playerId }),
  });
}

/**
 * Draft queue
 */
export async function getQueue(draftId: string): Promise<Queue[]> {
  return fetchFromAPI<Queue[]>(`/api/queue/${draftId}`);
}

export async function addToQueue(draftId: string, playerId: number): Promise<Queue> {
  return fetchFromAPI<Queue>(`/api/queue/${draftId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerId }),
  });
}

export async function removeFromQueue(draftId: string, playerId: number): Promise<void> {
  await fetchFromAPI<void>(`/api/queue/${draftId}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerId }),
  });
}

