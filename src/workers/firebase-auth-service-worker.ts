/// <reference lib="webworker" />

import { initializeApp, type FirebaseOptions } from 'firebase/app';
import { connectAuthEmulator, getAuth, getIdToken, onAuthStateChanged } from 'firebase/auth';

import { isAuthServiceWorkerRequestEligible } from '@/lib/authServiceWorker';

declare const __FIREBASE_CONFIG__: FirebaseOptions;
declare const __FIREBASE_AUTH_EMULATOR_URL__: string | null;

const worker = globalThis as unknown as ServiceWorkerGlobalScope;
const firebaseApp = initializeApp(__FIREBASE_CONFIG__);
const auth = getAuth(firebaseApp);

if (__FIREBASE_AUTH_EMULATOR_URL__) {
  connectAuthEmulator(auth, __FIREBASE_AUTH_EMULATOR_URL__, { disableWarnings: true });
}

function getCurrentIdToken(): Promise<string | null> {
  return new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(
      auth,
      (user) => {
        unsubscribe();

        if (!user) {
          resolve(null);
          return;
        }

        void getIdToken(user).then(resolve, () => resolve(null));
      },
      () => resolve(null)
    );
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
    return fetch(new Request(request, { headers }));
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
