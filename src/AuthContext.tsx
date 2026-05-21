'use client';

import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useState, useEffect, useMemo } from 'react';

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

import { getBypassUserDetails, isAuthBypassEnabled } from '@/lib/authBypass';
import { getClientAuth } from '@/lib/firebaseClient';

import type { Auth, User, UserCredential } from 'firebase/auth';

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
  const firebaseAuth = useMemo<Auth | null>(() => {
    if (bypassAuth) return null;
    if (typeof window === 'undefined') return null;
    try {
      return getClientAuth();
    } catch (error) {
      if (process.env.NODE_ENV !== 'production') {
        console.error('Firebase Auth initialization failed:', error);
      }
      return null;
    }
  }, [bypassAuth]);

  // Create/clear server session cookie via API
  const createServerSession = useCallback(
    async (sessionUser?: Pick<User, 'getIdToken'> | null) => {
      if (bypassAuth) return;
      const activeUser = sessionUser ?? firebaseAuth?.currentUser;
      if (!activeUser) return;

      const idToken = await activeUser.getIdToken();
      const response = await fetch('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      });

      if (!response.ok) {
        let responseBody = '';
        try {
          responseBody = await response.text();
        } catch {
          // Ignore body parsing failures; the status is enough for callers.
        }

        const details = [response.status, response.statusText, responseBody]
          .filter(Boolean)
          .join(' ');
        throw new Error(`Failed to create server session${details ? `: ${details}` : ''}`);
      }
    },
    [bypassAuth, firebaseAuth]
  );

  useEffect(() => {
    if (bypassAuth && fakeUser) {
      setUser(fakeUser);
      setLoading(false);
      return;
    }
    // Skip Firebase auth if not available
    if (!firebaseAuth) {
      setLoading(false);
      return;
    }

    // Set a timeout to prevent infinite loading if onAuthStateChanged never fires
    const timeoutId = setTimeout(() => {
      setLoading(false);
    }, 5000); // 5 second timeout

    const unsubscribe = onAuthStateChanged(
      firebaseAuth,
      (user) => {
        clearTimeout(timeoutId);
        if (!user) {
          setUser(null);
          setLoading(false);
          return;
        }

        void createServerSession(user)
          .catch((error) => {
            console.error('Failed to refresh server session:', error);
          })
          .finally(() => {
            setUser(user);
            setLoading(false);
          });
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
  }, [bypassAuth, createServerSession, fakeUser, firebaseAuth]);

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
      if (!firebaseAuth) throw new Error('Firebase Auth not available');
      const cred = await signInWithEmailAndPassword(firebaseAuth, email, pass);
      await createServerSession(cred.user);
      setUser(cred.user);
      return cred;
    },
    signup: async (email: string, pass: string) => {
      if (bypassAuth && fakeUser) {
        setUser(fakeUser);
        return { user: fakeUser } as UserCredential;
      }
      if (!firebaseAuth) throw new Error('Firebase Auth not available');
      const cred = await createUserWithEmailAndPassword(firebaseAuth, email, pass);
      await createServerSession(cred.user);
      setUser(cred.user);
      return cred;
    },
    loginWithGoogle: async () => {
      if (bypassAuth && fakeUser) {
        setUser(fakeUser);
        return;
      }
      if (!firebaseAuth) throw new Error('Firebase Auth not available');
      const provider = new GoogleAuthProvider();
      const cred = await signInWithPopup(firebaseAuth, provider);
      await createServerSession(cred.user);
      setUser(cred.user);
    },
    loginWithFacebook: async () => {
      if (bypassAuth && fakeUser) {
        setUser(fakeUser);
        return;
      }
      if (!firebaseAuth) throw new Error('Firebase Auth not available');
      const provider = new FacebookAuthProvider();
      const cred = await signInWithPopup(firebaseAuth, provider);
      await createServerSession(cred.user);
      setUser(cred.user);
    },
    loginWithApple: async () => {
      if (bypassAuth && fakeUser) {
        setUser(fakeUser);
        return;
      }
      if (!firebaseAuth) throw new Error('Firebase Auth not available');
      const provider = new OAuthProvider('apple.com');
      provider.addScope('email');
      provider.addScope('name');
      const cred = await signInWithPopup(firebaseAuth, provider);
      await createServerSession(cred.user);
      setUser(cred.user);
    },
    logout: async () => {
      if (bypassAuth && fakeUser) {
        setUser(fakeUser);
        return Promise.resolve();
      }
      if (!firebaseAuth) throw new Error('Firebase Auth not available');
      await clearServerSession();
      await signOut(firebaseAuth);
      setUser(null);
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
