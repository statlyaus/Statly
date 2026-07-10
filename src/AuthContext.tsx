'use client';

import type { ReactNode } from 'react';
import { createContext, useContext, useState, useEffect } from 'react';
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
import type { User, UserCredential } from 'firebase/auth';
import { auth, authEmulatorReady } from '@/lib/firebaseClient';
import LoadingSpinner from '@/components/LoadingSpinner';
import {
  clearDevelopmentAuthUser,
  createDevelopmentAuthUser,
  isDevelopmentAuthEnabled,
  isDevelopmentLogin,
  persistDevelopmentAuthUser,
  readStoredDevelopmentAuthUser,
} from '@/lib/devAuth';

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

function toFirebaseDevelopmentUser(): User {
  const developmentUser = createDevelopmentAuthUser();

  return {
    uid: developmentUser.uid,
    email: developmentUser.email,
    displayName: developmentUser.displayName,
    emailVerified: true,
    isAnonymous: false,
    phoneNumber: null,
    photoURL: null,
    providerId: 'development',
    providerData: [],
    refreshToken: '',
    tenantId: null,
    delete: async () => undefined,
    getIdToken: async () => `dev:${developmentUser.uid}`,
    getIdTokenResult: async () =>
      ({
        token: `dev:${developmentUser.uid}`,
        signInProvider: 'development',
        claims: {},
      }) as Awaited<ReturnType<User['getIdTokenResult']>>,
    reload: async () => undefined,
    toJSON: () => developmentUser,
  } as unknown as User;
}

function toDevelopmentCredential(user: User): UserCredential {
  return {
    user,
    providerId: 'development',
    operationType: 'signIn',
  } as unknown as UserCredential;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Skip Firebase auth if not available
    if (!auth) {
      if (isDevelopmentAuthEnabled() && readStoredDevelopmentAuthUser()) {
        setUser(toFirebaseDevelopmentUser());
      }
      setLoading(false);
      return;
    }

    const currentAuth = auth;
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    void authEmulatorReady.finally(() => {
      if (cancelled) return;
      unsubscribe = onAuthStateChanged(currentAuth, (user) => {
        setUser(user);
        setLoading(false);
      });
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  // Create/clear server session cookie via API
  const createServerSession = async () => {
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
      if (!auth) {
        if (isDevelopmentLogin(email, pass)) {
          const developmentUser = toFirebaseDevelopmentUser();
          persistDevelopmentAuthUser();
          setUser(developmentUser);
          return toDevelopmentCredential(developmentUser);
        }
        throw new Error('Use the documented local development credentials.');
      }
      await authEmulatorReady;
      const cred = await signInWithEmailAndPassword(auth, email, pass);
      await createServerSession();
      return cred;
    },
    signup: async (email: string, pass: string) => {
      if (!auth) throw new Error('Firebase Auth not available');
      await authEmulatorReady;
      const cred = await createUserWithEmailAndPassword(auth, email, pass);
      await createServerSession();
      return cred;
    },
    loginWithGoogle: async () => {
      if (!auth) throw new Error('Firebase Auth not available');
      await authEmulatorReady;
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
      await createServerSession();
    },
    loginWithFacebook: async () => {
      if (!auth) throw new Error('Firebase Auth not available');
      await authEmulatorReady;
      const provider = new FacebookAuthProvider();
      await signInWithPopup(auth, provider);
      await createServerSession();
    },
    loginWithApple: async () => {
      if (!auth) throw new Error('Firebase Auth not available');
      await authEmulatorReady;
      const provider = new OAuthProvider('apple.com');
      provider.addScope('email');
      provider.addScope('name');
      await signInWithPopup(auth, provider);
      await createServerSession();
    },
    logout: async () => {
      if (!auth && isDevelopmentAuthEnabled()) {
        clearDevelopmentAuthUser();
        setUser(null);
        return;
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

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
