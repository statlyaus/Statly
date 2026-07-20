'use client';

import { pingback } from '@giphy/js-analytics';
import { GiphyFetch } from '@giphy/js-fetch-api';

export type GiphyGif = Awaited<ReturnType<GiphyFetch['gif']>>['data'];

export const GIPHY_WEB_SDK_KEY = process.env.NEXT_PUBLIC_GIPHY_WEB_SDK_KEY?.trim() ?? '';

const clients = new Map<string, GiphyFetch>();

export function getGiphyClient(apiKey = GIPHY_WEB_SDK_KEY): GiphyFetch | null {
  if (!apiKey) return null;

  const existing = clients.get(apiKey);
  if (existing) return existing;

  const client = new GiphyFetch(apiKey);
  clients.set(apiKey, client);
  return client;
}

export function registerGiphySent(gif: GiphyGif): void {
  if (!gif.analytics_response_payload) return;

  try {
    pingback({
      analyticsResponsePayload: gif.analytics_response_payload,
      actionType: 'SENT',
    });
  } catch {
    // Analytics must never turn a successfully persisted chat message into a send error.
  }
}
