'use client';

import type { ReactNode } from 'react';
import { createContext, useContext, useState, useEffect } from 'react';
import type { User as FirebaseUser } from 'firebase/auth';
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

async function createServerSessionForUser(user: FirebaseUser): Promise<void> {
  const idToken = await user.getIdToken();
  const response = await fetch('/api/auth/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });

  if (!response.ok) {
    throw new Error(`Server session creation failed with status ${response.status}`);
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
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

        void createServerSessionForUser(firebaseUser)
          .then(() => {
            if (!cancelled && version === authStateVersion) {
              setUser(firebaseUser);
            }
          })
          .catch((error) => {
            if (!cancelled && version === authStateVersion) {
              setUser(null);
              console.error('Failed to restore server session:', error);
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

  // Create/clear server session cookie via API
  const createServerSession = async () => {
    if (!auth || !auth.currentUser) return;
    try {
      await createServerSessionForUser(auth.currentUser);
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
          persistDevelopmentAuthUser();
          setUser(toDevelopmentAuthUser());
          return;
        }
        throw new Error('Use the documented local development credentials.');
      }
      await authEmulatorReady;
      await signInWithEmailAndPassword(auth, email, pass);
      await createServerSession();
    },
    signup: async (email: string, pass: string) => {
      if (!auth) throw new Error('Firebase Auth not available');
      await authEmulatorReady;
      await createUserWithEmailAndPassword(auth, email, pass);
      await createServerSession();
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
