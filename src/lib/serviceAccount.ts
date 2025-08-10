import type { ServiceAccount } from 'firebase-admin/app';

/**
 * Encodes a service account object to a base64 string.
 */
export function encodeServiceAccount(sa: ServiceAccount): string {
  const json = JSON.stringify(sa);
  return Buffer.from(json, 'utf8').toString('base64');
}

/**
 * Decodes a service account from either a base64 string or JSON string.
 */
export function decodeServiceAccount(value: string): ServiceAccount {
  const trimmed = value.trim();
  const json = trimmed.startsWith('{')
    ? trimmed
    : Buffer.from(trimmed, 'base64').toString('utf8');
  return JSON.parse(json) as ServiceAccount;
}
