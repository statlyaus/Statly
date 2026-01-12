// Small helpers to parse emulator host strings into host/port pairs.
// Supports values like "localhost:8080" and "http://localhost:9099".

export type HostPort = { host: string; port: number };

export function parseHostPort(input: string, defaults: HostPort): HostPort {
  if (!input || typeof input !== 'string') return { ...defaults };
  try {
    // If a protocol is present, use URL
    if (/^https?:\/\//i.test(input)) {
      const u = new URL(input);
      return { host: u.hostname, port: Number(u.port || defaults.port) };
    }
    // Otherwise allow host:port
    const [hostPart, portPart] = input.split(':');
    const host = hostPart && hostPart.length > 0 ? hostPart : defaults.host;
    const port = portPart ? Number(portPart) : defaults.port;
    return { host, port: Number.isFinite(port) ? port : defaults.port };
  } catch {
    return { ...defaults };
  }
}

export const DEFAULTS = {
  firestore: { host: 'localhost', port: 8081 },
  auth: { host: 'localhost', port: 9100 },
};
