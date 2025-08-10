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

/**
 * Reads the service account from the `FIREBASE_SERVICE_ACCOUNT_JSON_BASE64`
 * environment variable.
 */
export function getServiceAccountFromEnv(): ServiceAccount {
  const value = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64;
  if (!value) {
    throw new Error('Missing FIREBASE_SERVICE_ACCOUNT_JSON_BASE64');
  }

  const sa = decodeServiceAccount(value);
  const { project_id, client_email, private_key } = sa as unknown as Record<string, unknown>;
  if (!project_id || !client_email || !private_key) {
    throw new Error('Missing required service account fields');
  }
  return sa;
}
