import { adminDb as db } from '../src/lib/firebaseAdmin';

async function main() {
  const ref = db.collection('smoke_tests').doc('hello');
  await ref.set(
    { at: new Date().toISOString(), from: process.env.VERCEL ? 'vercel' : 'local' },
    { merge: true }
  );
  const snap = await ref.get();
  console.log('[SMOKE]', { id: snap.id, data: snap.data() });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
