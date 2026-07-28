/// <reference lib="webworker" />

import { initializeApp, type FirebaseOptions } from 'firebase/app';
import {
  connectAuthEmulator,
  getIdToken,
  indexedDBLocalPersistence,
  initializeAuth,
  onAuthStateChanged,
} from 'firebase/auth';

import { isAuthServiceWorkerRequestEligible } from '@/lib/authServiceWorker';

declare const __FIREBASE_CONFIG__: FirebaseOptions;
declare const __FIREBASE_AUTH_EMULATOR_URL__: string | null;

const worker = globalThis as unknown as ServiceWorkerGlobalScope;
const firebaseApp = initializeApp(__FIREBASE_CONFIG__);
const auth = initializeAuth(firebaseApp, { persistence: indexedDBLocalPersistence });
const AUTH_TOKEN_TIMEOUT_MS = 5_000;

if (__FIREBASE_AUTH_EMULATOR_URL__) {
  connectAuthEmulator(auth, __FIREBASE_AUTH_EMULATOR_URL__, { disableWarnings: true });
}

function getCurrentIdToken(): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let unsubscribe: (() => void) | undefined;

    const finish = (token: string | null) => {
      if (settled) return;

      settled = true;
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      unsubscribe?.();
      resolve(token);
    };

    unsubscribe = onAuthStateChanged(
      auth,
      (user) => {
        if (!user) {
          finish(null);
          return;
        }

        void getIdToken(user).then(finish, () => finish(null));
      },
      () => finish(null)
    );

    if (!settled) {
      timeoutId = setTimeout(() => finish(null), AUTH_TOKEN_TIMEOUT_MS);
    }
  });
}

async function fetchWithCurrentIdentity(request: Request): Promise<Response> {
  const idToken = await getCurrentIdToken();
  if (!idToken) {
    return fetch(request);
  }

  const headers = new Headers(request.headers);
  headers.set('Authorization', `Bearer ${idToken}`);

  try {
    return await fetch(new Request(request, { headers }));
  } catch {
    return fetch(request);
  }
}

worker.addEventListener('install', (event) => {
  event.waitUntil(worker.skipWaiting());
});

worker.addEventListener('activate', (event) => {
  event.waitUntil(worker.clients.claim());
});

worker.addEventListener('message', (event) => {
  if (event.data?.type === 'statly:claim-auth-clients') {
    event.waitUntil(worker.clients.claim());
  }
});

worker.addEventListener('fetch', (event) => {
  if (!isAuthServiceWorkerRequestEligible(event.request, worker.location.origin)) {
    return;
  }

  event.respondWith(fetchWithCurrentIdentity(event.request));
});
