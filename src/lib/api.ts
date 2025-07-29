// src/lib/api.ts

export async function fetchFromAPI<T>(path: string, options?: RequestInit): Promise<T> {
  const rawBaseUrl = import.meta.env.VITE_API_URL;

  if (!rawBaseUrl) {
    throw new Error("Missing VITE_API_URL in environment variables.");
  }

  const baseUrl = rawBaseUrl.replace(/\/$/, '');
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