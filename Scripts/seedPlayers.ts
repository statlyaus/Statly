const { initializeApp } = require("firebase/app");
const { getFirestore, collection, doc, setDoc } = require("firebase/firestore");
const aflPlayers = require("./Data/aflPlayers").default;

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
const db = getFirestore(app);

async function seedPlayers() {
  const playersRef = collection(db, "players");
  for (const player of aflPlayers) {
    await setDoc(doc(playersRef, player.id.toString()), player);
  }
  console.log(`✅ Seeded ${aflPlayers.length} players to Firestore.`);
}

seedPlayers().catch(console.error);