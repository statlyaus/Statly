// Typed environment variables for server and client

declare namespace NodeJS {
  interface ProcessEnv {
    // Server-side secrets
    FIREBASE_SERVICE_ACCOUNT_JSON_BASE64?: string;
    GOOGLE_CLOUD_PROJECT?: string;
    GCLOUD_PROJECT?: string;

    // Client-side Firebase config
    NEXT_PUBLIC_FIREBASE_API_KEY: string;
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: string;
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: string;
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET?: string;
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID?: string;
    NEXT_PUBLIC_FIREBASE_APP_ID: string;
    NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID?: string;

    // Emulator config (public preferred for client)
    NEXT_PUBLIC_USE_EMULATORS?: 'true' | 'false';
    NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST?: string; // default localhost:8080
    NEXT_PUBLIC_AUTH_EMULATOR_HOST?: string; // default http://localhost:9099

    // Emulator config (server-private preferred)
    FIRESTORE_EMULATOR_HOST?: string; // e.g., localhost:8080
    FIREBASE_AUTH_EMULATOR_HOST?: string; // e.g., localhost:9099
  }
}

export {};
