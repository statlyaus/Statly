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

    expect(browserClient).toContain("if (typeof window === 'undefined')");
    expect(browserClient).toContain('return getAuth(app)');
    expect(browserClient).toContain('initializeAuth(app, {');
    expect(browserClient).toContain(
      'persistence: [indexedDBLocalPersistence, browserLocalPersistence]'
    );
    expect(browserClient).toContain('popupRedirectResolver: browserPopupRedirectResolver');
    expect(browserClient).not.toContain('setPersistence(');

    expect(authWorker).toContain(
      'initializeAuth(firebaseApp, { persistence: indexedDBLocalPersistence })'
    );
    expect(authWorker).not.toContain('getAuth(firebaseApp)');
  });

  it('fails production worker builds with incomplete Firebase configuration', () => {
    const workerBuild = read('Scripts/build-auth-service-worker.mjs');

    expect(workerBuild).toContain("const requiredFirebaseConfigFields = ['apiKey'");
    expect(workerBuild).toContain("if (process.env.NODE_ENV === 'production')");
    expect(workerBuild).toContain('throw new Error(message)');
    expect(workerBuild).toContain('Building the Firebase-disabled development fallback.');
  });
});
