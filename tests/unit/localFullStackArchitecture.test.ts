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
    const packageJson = JSON.parse(read('package.json')) as {
      scripts?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const scripts = packageJson.scripts ?? {};

    expect(packageJson.devDependencies?.['firebase-tools']).toBeUndefined();
    expect(scripts['dev:firebase']).toBe(
      'npx --yes --package=firebase-tools@15.25.0 firebase emulators:start --only auth,firestore'
    );
    expect(scripts['dev:firebase']).not.toContain('npx firebase');
    expect(scripts['dev:seed:local']).toBe('tsx Scripts/dev/seed-local-stack.ts');
    expect(scripts['dev:smoke:local']).toBe('tsx Scripts/dev/smoke-local-stack.ts');
    expect(scripts['dev:full:local']).toBe('bash Scripts/dev/full-local-stack.sh');
    expect(scripts['dev:full:all']).toBe('bash Scripts/dev/full-local-stack.sh');
  });

  it('starts the app stack with Firebase emulator environment variables', () => {
    const source = read('Scripts/dev/full-local-stack.sh');
    const firebaseConfig = read('src/lib/firebase/clientConfig.ts');
    const firebaseAuth = read('src/lib/firebase/clientAuth.ts');
    const firebaseFirestore = read('src/lib/firebase/clientFirestore.ts');
    const firebaseAnalytics = read('src/lib/firebase/clientAnalytics.ts');
    const executableLines = source
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'));

    expect(source).toContain('FIRESTORE_EMULATOR_HOST');
    expect(source).toContain('FIREBASE_AUTH_EMULATOR_HOST');
    expect(source).toContain('NEXT_PUBLIC_USE_EMULATORS');
    expect(source).toContain('NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_URL');
    expect(source).toContain('NEXT_PUBLIC_FIREBASE_API_KEY');
    expect(source).not.toContain(deprecatedEmulatorKeyLiteral);
    expect(source).toContain('port_is_open()');
    expect(source).toContain('reusing existing Firebase emulators');
    expect(source).toContain('npm run dev:firebase -- --project "$STATLY_LOCAL_PROJECT_ID"');
    expect(source).not.toContain('npx firebase');
    expect(source).toContain('npm run prisma:generate');
    expect(source).toContain('npx prisma migrate deploy');
    expect(source).toContain('npm run dev:seed:local');
    expect(executableLines).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/^(export\s+)?DATABASE_URL=/)])
    );
    expect(source.indexOf('npx prisma migrate deploy')).toBeLessThan(
      source.indexOf('npm run dev:seed:local')
    );
    expect(source).toContain('npm:dev');
    expect(source).toContain('npm:socket');
    expect(source).toContain('npm:draft-worker:dev');
    expect(source).toContain('export SOCKET_PORT="3002"');
    expect(source).toContain('export SOCKETIO_PORT="3002"');
    expect(source).toContain('export SOCKET_IO_PORT="3002"');
    expect(source).toContain('export NEXT_PUBLIC_SOCKET_URL="http://localhost:3002"');
    expect(firebaseConfig).toContain('const useFirebaseEmulators');
    expect(firebaseAuth).toContain('if (!useFirebaseEmulators || !authInstance)');
    expect(firebaseFirestore).toContain('if (useFirebaseEmulators)');
    expect(firebaseAnalytics).toContain('!firebaseClientConfig.measurementId');
    expect(firebaseAnalytics).toContain('useFirebaseEmulators');
  });

  it('does not require clipboard permission to recover from invite copy failures', () => {
    const source = read('src/components/league/InviteModal.tsx');

    expect(source).toContain('copyToClipboard');
    expect(source).toContain('navigator.clipboard?.writeText');
    expect(source).toContain('Copy ${label} manually.');
  });

  it('allows the local HTTP app to persist session cookies after emulator login', () => {
    const source = read('src/app/api/auth/session/route.ts');

    expect(source).toContain("process.env.NODE_ENV === 'production'");
    expect(source).toContain('secure: isProduction');
    expect(source).not.toContain('secure: true');
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
    expect(source).toContain('REAL_DATA_NINE_CATEGORY_PRESET');
    expect(source).toContain('LOCAL_TEST_DRAFT_POSITION_LIMITS');
    expect(source).toContain('DEFAULT_DRAFT_AUTO_PICK_RULES');
    expect(source).toContain('positionLimitsJson');
    expect(source).toContain('autoPickRulesJson');
    expect(source).toContain('pickDeadlineAt');
    expect(source).toContain('draft.pickDeadlineAt.getTime() > now.getTime()');
    expect(source).toContain('schedulingVersion: { increment: 1 }');
    expect(source).toContain('repairedPickExpiryJobs');
    expect(source).toContain('scheduleDraftPickExpiry');
    expect(source).toContain("kind: 'draft:pick-expiry'");
    expect(source).toContain("adminDb.collection('users').doc(DEVELOPMENT_AUTH_USER_ID)");
  });

  it('creates feasible full local draft fixtures for the current local player pool', () => {
    const draftSettings = read('src/lib/draftSettings.ts');
    const createTestDraft = read('src/app/api/create-test-draft/route.ts');

    expect(draftSettings).toContain('LOCAL_TEST_DRAFT_POSITION_LIMITS');
    expect(draftSettings).toContain('DEF: 1');
    expect(draftSettings).toContain('MID: 15');
    expect(draftSettings).toContain('RUC: 1');
    expect(draftSettings).toContain('FWD: 1');
    expect(draftSettings).toContain('BENCH: 4');
    expect(createTestDraft).toContain('LOCAL_TEST_DRAFT_POSITION_LIMITS');
    expect(createTestDraft).not.toContain('DEFAULT_DRAFT_POSITION_LIMITS');
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
    const docs = read('docs/development/setup.md');
    const localStack = read('Scripts/dev/full-local-stack.sh');

    expect(docs).toContain('cp .env.example .env');
    expect(docs).toContain('both Next.js and the Prisma CLI');
    expect(docs).toContain('npm run dev:full:local');
    expect(docs).toContain('npm run dev:smoke:local');
    expect(docs).toContain('admin@statly.dev');
    expect(docs).toContain('STATLY_LOCAL_AUTH_PHRASE');
    expect(docs).toMatch(/Use the local password printed by\s+`npm run dev:full:local`/);
    expect(docs).not.toContain(deprecatedEmulatorKeyLiteral);
    expect(docs).toContain('The legacy development-auth fallback is not enabled by that harness');
    expect(localStack).not.toContain('export NEXT_PUBLIC_STATLY_ENABLE_DEV_AUTH=');
    expect(localStack).not.toContain('export STATLY_ENABLE_DEV_AUTH=');
  });
});
