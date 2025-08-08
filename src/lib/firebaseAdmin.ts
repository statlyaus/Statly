import { cert, getApps, initializeApp, getApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

if (!serviceAccountJson) {
  throw new Error(
    'FIREBASE_SERVICE_ACCOUNT_JSON is not set. This is required for server-side Firebase operations. Please add it to your .env.local file and restart the server.'
  );
}

type ServiceAccount = {
  private_key?: string;
  project_id?: string;
  client_email?: string;
  [key: string]: unknown;
};

const serviceAccount: ServiceAccount = JSON.parse(serviceAccountJson);

console.log(
  `[Firebase Admin] Initializing with project_id: "${serviceAccount.project_id}" and client_email: "${serviceAccount.client_email}"`
);

// The private key needs its newline characters to be correctly formatted.
if (serviceAccount.private_key) {
  serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
}

const app =
  getApps().length === 0
    ? initializeApp({ credential: cert(serviceAccount) })
    : getApp();

const adminDb = getFirestore(app);

export { adminDb };