export interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

export function decodeServiceAccount(base64: string): ServiceAccount {
  try {
    const json = Buffer.from(base64, 'base64').toString('utf-8');
    const obj = JSON.parse(json) as Partial<ServiceAccount>;
    if (!obj.project_id || !obj.client_email || !obj.private_key) {
      throw new Error('Missing required service account fields');
    }
    return obj as ServiceAccount;
  } catch (err) {
    throw new Error('Invalid service account base64 string');
  }
}

export function encodeServiceAccount(sa: ServiceAccount): string {
  return Buffer.from(JSON.stringify(sa)).toString('base64');
}

