import React, { useState, useEffect, useRef } from 'react';
import { collection, query, orderBy, limit, onSnapshot, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebaseClient';
import { useAuth } from '@/hooks/useAuth';
import { useLeagueMembership } from '@/hooks/useLeagueMembership';

// ...

useEffect(() => {
  if (!leagueId) return;

  const q = query(collection(db, "someCollection"), orderBy("someField"), limit(200));

  const unsubscribe = onSnapshot(q, (_snapshot) => {
    // handle snapshot
  }, (error) => {
    console.error("Error fetching data: ", error);
  });

  return () => unsubscribe();
}, [db, leagueId]); // Include db in the dependency list
