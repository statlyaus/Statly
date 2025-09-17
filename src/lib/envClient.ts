// Lightweight client-side env reader to avoid bundling Zod
// Only exposes NEXT_PUBLIC_* values needed by the web SDKs.

type ClientEnv = {
  NEXT_PUBLIC_FIREBASE_API_KEY: string;
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: string;
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: string;
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET?: string;
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID?: string;
  NEXT_PUBLIC_FIREBASE_APP_ID: string;
  NEXT_PUBLIC_USE_EMULATORS: 'true' | 'false';
  NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST: string; // host:port
  NEXT_PUBLIC_AUTH_EMULATOR_HOST: string; // http://host:port
};

let _cached: Readonly<ClientEnv> | null = null;

export function getClientEnv(): Readonly<ClientEnv> {
  if (_cached) return _cached;
  // Only read from process.env (Next statically inlines these for client bundles)
  const req = (value: string | undefined, key: keyof ClientEnv) => {
    if (!value) throw new Error(`[envClient] Missing ${key}. Add it to .env.local or hosting env.`);
    return value;
  };

  const out: ClientEnv = {
    NEXT_PUBLIC_FIREBASE_API_KEY: req(process.env.NEXT_PUBLIC_FIREBASE_API_KEY, 'NEXT_PUBLIC_FIREBASE_API_KEY'),
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: req(process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN, 'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN'),
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: req(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, 'NEXT_PUBLIC_FIREBASE_PROJECT_ID'),
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    NEXT_PUBLIC_FIREBASE_APP_ID: req(process.env.NEXT_PUBLIC_FIREBASE_APP_ID, 'NEXT_PUBLIC_FIREBASE_APP_ID'),
    NEXT_PUBLIC_USE_EMULATORS: (process.env.NEXT_PUBLIC_USE_EMULATORS === 'true' ? 'true' : 'false'),
    NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST: process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST || 'localhost:8080',
    NEXT_PUBLIC_AUTH_EMULATOR_HOST: process.env.NEXT_PUBLIC_AUTH_EMULATOR_HOST || 'http://localhost:9099',
  };
  _cached = Object.freeze(out);
  return _cached;
}

export function isEmulatorEnabledClient(): boolean {
  return (process.env.NEXT_PUBLIC_USE_EMULATORS || 'false') === 'true';
}
