// src/firebase.ts
import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: "AIzaSyDCu0sqW0QkqK5FGu5wbmCEPKOLzZga89s",
  authDomain: "statly-4cbed.firebaseapp.com",
  projectId: "statly-4cbed",
  storageBucket: "statly-4cbed.appspot.com",
  messagingSenderId: "357171402575",
  appId: "1:357171402575:web:ac36ddc35e54adcf3f573a",
  measurementId: "G-6VXMJ85NBS"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);