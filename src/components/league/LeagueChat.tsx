import { collection, query, orderBy, limit, onSnapshot, DocumentData } from 'firebase/firestore';

// ...

useEffect(() => {
  if (!leagueId) return;

  const q = query(collection(db, "someCollection"), orderBy("someField"), limit(200));

  const unsubscribe = onSnapshot(q, (snapshot) => {
    // handle snapshot
  }, (error) => {
    console.error("Error fetching data: ", error);
  });

  return () => unsubscribe();
}, [db, leagueId]); // Include db in the dependency list
