'use client';

import { useState } from 'react';

import Link from 'next/link';

import {
  UserIcon,
  ChevronDownIcon,
  ArrowRightOnRectangleIcon,
  UserCircleIcon,
  CogIcon,
  ShieldCheckIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  EnvelopeIcon,
} from '@heroicons/react/24/outline';
import { motion, AnimatePresence } from 'framer-motion';

import { useAuth } from '@/AuthContext';
import { useNotification, NotificationToast } from '@/hooks/useNotification';

export default function AuthHeader() {
  const { user, loginWithGoogle, loginWithFacebook, loginWithApple, logout, loading } = useAuth();
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isSignInDropdownOpen, setIsSignInDropdownOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const { notification, showNotification } = useNotification();

  const handleLogin = async (provider: 'google' | 'facebook' | 'apple') => {
    setIsLoggingIn(true);
    setIsSignInDropdownOpen(false);
    try {
      switch (provider) {
        case 'google':
          await loginWithGoogle();
          showNotification('success', 'Successfully signed in with Google');
          break;
        case 'facebook':
          await loginWithFacebook();
          showNotification('success', 'Successfully signed in with Facebook');
          break;
        case 'apple':
          await loginWithApple();
          showNotification('success', 'Successfully signed in with Apple');
          break;
      }
    } catch (error) {
      console.error('Login error:', error);
      const providerName = provider.charAt(0).toUpperCase() + provider.slice(1);
      showNotification('error', `Failed to sign in with ${providerName}. Please try again.`);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      await logout();
      setIsDropdownOpen(false);
      showNotification('success', 'Successfully signed out');
    } catch (error) {
      console.error('Logout error:', error);
      showNotification('error', 'Failed to sign out. Please try again.');
    } finally {
      setIsLoggingOut(false);
    }
  };

  const getUserInitials = (name: string) => {
    return name
      .split(' ')
      .map((word) => word.charAt(0))
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const formatLastSignIn = (timestamp: string | null | undefined) => {
    if (!timestamp) return 'Never';
    const date = new Date(timestamp);
    const now = new Date();
    const diffInHours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60));

    if (diffInHours < 1) return 'Just now';
    if (diffInHours < 24) return `${diffInHours}h ago`;
    if (diffInHours < 168) return `${Math.floor(diffInHours / 24)}d ago`;
    return date.toLocaleDateString();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center">
        <div className="loading loading-spinner loading-sm text-primary"></div>
      </div>
    );
  }

  return (
    <div className="relative">
      <NotificationToast notification={notification} />

      {user ? (
        <div className="relative">
          {/* User Profile Button */}
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            className="flex items-center gap-3 p-3 rounded-xl bg-base-200 hover:bg-base-300 
                       transition-all duration-200 border border-base-300 shadow-sm
                       focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
            aria-label="User menu"
            aria-expanded={isDropdownOpen}
            aria-haspopup="menu"
          >
            {/* Avatar */}
            <div className="flex-shrink-0">
              {user.photoURL ? (
                <img
                  src={user.photoURL}
                  alt={user.displayName || 'User avatar'}
                  className="w-10 h-10 rounded-full object-cover ring-2 ring-primary ring-offset-2"
                />
              ) : (
                <div
                  className="w-10 h-10 rounded-full bg-primary text-primary-content 
                                flex items-center justify-center font-semibold text-sm
                                ring-2 ring-primary ring-offset-2"
                >
                  {user.displayName ? (
                    getUserInitials(user.displayName)
                  ) : (
                    <UserIcon className="w-5 h-5" />
                  )}
                </div>
              )}
            </div>

            {/* User Info */}
            <div className="flex-1 text-left min-w-0">
              <p className="font-semibold text-base-content truncate">
                {user.displayName || 'Anonymous User'}
              </p>
              <p className="text-sm text-base-content/70 truncate">{user.email}</p>
            </div>

            {/* Dropdown Arrow */}
            <motion.div
              animate={{ rotate: isDropdownOpen ? 180 : 0 }}
              transition={{ duration: 0.2 }}
            >
              <ChevronDownIcon className="w-5 h-5 text-base-content/50" />
            </motion.div>
          </motion.button>

          {/* Dropdown Menu */}
          <AnimatePresence>
            {isDropdownOpen && (
              <motion.div
                initial={{ opacity: 0, y: -10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.95 }}
                transition={{ duration: 0.15 }}
                className="absolute right-0 mt-2 w-80 bg-base-100 rounded-xl shadow-xl 
                           border border-base-300 z-50 overflow-hidden"
                role="menu"
                aria-labelledby="user-menu-button"
              >
                {/* User Info Header */}
                <div className="p-4 bg-gradient-to-r from-primary/10 to-secondary/10 border-b border-base-300">
                  <div className="flex items-center gap-3">
                    {user.photoURL ? (
                      <img
                        src={user.photoURL}
                        alt={user.displayName || 'User avatar'}
                        className="w-12 h-12 rounded-full object-cover"
                      />
                    ) : (
                      <div
                        className="w-12 h-12 rounded-full bg-primary text-primary-content 
                                      flex items-center justify-center font-semibold"
                      >
                        {user.displayName ? (
                          getUserInitials(user.displayName)
                        ) : (
                          <UserIcon className="w-6 h-6" />
                        )}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-base-content">
                        {user.displayName || 'Anonymous User'}
                      </h3>
                      <p className="text-sm text-base-content/70 truncate">{user.email}</p>
                    </div>
                  </div>
                </div>

                {/* Account Details */}
                <div className="p-4 border-b border-base-300">
                  <h4 className="font-medium text-base-content mb-3 flex items-center gap-2">
                    <ShieldCheckIcon className="w-4 h-4" />
                    Account Details
                  </h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-base-content/70">User ID:</span>
                      <span className="font-mono text-xs bg-base-200 px-2 py-1 rounded">
                        {user.uid.slice(0, 8)}...
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-base-content/70">Email Verified:</span>
                      <span
                        className={`flex items-center gap-1 ${user.emailVerified ? 'text-success' : 'text-warning'}`}
                      >
                        {user.emailVerified ? (
                          <>
                            <CheckCircleIcon className="w-4 h-4" />
                            Verified
                          </>
                        ) : (
                          <>
                            <ExclamationTriangleIcon className="w-4 h-4" />
                            Unverified
                          </>
                        )}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-base-content/70">Last Sign In:</span>
                      <span className="text-base-content">
                        {formatLastSignIn(user.metadata.lastSignInTime)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-base-content/70">Member Since:</span>
                      <span className="text-base-content">
                        {user.metadata.creationTime
                          ? new Date(user.metadata.creationTime).toLocaleDateString()
                          : 'Unknown'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Menu Items */}
                <div className="p-2">
                  <button
                    className="w-full flex items-center gap-3 p-3 text-left hover:bg-base-200 
                               rounded-lg transition-colors duration-200 disabled:opacity-50"
                    disabled
                    aria-label="View profile (coming soon)"
                  >
                    <UserCircleIcon className="w-5 h-5 text-base-content/70" />
                    <span className="text-base-content">View Profile</span>
                    <span className="ml-auto text-xs text-base-content/50 bg-base-200 px-2 py-1 rounded">
                      Soon
                    </span>
                  </button>

                  <button
                    className="w-full flex items-center gap-3 p-3 text-left hover:bg-base-200 
                               rounded-lg transition-colors duration-200 disabled:opacity-50"
                    disabled
                    aria-label="Account settings (coming soon)"
                  >
                    <CogIcon className="w-5 h-5 text-base-content/70" />
                    <span className="text-base-content">Settings</span>
                    <span className="ml-auto text-xs text-base-content/50 bg-base-200 px-2 py-1 rounded">
                      Soon
                    </span>
                  </button>

                  <hr className="my-2 border-base-300" />

                  <button
                    onClick={handleLogout}
                    disabled={isLoggingOut}
                    className="w-full flex items-center gap-3 p-3 text-left hover:bg-error/10 
                               hover:text-error rounded-lg transition-colors duration-200
                               disabled:opacity-50 disabled:cursor-not-allowed"
                    aria-label="Sign out"
                  >
                    {isLoggingOut ? (
                      <div className="loading loading-spinner loading-sm"></div>
                    ) : (
                      <ArrowRightOnRectangleIcon className="w-5 h-5" />
                    )}
                    <span>{isLoggingOut ? 'Signing out...' : 'Sign Out'}</span>
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Overlay to close dropdown */}
          {isDropdownOpen && (
            <div
              className="fixed inset-0 z-40"
              onClick={() => setIsDropdownOpen(false)}
              aria-hidden="true"
            />
          )}
        </div>
      ) : (
        /* Sign In Dropdown */
        <div className="relative">
          <motion.button
            id="signin-menu-button"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setIsSignInDropdownOpen(!isSignInDropdownOpen)}
            disabled={isLoggingIn}
            type="button"
            className="btn btn-primary btn-sm gap-2 font-medium shadow-md
                       disabled:opacity-50 disabled:cursor-not-allowed
                       hover:shadow-lg transition-all duration-200"
            aria-label="Sign in options"
            aria-expanded={isSignInDropdownOpen}
            aria-haspopup="menu"
            aria-controls="signin-menu"
          >
            {isLoggingIn ? (
              <>
                <div className="loading loading-spinner loading-sm"></div>
                <span>Signing in...</span>
              </>
            ) : (
              <>
                <ArrowRightOnRectangleIcon className="w-4 h-4" />
                <span>Sign in</span>
                <ChevronDownIcon className="w-3 h-3" />
              </>
            )}
          </motion.button>

          {/* Sign In Options Dropdown */}
          <AnimatePresence>
            {isSignInDropdownOpen && (
              <motion.div
                initial={{ opacity: 0, y: -10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.95 }}
                transition={{ duration: 0.15 }}
                id="signin-menu"
                className="absolute right-0 mt-2 w-64 bg-base-100 rounded-xl shadow-xl 
                           border border-base-300 z-50 overflow-hidden"
                role="menu"
                aria-labelledby="signin-menu-button"
              >
                <div className="p-2 space-y-1">
                  <button
                    onClick={() => handleLogin('google')}
                    disabled={isLoggingIn}
                    className="w-full flex items-center gap-3 p-3 text-left hover:bg-base-200 
                               rounded-lg transition-colors duration-200 disabled:opacity-50"
                    aria-label="Sign in with Google"
                  >
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                      <path
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                        fill="#4285F4"
                      />
                      <path
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                        fill="#34A853"
                      />
                      <path
                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                        fill="#FBBC05"
                      />
                      <path
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                        fill="#EA4335"
                      />
                    </svg>
                    <span className="text-base-content">Continue with Google</span>
                  </button>

                  <button
                    onClick={() => handleLogin('facebook')}
                    disabled={isLoggingIn}
                    className="w-full flex items-center gap-3 p-3 text-left hover:bg-base-200 
                               rounded-lg transition-colors duration-200 disabled:opacity-50"
                    aria-label="Sign in with Facebook"
                  >
                    <svg
                      className="w-5 h-5"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <path d="M22.675 0h-21.35C.596 0 0 .593 0 1.326v21.348C0 23.406.596 24 1.325 24h11.495v-9.294H9.69V11.01h3.13V8.414c0-3.1 1.893-4.788 4.659-4.788 1.325 0 2.463.098 2.795.142v3.24l-1.918.001c-1.504 0-1.796.715-1.796 1.764v2.314h3.588l-.467 3.696h-3.12V24h6.116C23.404 24 24 23.406 24 22.674V1.326C24 .593 23.404 0 22.675 0z" />
                    </svg>
                    <span className="text-base-content">Continue with Facebook</span>
                  </button>

                  <button
                    onClick={() => handleLogin('apple')}
                    disabled={isLoggingIn}
                    className="w-full flex items-center gap-3 p-3 text-left hover:bg-base-200 
                               rounded-lg transition-colors duration-200 disabled:opacity-50"
                    aria-label="Sign in with Apple"
                  >
                    <svg
                      className="w-5 h-5"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <path d="M16.365 1.43c0 1.14-.42 2.09-1.25 2.88-.9.87-1.9 1.38-3 1.3-.1-1.05.43-2.06 1.25-2.86.88-.86 2.2-1.49 3-1.32zM20.7 17.4c-.56 1.29-.85 1.86-1.6 3-.95 1.46-2.29 3.28-3.94 3.3-1.47.02-1.85-.95-3.84-.95-1.99 0-2.41.92-3.88.97-1.65.06-2.91-1.58-3.86-3.03C2.03 19.2.6 15.17 2.4 12.09c1.06-1.84 2.95-3 5-3.03 1.57-.03 3.06 1.06 3.84 1.06.78 0 2.66-1.31 4.5-1.12.77.03 2.95.31 4.35 2.34-3.84 2.1-3.22 7.62.6 6.06z" />
                    </svg>
                    <span className="text-base-content">Continue with Apple</span>
                  </button>

                  <hr className="my-2 border-base-300" />

                  <Link
                    href="/login"
                    className="w-full flex items-center gap-3 p-3 text-left hover:bg-base-200 
                               rounded-lg transition-colors duration-200"
                    aria-label="Go to sign in page"
                  >
                    <EnvelopeIcon className="w-5 h-5 text-base-content/70" />
                    <span className="text-base-content">Sign in with Email</span>
                  </Link>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Overlay to close sign-in dropdown */}
          {isSignInDropdownOpen && (
            <div
              className="fixed inset-0 z-40"
              onClick={() => setIsSignInDropdownOpen(false)}
              aria-hidden="true"
            />
          )}
        </div>
      )}
    </div>
  );
}
