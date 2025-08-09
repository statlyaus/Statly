'use client';

import type { ReactNode } from 'react';
import { createContext, useContext, useState, useEffect } from 'react';
import type {
  User} from 'firebase/auth';
import {
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  createUserWithEmailAndPassword,
  type UserCredential,
  signInWithEmailAndPassword,
} from 'firebase/auth';
import { auth } from '@/lib/firebaseClient';
import LoadingSpinner from '@/components/LoadingSpinner';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, pass: string) => Promise<UserCredential>;
  signup: (email: string, pass: string) => Promise<UserCredential>;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const value = {
    user,
    loading,
    login: (email: string, pass: string) => signInWithEmailAndPassword(auth, email, pass),
    signup: (email: string, pass:string) => createUserWithEmailAndPassword(auth, email, pass),
    loginWithGoogle: async () => {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    },
    logout: () => signOut(auth),
  };

  return <AuthContext.Provider value={value}>{loading ? <div className="flex h-screen w-full items-center justify-center"><LoadingSpinner /></div> : children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}