'use client';

import type { ReactNode } from 'react';
import { createContext, useContext, useState, useEffect, useMemo } from 'react';

import {
  onAuthStateChanged,
  GoogleAuthProvider,
  FacebookAuthProvider,
  OAuthProvider,
  signInWithPopup,
  signOut,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
} from 'firebase/auth';

import LoadingSpinner from '@/components/LoadingSpinner';
import { getBypassUserDetails, isAuthBypassEnabled } from '@/lib/authBypass';
import { auth } from '@/lib/firebaseClient';

import type { User, UserCredential } from 'firebase/auth';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, pass: string) => Promise<UserCredential>;
  signup: (email: string, pass: string) => Promise<UserCredential>;
  loginWithGoogle: () => Promise<void>;
  loginWithFacebook: () => Promise<void>;
  loginWithApple: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }): ReactNode {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const bypassAuth = isAuthBypassEnabled();
  const fakeUser = useMemo(
    () =>
      bypassAuth
        ? ({
            ...getBypassUserDetails(),
            emailVerified: true,
          } as User)
        : null,
    [bypassAuth]
  );

  useEffect(() => {
    if (bypassAuth && fakeUser) {
      setUser(fakeUser);
      setLoading(false);
      return;
    }
    // Skip Firebase auth if not available
    if (!auth) {
      setLoading(false);
      return;
    }

    // Set a timeout to prevent infinite loading if onAuthStateChanged never fires
    const timeoutId = setTimeout(() => {
      setLoading(false);
    }, 5000); // 5 second timeout

    const unsubscribe = onAuthStateChanged(
      auth,
      (user) => {
        clearTimeout(timeoutId);
        setUser(user);
        setLoading(false);
      },
      (error) => {
        clearTimeout(timeoutId);
        // Log error but don't block the app
        if (process.env.NODE_ENV !== 'production') {
          console.error('Auth state change error:', error);
        }
        setUser(null);
        setLoading(false);
      }
    );
    return () => {
      clearTimeout(timeoutId);
      unsubscribe();
    };
  }, [bypassAuth, fakeUser]);

  // Create/clear server session cookie via API
  const createServerSession = async () => {
    if (bypassAuth) return;
    if (!auth || !auth.currentUser) return;
    try {
      const idToken = await auth.currentUser.getIdToken();
      await fetch('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      });
    } catch (error) {
      // Non-fatal: client remains signed in, but server-side protection may redirect
      console.error('Failed to create server session:', error);
    }
  };

  const clearServerSession = async () => {
    if (bypassAuth) return;
    try {
      const response = await fetch('/api/auth/session', { method: 'DELETE' });
      if (!response.ok) {
        console.warn(`Failed to clear server session: ${response.status} ${response.statusText}`);
        try {
          const errorData = await response.text();
          if (errorData) {
            console.warn('Server response:', errorData);
          }
        } catch {
          // Ignore errors reading response body
        }
      }
    } catch (error) {
      // Non-fatal - network errors
      console.warn('Failed to clear server session:', error);
    }
  };

  const value = {
    user,
    loading,
    login: async (email: string, pass: string) => {
      if (bypassAuth && fakeUser) {
        setUser(fakeUser);
        return { user: fakeUser } as UserCredential;
      }
      if (!auth) throw new Error('Firebase Auth not available');
      const cred = await signInWithEmailAndPassword(auth, email, pass);
      await createServerSession();
      return cred;
    },
    signup: async (email: string, pass: string) => {
      if (bypassAuth && fakeUser) {
        setUser(fakeUser);
        return { user: fakeUser } as UserCredential;
      }
      if (!auth) throw new Error('Firebase Auth not available');
      const cred = await createUserWithEmailAndPassword(auth, email, pass);
      await createServerSession();
      return cred;
    },
    loginWithGoogle: async () => {
      if (bypassAuth && fakeUser) {
        setUser(fakeUser);
        return;
      }
      if (!auth) throw new Error('Firebase Auth not available');
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
      await createServerSession();
    },
    loginWithFacebook: async () => {
      if (bypassAuth && fakeUser) {
        setUser(fakeUser);
        return;
      }
      if (!auth) throw new Error('Firebase Auth not available');
      const provider = new FacebookAuthProvider();
      await signInWithPopup(auth, provider);
      await createServerSession();
    },
    loginWithApple: async () => {
      if (bypassAuth && fakeUser) {
        setUser(fakeUser);
        return;
      }
      if (!auth) throw new Error('Firebase Auth not available');
      const provider = new OAuthProvider('apple.com');
      provider.addScope('email');
      provider.addScope('name');
      await signInWithPopup(auth, provider);
      await createServerSession();
    },
    logout: async () => {
      if (bypassAuth && fakeUser) {
        setUser(fakeUser);
        return Promise.resolve();
      }
      if (!auth) throw new Error('Firebase Auth not available');
      await clearServerSession();
      return signOut(auth);
    },
  };

  return (
    <AuthContext.Provider value={value}>
      {loading ? (
        <div className="flex h-screen w-full items-center justify-center">
          <LoadingSpinner />
        </div>
      ) : (
        children
      )}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
