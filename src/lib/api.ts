// src/lib/api.ts

import { env } from '@/lib/env';

export async function fetchFromAPI<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const baseUrl = env.NEXT_PUBLIC_API_URL.replace(/\/$/, '');
  const url = `${baseUrl}${path}`;

  const res = await fetch(url, options);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error (${res.status}): ${text}`);
  }

  return res.json();
}

export function buildQuery(params: Record<string, string>) {
  return '?' + new URLSearchParams(params).toString();
}
