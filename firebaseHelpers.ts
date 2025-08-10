export interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

export function parseServiceAccountFromBase64(b64: string): ServiceAccount {
  try {
    const json = Buffer.from(b64, 'base64').toString('utf-8');
    const parsed = JSON.parse(json) as Partial<ServiceAccount>;

    const { project_id, client_email, private_key } = parsed;
    if (!project_id || !client_email || !private_key) {
      throw new Error('Missing required service account fields');
    }

    return { project_id, client_email, private_key };
  } catch (err) {
    if (err instanceof SyntaxError) {
      // JSON parsing failure (includes invalid base64 resulting in bad JSON)
      throw new Error('Invalid service account JSON');
    }
    // rethrow other errors, such as field validation
    throw err;
  }
}
