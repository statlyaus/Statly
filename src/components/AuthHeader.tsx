'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/AuthContext';
import { 
  UserIcon, 
  ChevronDownIcon,
  ArrowRightOnRectangleIcon,
  UserCircleIcon,
  CogIcon,
  ShieldCheckIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon
} from '@heroicons/react/24/outline';

interface NotificationState {
  show: boolean;
  type: 'success' | 'error' | 'info';
  message: string;
}

export default function AuthHeader() {
  const { user, loginWithGoogle, logout, loading } = useAuth();
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [notification, setNotification] = useState<NotificationState>({
    show: false,
    type: 'info',
    message: ''
  });

  const showNotification = (type: NotificationState['type'], message: string) => {
    setNotification({ show: true, type, message });
    setTimeout(() => {
      setNotification(prev => ({ ...prev, show: false }));
    }, 3000);
  };

  const handleLogin = async () => {
    setIsLoggingIn(true);
    try {
      await loginWithGoogle();
      showNotification('success', 'Successfully signed in with Google');
    } catch (error) {
      console.error('Login error:', error);
      showNotification('error', 'Failed to sign in. Please try again.');
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
      .map(word => word.charAt(0))
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
      {/* Notification Toast */}
      <AnimatePresence>
        {notification.show && (
          <motion.div
            initial={{ opacity: 0, y: -50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -50, scale: 0.9 }}
            className="fixed top-4 right-4 z-50"
          >
            <div className={`alert ${
              notification.type === 'success' ? 'alert-success' :
              notification.type === 'error' ? 'alert-error' : 'alert-info'
            } shadow-lg max-w-sm`}>
              <div className="flex items-center gap-2">
                {notification.type === 'success' && <CheckCircleIcon className="w-5 h-5" />}
                {notification.type === 'error' && <ExclamationTriangleIcon className="w-5 h-5" />}
                {notification.type === 'info' && <ShieldCheckIcon className="w-5 h-5" />}
                <span className="text-sm font-medium">{notification.message}</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

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
                <div className="w-10 h-10 rounded-full bg-primary text-primary-content 
                                flex items-center justify-center font-semibold text-sm
                                ring-2 ring-primary ring-offset-2">
                  {user.displayName ? getUserInitials(user.displayName) : <UserIcon className="w-5 h-5" />}
                </div>
              )}
            </div>

            {/* User Info */}
            <div className="flex-1 text-left min-w-0">
              <p className="font-semibold text-base-content truncate">
                {user.displayName || 'Anonymous User'}
              </p>
              <p className="text-sm text-base-content/70 truncate">
                {user.email}
              </p>
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
                      <div className="w-12 h-12 rounded-full bg-primary text-primary-content 
                                      flex items-center justify-center font-semibold">
                        {user.displayName ? getUserInitials(user.displayName) : <UserIcon className="w-6 h-6" />}
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
                      <span className={`flex items-center gap-1 ${user.emailVerified ? 'text-success' : 'text-warning'}`}>
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
                        {user.metadata.creationTime ? 
                          new Date(user.metadata.creationTime).toLocaleDateString() : 
                          'Unknown'
                        }
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
        /* Sign In Button */
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={handleLogin}
          disabled={isLoggingIn}
          className="btn btn-primary btn-sm gap-2 font-medium shadow-md
                     disabled:opacity-50 disabled:cursor-not-allowed
                     hover:shadow-lg transition-all duration-200"
          aria-label="Sign in with Google"
        >
          {isLoggingIn ? (
            <>
              <div className="loading loading-spinner loading-sm"></div>
              <span>Signing in...</span>
            </>
          ) : (
            <>
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              <span>Sign in with Google</span>
            </>
          )}
        </motion.button>
      )}
    </div>
  );
}
