export interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

export function decodeServiceAccount(b64: string): ServiceAccount {
  let decoded: string;
  let parsed: Partial<ServiceAccount> | undefined;

  try {
    decoded = Buffer.from(b64, 'base64').toString('utf-8');
    parsed = JSON.parse(decoded);
  } catch {
    throw new Error('Invalid service account base64 string');
  }

  const { project_id, client_email, private_key } = parsed ?? {};
  if (!project_id || !client_email || !private_key) {
    throw new Error('Missing required service account fields');
  }

  return { project_id, client_email, private_key };
}

export function getServiceAccountFromEnv(): ServiceAccount {
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64;
  if (!b64) {
    throw new Error('Missing FIREBASE_SERVICE_ACCOUNT_JSON_BASE64');
  }
  return decodeServiceAccount(b64);
}

