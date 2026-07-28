'use client';

import type { ReactElement, ReactNode } from 'react';
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
import { auth, authEmulatorReady } from '@/lib/firebaseClient';
import { ensureAuthServiceWorkerReady } from '@/lib/authServiceWorker';
import LoadingSpinner from '@/components/LoadingSpinner';
import {
  clearDevelopmentAuthUser,
  createDevelopmentAuthUser,
  isDevelopmentAuthEnabled,
  isDevelopmentLogin,
  persistDevelopmentAuthUser,
  readStoredDevelopmentAuthUser,
} from '@/lib/devAuth';

export interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  emailVerified: boolean;
  metadata: {
    creationTime?: string;
    lastSignInTime?: string;
  };
}

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, pass: string) => Promise<void>;
  signup: (email: string, pass: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  loginWithFacebook: () => Promise<void>;
  loginWithApple: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function toDevelopmentAuthUser(): AuthUser {
  const developmentUser = createDevelopmentAuthUser();

  return {
    uid: developmentUser.uid,
    email: developmentUser.email,
    displayName: developmentUser.displayName,
    emailVerified: true,
    photoURL: null,
    metadata: {},
  };
}

export function AuthProvider({ children }: { children: ReactNode }): ReactElement {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Skip Firebase auth if not available
    if (!auth) {
      if (isDevelopmentAuthEnabled() && readStoredDevelopmentAuthUser()) {
        setUser(toDevelopmentAuthUser());
      }
      setLoading(false);
      return;
    }

    const currentAuth = auth;
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;
    let authStateVersion = 0;

    void authEmulatorReady.finally(() => {
      if (cancelled) return;
      unsubscribe = onAuthStateChanged(currentAuth, (firebaseUser) => {
        const version = ++authStateVersion;

        if (!firebaseUser) {
          setUser(null);
          setLoading(false);
          return;
        }

        void ensureAuthServiceWorkerReady()
          .then(() => {
            if (!cancelled && version === authStateVersion) {
              setUser(firebaseUser);
            }
          })
          .catch((error) => {
            if (!cancelled && version === authStateVersion) {
              setUser(null);
              console.error('Failed to prepare authenticated navigation:', error);
            }
          })
          .finally(() => {
            if (!cancelled && version === authStateVersion) {
              setLoading(false);
            }
          });
      });
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  // Remove cookies minted by the previous transport while its migration fallback remains readable.
  const clearLegacyServerSession = async () => {
    const response = await fetch('/api/auth/session', { method: 'DELETE' });
    if (!response.ok) {
      throw new Error(`Unable to clear the secure session (${response.status}).`);
    }
  };

  const value = {
    user,
    loading,
    login: async (email: string, pass: string) => {
      if (!auth) {
        if (isDevelopmentLogin(email, pass)) {
          persistDevelopmentAuthUser();
          setUser(toDevelopmentAuthUser());
          return;
        }
        throw new Error('Use the documented local development credentials.');
      }
      await authEmulatorReady;
      await signInWithEmailAndPassword(auth, email, pass);
      await ensureAuthServiceWorkerReady();
    },
    signup: async (email: string, pass: string) => {
      if (!auth) throw new Error('Firebase Auth not available');
      await authEmulatorReady;
      await createUserWithEmailAndPassword(auth, email, pass);
      await ensureAuthServiceWorkerReady();
    },
    loginWithGoogle: async () => {
      if (!auth) throw new Error('Firebase Auth not available');
      await authEmulatorReady;
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
      await ensureAuthServiceWorkerReady();
    },
    loginWithFacebook: async () => {
      if (!auth) throw new Error('Firebase Auth not available');
      await authEmulatorReady;
      const provider = new FacebookAuthProvider();
      await signInWithPopup(auth, provider);
      await ensureAuthServiceWorkerReady();
    },
    loginWithApple: async () => {
      if (!auth) throw new Error('Firebase Auth not available');
      await authEmulatorReady;
      const provider = new OAuthProvider('apple.com');
      provider.addScope('email');
      provider.addScope('name');
      await signInWithPopup(auth, provider);
      await ensureAuthServiceWorkerReady();
    },
    logout: async () => {
      if (!auth && isDevelopmentAuthEnabled()) {
        clearDevelopmentAuthUser();
        setUser(null);
        return;
      }
      if (!auth) throw new Error('Firebase Auth not available');
      await clearLegacyServerSession();
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
