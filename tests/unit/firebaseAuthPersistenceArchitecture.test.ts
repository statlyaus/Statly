import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('Firebase auth persistence architecture', () => {
  it('shares IndexedDB persistence between the browser and authentication service worker', () => {
    const browserAuth = read('src/lib/firebase/clientAuth.ts');
    const authWorker = read('src/workers/firebase-auth-service-worker.ts');

    expect(browserAuth).toMatch(/if\s*\(typeof window === ['"]undefined['"]\)/);
    expect(browserAuth).toMatch(/return\s+getAuth\(firebaseApp\)/);
    expect(browserAuth).toMatch(
      /initializeAuth\(firebaseApp,\s*{[\s\S]*?persistence:\s*\[\s*indexedDBLocalPersistence,\s*browserLocalPersistence\s*\]/
    );
    expect(browserAuth).toMatch(/popupRedirectResolver:\s*browserPopupRedirectResolver/);
    expect(browserAuth).not.toContain('setPersistence(');

    expect(authWorker).toMatch(
      /initializeAuth\(firebaseApp,\s*{\s*persistence:\s*indexedDBLocalPersistence\s*}\)/
    );
    expect(authWorker).not.toContain('getAuth(firebaseApp)');
  });

  it('reuses the default Firebase app and keeps emulator wiring idempotent', () => {
    const browserApp = read('src/lib/firebase/clientApp.ts');
    const browserAuth = read('src/lib/firebase/clientAuth.ts');
    const browserFirestore = read('src/lib/firebase/clientFirestore.ts');

    expect(browserApp).toMatch(
      /getApps\(\)\.length\s*===\s*0\s*\?\s*initializeApp\(firebaseClientConfig\)\s*:\s*getApp\(\)/
    );
    expect(browserAuth).toMatch(/if\s*\(!authInstance\.emulatorConfig\)\s*{/);
    expect(browserAuth).toMatch(/connectAuthEmulator\(authInstance,\s*authUrl,/);
    expect(browserFirestore).toMatch(
      /try\s*{\s*connectFirestoreEmulator\(firestore,\s*host,\s*port\);\s*}\s*catch\s*{/
    );
  });

  it('keeps analytics browser-only and disabled when Firebase emulators are active', () => {
    const browserAnalytics = read('src/lib/firebase/clientAnalytics.ts');

    expect(browserAnalytics).toContain("typeof window === 'undefined'");
    expect(browserAnalytics).toContain('!firebaseClientConfig.measurementId');
    expect(browserAnalytics).toContain('useFirebaseEmulators');
    expect(browserAnalytics).toContain("import('firebase/analytics')");
    expect(browserAnalytics).toContain('await isSupported()');
  });

  it('does not recreate a Firebase app inside feature components or expose a combined client', () => {
    const tradeReview = read('src/components/TradeReview.tsx');

    expect(existsSync(join(process.cwd(), 'src/lib/firebaseClient.ts'))).toBe(false);
    expect(tradeReview).toContain("from '@/lib/firebase/clientAuth'");
    expect(tradeReview).not.toContain('initializeApp');
    expect(tradeReview).not.toContain('getAuth');
    expect(tradeReview).not.toContain('_firebaseApp');
  });

  it('bounds worker token resolution and awaits authenticated fetch failures', () => {
    const authWorker = read('src/workers/firebase-auth-service-worker.ts');

    expect(authWorker).toMatch(/AUTH_TOKEN_TIMEOUT_MS\s*=\s*5_000/);
    expect(authWorker).toMatch(/unsubscribe\?\.\(\)/);
    expect(authWorker).toMatch(/setTimeout\(\(\)\s*=>\s*finish\(null\),\s*AUTH_TOKEN_TIMEOUT_MS\)/);
    expect(authWorker).toMatch(/return\s+await\s+fetch\(new Request\(request,\s*{\s*headers\s*}\)\)/);
  });

  it('fails production worker builds with incomplete Firebase configuration', () => {
    const workerBuild = read('Scripts/build-auth-service-worker.mjs');

    expect(workerBuild).toMatch(/requiredFirebaseConfigFields\s*=\s*\[\s*['"]apiKey['"]/);
    expect(workerBuild).toMatch(/if\s*\(process\.env\.NODE_ENV === ['"]production['"]\)/);
    expect(workerBuild).toMatch(/throw\s+new Error\(message\)/);
    expect(workerBuild).toContain('Building the Firebase-disabled development fallback.');
  });
});
