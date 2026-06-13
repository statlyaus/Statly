import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('local full stack development architecture', () => {
  const deprecatedEmulatorKeyLiteral = ['local', 'emulator', 'key'].join('-');

  it('declares Firebase Auth and Firestore emulators as the local Firebase stack', () => {
    const firebaseConfig = JSON.parse(read('firebase.json')) as {
      emulators?: {
        auth?: { port?: number };
        firestore?: { port?: number };
        ui?: { enabled?: boolean; port?: number };
      };
    };

    expect(firebaseConfig.emulators?.auth?.port).toBe(9099);
    expect(firebaseConfig.emulators?.firestore?.port).toBe(8080);
    expect(firebaseConfig.emulators?.ui?.enabled).toBe(true);
    expect(firebaseConfig.emulators?.ui?.port).toBe(4000);
  });

  it('exposes one canonical local full-stack command plus seed and smoke commands', () => {
    const packageJson = JSON.parse(read('package.json')) as { scripts?: Record<string, string> };
    const scripts = packageJson.scripts ?? {};

    expect(scripts['dev:firebase']).toContain('emulators:start --only auth,firestore');
    expect(scripts['dev:seed:local']).toBe('tsx Scripts/dev/seed-local-stack.ts');
    expect(scripts['dev:smoke:local']).toBe('tsx Scripts/dev/smoke-local-stack.ts');
    expect(scripts['dev:full:local']).toBe('bash Scripts/dev/full-local-stack.sh');
  });

  it('starts the app stack with Firebase emulator environment variables', () => {
    const source = read('Scripts/dev/full-local-stack.sh');

    expect(source).toContain('FIRESTORE_EMULATOR_HOST');
    expect(source).toContain('FIREBASE_AUTH_EMULATOR_HOST');
    expect(source).toContain('NEXT_PUBLIC_USE_EMULATORS');
    expect(source).toContain('NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_URL');
    expect(source).toContain('NEXT_PUBLIC_FIREBASE_API_KEY');
    expect(source).not.toContain(deprecatedEmulatorKeyLiteral);
    expect(source).toContain('npx firebase emulators:start --only auth,firestore');
    expect(source).toContain('npm run dev:seed:local');
    expect(source).toContain('npm:dev');
    expect(source).toContain('npm:socket');
    expect(source).toContain('npm:worker:dev');
  });

  it('seeds the shared local user into Auth, Prisma, and Firestore', () => {
    const source = read('Scripts/dev/seed-local-stack.ts');

    expect(source).toContain('FIREBASE_AUTH_EMULATOR_HOST');
    expect(source).toContain('DEVELOPMENT_AUTH_USER_ID');
    expect(source).toContain('DEVELOPMENT_AUTH_EMAIL');
    expect(source).toContain('resolveLocalDevelopmentAuthPhrase');
    expect(source).not.toContain('LOCAL_PASSWORD');
    expect(source).toContain('adminAuth.createUser');
    expect(source).toContain('adminAuth.updateUser');
    expect(source).toContain('prisma.user.upsert');
    expect(source).toContain('LEGACY_LOCAL_DEVELOPMENT_USER_IDS');
    expect(source).toContain('prisma.league.updateMany');
    expect(source).toContain('prisma.leagueMember.updateMany');
    expect(source).toContain('ownerId: DEVELOPMENT_AUTH_USER_ID');
    expect(source).toContain('userId: DEVELOPMENT_AUTH_USER_ID');
    expect(source).toContain("adminDb.collection('users').doc(DEVELOPMENT_AUTH_USER_ID)");
  });

  it('smoke tests local auth, firestore, socket, next, and full draft fixture', () => {
    const source = read('Scripts/dev/smoke-local-stack.ts');

    expect(source).toContain('accounts:signInWithPassword');
    expect(source).toContain('resolveAuthEmulatorRestKey');
    expect(source).not.toContain(deprecatedEmulatorKeyLiteral);
    expect(source).toContain('Socket.IO health');
    expect(source).toContain("adminDb.collection('users').doc(DEVELOPMENT_AUTH_USER_ID)");
    expect(source).toContain('/api/create-test-draft');
    expect(source).toContain('draft.teamCount !== 12');
  });

  it('keeps the dev test-user route aligned to the shared emulator identity', () => {
    const source = read('src/app/api/dev/test-user/route.ts');

    expect(source).toContain('DEVELOPMENT_AUTH_USER_ID');
    expect(source).toContain('DEVELOPMENT_AUTH_EMAIL');
    expect(source).toContain('DEVELOPMENT_AUTH_DISPLAY_NAME');
    expect(source).toContain('resolveLocalDevelopmentAuthPhrase');
    expect(source).not.toContain('LOCAL_DEVELOPMENT_PASSWORD');
    expect(source).not.toContain('2qlfdHSCFTPlxoKFSUfNLSlCDRe2');
    expect(source).not.toContain('League Admin');
  });

  it('documents the canonical local stack and dev-auth fallback policy', () => {
    const docs = read('docs/firebase-setup.md');

    expect(docs).toContain('npm run dev:full:local');
    expect(docs).toContain('npm run dev:smoke:local');
    expect(docs).toContain('admin@statly.dev');
    expect(docs).toContain('STATLY_LOCAL_AUTH_PHRASE');
    expect(docs).toContain('Use the local password printed by `npm run dev:full:local`');
    expect(docs).not.toContain(deprecatedEmulatorKeyLiteral);
    expect(docs).toContain('The legacy development-auth fallback remains available only');
  });
});
