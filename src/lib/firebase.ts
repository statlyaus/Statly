import { initializeApp, getApps, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

let app;
if (!getApps().length) {
  app = initializeApp({
    credential: applicationDefault(),
  });
} else {
  app = getApps()[0];
}

export const db = getFirestore(app);
