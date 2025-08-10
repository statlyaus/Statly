import type { ServiceAccount } from 'firebase-admin/app';

/**
 * Encodes a service account object to a base64 string.
 */
export function encodeServiceAccount(sa: ServiceAccount): string {
  const json = JSON.stringify({
    project_id: sa.projectId,
    client_email: sa.clientEmail,
    private_key: sa.privateKey,
  });
  return Buffer.from(json, 'utf8').toString('base64');
}

/**
 * Decodes a service account from either a base64 string or JSON string.
 * Handles both camelCase and snake_case keys.
 */
export function decodeServiceAccount(value: string): ServiceAccount {
  const trimmed = value.trim();
  const json = trimmed.startsWith('{') ? trimmed : Buffer.from(trimmed, 'base64').toString('utf8');
  const data = JSON.parse(json) as Record<string, string>;
  return {
    projectId: data.projectId ?? data.project_id,
    clientEmail: data.clientEmail ?? data.client_email,
    privateKey: data.privateKey ?? data.private_key,
  } as ServiceAccount;
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
  const { projectId, clientEmail, privateKey } = sa;
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('Missing required service account fields');
  }
  return sa;
}
