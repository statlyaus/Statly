export function decodeServiceAccount(b64: string) {
  try {
    const json = Buffer.from(b64, 'base64').toString('utf-8');
    return JSON.parse(json);
  } catch {
    throw new Error('Invalid service account base64 string');
  }
}
