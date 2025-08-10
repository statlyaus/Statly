export interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

export function parseServiceAccountBase64(b64: string): ServiceAccount {
  let json: string;
  try {
    json = Buffer.from(b64, 'base64').toString('utf-8');
  } catch {
    throw new Error('Invalid service account base64 string');
  }
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error('Invalid service account base64 string');
  }
  const { project_id, client_email, private_key } = data as Record<string, unknown>;
  if (
    typeof project_id !== 'string' ||
    typeof client_email !== 'string' ||
    typeof private_key !== 'string'
  ) {
    throw new Error('Missing required service account fields');
  }
  return { project_id, client_email, private_key };
}
