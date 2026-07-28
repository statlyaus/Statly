import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('Firebase auth persistence architecture', () => {
  it('shares IndexedDB persistence between the browser and authentication service worker', () => {
    const browserClient = read('src/lib/firebaseClient.ts');
    const authWorker = read('src/workers/firebase-auth-service-worker.ts');

    expect(browserClient).toMatch(/if\s*\(typeof window === ['"]undefined['"]\)/);
    expect(browserClient).toMatch(/return\s+getAuth\(app\)/);
    expect(browserClient).toMatch(
      /initializeAuth\(app,\s*{[\s\S]*?persistence:\s*\[\s*indexedDBLocalPersistence,\s*browserLocalPersistence\s*\]/
    );
    expect(browserClient).toMatch(/popupRedirectResolver:\s*browserPopupRedirectResolver/);
    expect(browserClient).not.toContain('setPersistence(');

    expect(authWorker).toMatch(
      /initializeAuth\(firebaseApp,\s*{\s*persistence:\s*indexedDBLocalPersistence\s*}\)/
    );
    expect(authWorker).not.toContain('getAuth(firebaseApp)');
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
