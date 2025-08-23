'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/AuthContext';
import { useRouter } from 'next/navigation';
import {
  EyeIcon,
  EyeSlashIcon,
  UserIcon,
  EnvelopeIcon,
  LockClosedIcon,
  ArrowRightOnRectangleIcon,
  UserPlusIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  ShieldCheckIcon,
  SparklesIcon,
  ArrowPathIcon
} from '@heroicons/react/24/outline';

interface AuthFormProps {
  initialMode?: 'login' | 'signup';
  onSuccess?: () => void;
  className?: string;
  // Optional URL to redirect to after successful auth
  nextUrl?: string;
  // When true, redirect immediately if a user session already exists
  autoRedirectIfAuthenticated?: boolean;
}

interface FormValidation {
  email: {
    isValid: boolean;
    message: string;
  };
  password: {
    isValid: boolean;
    message: string;
  };
}

interface NotificationState {
  show: boolean;
  type: 'success' | 'error' | 'info';
  message: string;
}

const AuthForm = ({ initialMode = 'login', onSuccess, className = '', nextUrl, autoRedirectIfAuthenticated = false }: AuthFormProps) => {
  const { login, signup, user, logout, loginWithGoogle, loginWithFacebook, loading, loginWithApple } = useAuth();
  const router = useRouter();
  
  // Form state
  const [isSignup, setIsSignup] = useState(initialMode === 'signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  
  // UI state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validation, setValidation] = useState<FormValidation>({
    email: { isValid: true, message: '' },
    password: { isValid: true, message: '' }
  });
  const [notification, setNotification] = useState<NotificationState>({
    show: false,
    type: 'info',
    message: ''
  });

  // Form validation
  const validateEmail = (email: string) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email) {
      return { isValid: false, message: 'Email is required' };
    }
    if (!emailRegex.test(email)) {
      return { isValid: false, message: 'Please enter a valid email address' };
    }
    return { isValid: true, message: '' };
  };

  const validatePassword = (password: string, isSignup: boolean) => {
    if (!password) {
      return { isValid: false, message: 'Password is required' };
    }
    if (isSignup && password.length < 6) {
      return { isValid: false, message: 'Password must be at least 6 characters' };
    }
    if (isSignup && !/(?=.*[a-z])(?=.*[A-Z])/.test(password)) {
      return { isValid: false, message: 'Password must contain uppercase and lowercase letters' };
    }
    return { isValid: true, message: '' };
  };

  // Real-time validation
  useEffect(() => {
    const emailValidation = validateEmail(email);
    const passwordValidation = validatePassword(password, isSignup);
    
    setValidation({
      email: emailValidation,
      password: passwordValidation
    });
  }, [email, password, isSignup]);

  const showNotification = (type: NotificationState['type'], message: string) => {
    setNotification({ show: true, type, message });
    setTimeout(() => {
      setNotification(prev => ({ ...prev, show: false }));
    }, 5000);
  };

  const getPasswordStrength = (password: string) => {
    let strength = 0;
    if (password.length >= 6) strength += 25;
    if (password.length >= 10) strength += 25;
    if (/[A-Z]/.test(password)) strength += 25;
    if (/[a-z]/.test(password)) strength += 25;
    if (/[0-9]/.test(password)) strength += 25;
    if (/[^A-Za-z0-9]/.test(password)) strength += 25;
    return Math.min(100, strength);
  };

  const getPasswordStrengthLabel = (strength: number) => {
    if (strength < 25) return { label: 'Very Weak', color: 'text-error' };
    if (strength < 50) return { label: 'Weak', color: 'text-warning' };
    if (strength < 75) return { label: 'Good', color: 'text-info' };
    return { label: 'Strong', color: 'text-success' };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    // Validation
    const emailValidation = validateEmail(email);
    const passwordValidation = validatePassword(password, isSignup);

    if (!emailValidation.isValid || !passwordValidation.isValid) {
      setError('Please fix the validation errors above');
      setIsSubmitting(false);
      return;
    }

    if (isSignup && password !== confirmPassword) {
      setError('Passwords do not match');
      setIsSubmitting(false);
      return;
    }

    try {
      if (isSignup) {
        await signup(email, password);
        showNotification('success', 'Account created successfully! Welcome to Statly!');
      } else {
        await login(email, password);
        showNotification('success', 'Welcome back! You are now signed in.');
      }
      if (nextUrl) {
        // Prefer client-side navigation to preserve SPA context
        router.replace(nextUrl);
      } else {
        onSuccess?.();
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Authentication error occurred';
      setError(message);
      showNotification('error', message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError(null);
    setIsGoogleLoading(true);
    try {
      await loginWithGoogle();
      showNotification('success', 'Successfully signed in with Google!');
      if (nextUrl) {
        router.replace(nextUrl);
      } else {
        onSuccess?.();
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Google sign-in failed';
      setError(message);
      showNotification('error', message);
    } finally {
      setIsGoogleLoading(false);
    }
  };

  const handleFacebookSignIn = async () => {
    setError(null);
    setIsGoogleLoading(true);
    try {
      await loginWithFacebook();
      showNotification('success', 'Successfully signed in with Facebook!');
      if (nextUrl) {
        router.replace(nextUrl);
      } else {
        onSuccess?.();
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Facebook sign-in failed';
      setError(message);
      showNotification('error', message);
    } finally {
      setIsGoogleLoading(false);
    }
  };

  const handleAppleSignIn = async () => {
    setError(null);
    setIsGoogleLoading(true);
    try {
      await loginWithApple();
      showNotification('success', 'Successfully signed in with Apple!');
      if (nextUrl) {
        router.replace(nextUrl);
      } else {
        onSuccess?.();
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Apple sign-in failed';
      setError(message);
      showNotification('error', message);
    } finally {
      setIsGoogleLoading(false);
    }
  };

  // Optional: redirect immediately if already authenticated
  useEffect(() => {
    if (autoRedirectIfAuthenticated && user) {
      const destination = nextUrl || '/dashboard';
      router.replace(destination);
    }
  }, [autoRedirectIfAuthenticated, nextUrl, router, user]);

  const handleModeSwitch = () => {
    setIsSignup(!isSignup);
    setError(null);
    setPassword('');
    setConfirmPassword('');
    setValidation({
      email: { isValid: true, message: '' },
      password: { isValid: true, message: '' }
    });
  };

  const handleLogout = async () => {
    try {
      await logout();
      showNotification('success', 'Successfully signed out');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Sign out failed';
      showNotification('error', message);
    }
  };

  if (loading) {
    return (
      <div className={`flex items-center justify-center p-8 ${className}`}>
        <div className="text-center">
          <div className="loading loading-spinner loading-lg text-primary mb-4"></div>
          <p className="text-base-content/70">Loading authentication...</p>
        </div>
      </div>
    );
  }

  if (user) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className={`card bg-base-100 shadow-xl border border-base-300 ${className}`}
      >
        <div className="card-body">
          <div className="flex items-center gap-4 mb-6">
            <div className="avatar">
              <div className="w-16 h-16 rounded-full ring ring-primary ring-offset-base-100 ring-offset-2">
                {user.photoURL ? (
                  <img src={user.photoURL} alt="Profile" />
                ) : (
                  <div className="bg-primary text-primary-content flex items-center justify-center">
                    <UserIcon className="w-8 h-8" />
                  </div>
                )}
              </div>
            </div>
            <div className="flex-1">
              <h3 className="text-xl font-bold text-base-content">
                Welcome back!
              </h3>
              <p className="text-base-content/70">
                {user.displayName || user.email}
              </p>
              <div className="flex items-center gap-2 mt-1">
                <CheckCircleIcon className="w-4 h-4 text-success" />
                <span className="text-sm text-success">Authenticated</span>
              </div>
            </div>
          </div>

          <div className="stats stats-vertical lg:stats-horizontal shadow bg-base-200">
            <div className="stat">
              <div className="stat-figure text-primary">
                <ShieldCheckIcon className="w-8 h-8" />
              </div>
              <div className="stat-title">Status</div>
              <div className="stat-value text-primary text-lg">Active</div>
              <div className="stat-desc">Securely authenticated</div>
            </div>
            <div className="stat">
              <div className="stat-figure text-secondary">
                <EnvelopeIcon className="w-8 h-8" />
              </div>
              <div className="stat-title">Email</div>
              <div className="stat-value text-secondary text-lg">
                {user.emailVerified ? 'Verified' : 'Pending'}
              </div>
              <div className="stat-desc">
                {user.emailVerified ? 'Email confirmed' : 'Verification needed'}
              </div>
            </div>
          </div>

          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleLogout}
            className="btn btn-outline btn-error gap-2 mt-4"
          >
            <ArrowRightOnRectangleIcon className="w-5 h-5" />
            Sign Out
          </motion.button>
        </div>
      </motion.div>
    );
  }

  return (
    <>
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
                {notification.type === 'info' && <SparklesIcon className="w-5 h-5" />}
                <span className="text-sm font-medium">{notification.message}</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className={`card bg-base-100 shadow-xl border border-base-300 ${className}`}
      >
        <div className="card-body">
          {/* Header */}
          <div className="text-center mb-6">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.2, type: 'spring' }}
              className="inline-flex items-center justify-center w-16 h-16 bg-primary/10 text-primary rounded-2xl mb-4"
            >
              {isSignup ? (
                <UserPlusIcon className="w-8 h-8" />
              ) : (
                <LockClosedIcon className="w-8 h-8" />
              )}
            </motion.div>
            
            <h2 className="text-2xl font-bold text-base-content mb-2">
              {isSignup ? 'Create Account' : 'Welcome Back'}
            </h2>
            <p className="text-base-content/70">
              {isSignup 
                ? 'Join Statly to track your fantasy sports performance'
                : 'Sign in to access your fantasy sports dashboard'
              }
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Email Field */}
            <div className="form-control">
              <label htmlFor="email" className="label">
                <span className="label-text font-medium flex items-center gap-2">
                  <EnvelopeIcon className="w-4 h-4" />
                  Email Address
                </span>
              </label>
              <div className="relative">
                <input
                  id="email"
                  type="email"
                  placeholder="Enter your email"
                  className={`input input-bordered w-full pl-10 ${
                    !validation.email.isValid ? 'input-error' : 
                    email && validation.email.isValid ? 'input-success' : ''
                  }`}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  aria-describedby={!validation.email.isValid ? 'email-error' : undefined}
                />
                <EnvelopeIcon className="w-5 h-5 absolute left-3 top-1/2 transform -translate-y-1/2 text-base-content/40" />
                {email && validation.email.isValid && (
                  <CheckCircleIcon className="w-5 h-5 absolute right-3 top-1/2 transform -translate-y-1/2 text-success" />
                )}
              </div>
              {!validation.email.isValid && (
                <div className="label">
                  <span id="email-error" className="label-text-alt text-error flex items-center gap-1">
                    <ExclamationTriangleIcon className="w-3 h-3" />
                    {validation.email.message}
                  </span>
                </div>
              )}
            </div>

            {/* Password Field */}
            <div className="form-control">
              <label htmlFor="password" className="label">
                <span className="label-text font-medium flex items-center gap-2">
                  <LockClosedIcon className="w-4 h-4" />
                  Password
                </span>
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Enter your password"
                  className={`input input-bordered w-full pl-10 pr-10 ${
                    !validation.password.isValid ? 'input-error' : 
                    password && validation.password.isValid ? 'input-success' : ''
                  }`}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  aria-describedby={!validation.password.isValid ? 'password-error' : undefined}
                />
                <LockClosedIcon className="w-5 h-5 absolute left-3 top-1/2 transform -translate-y-1/2 text-base-content/40" />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-base-content/40 hover:text-base-content"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? (
                    <EyeSlashIcon className="w-5 h-5" />
                  ) : (
                    <EyeIcon className="w-5 h-5" />
                  )}
                </button>
              </div>
              
              {/* Password Strength Indicator (for signup) */}
              {isSignup && password && (
                <div className="mt-2">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-xs text-base-content/70">Password strength</span>
                    <span className={`text-xs font-medium ${getPasswordStrengthLabel(getPasswordStrength(password)).color}`}>
                      {getPasswordStrengthLabel(getPasswordStrength(password)).label}
                    </span>
                  </div>
                  <progress 
                    className={`progress w-full h-2 ${
                      getPasswordStrength(password) < 25 ? 'progress-error' :
                      getPasswordStrength(password) < 50 ? 'progress-warning' :
                      getPasswordStrength(password) < 75 ? 'progress-info' : 'progress-success'
                    }`}
                    value={getPasswordStrength(password)} 
                    max="100"
                  ></progress>
                </div>
              )}

              {!validation.password.isValid && (
                <div className="label">
                  <span id="password-error" className="label-text-alt text-error flex items-center gap-1">
                    <ExclamationTriangleIcon className="w-3 h-3" />
                    {validation.password.message}
                  </span>
                </div>
              )}
            </div>

            {/* Confirm Password Field (for signup) */}
            {isSignup && (
              <div className="form-control">
                <label htmlFor="confirmPassword" className="label">
                  <span className="label-text font-medium flex items-center gap-2">
                    <LockClosedIcon className="w-4 h-4" />
                    Confirm Password
                  </span>
                </label>
                <div className="relative">
                  <input
                    id="confirmPassword"
                    type={showConfirmPassword ? 'text' : 'password'}
                    placeholder="Confirm your password"
                    className={`input input-bordered w-full pl-10 pr-10 ${
                      confirmPassword && password !== confirmPassword ? 'input-error' :
                      confirmPassword && password === confirmPassword ? 'input-success' : ''
                    }`}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                  />
                  <LockClosedIcon className="w-5 h-5 absolute left-3 top-1/2 transform -translate-y-1/2 text-base-content/40" />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-base-content/40 hover:text-base-content"
                    aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                  >
                    {showConfirmPassword ? (
                      <EyeSlashIcon className="w-5 h-5" />
                    ) : (
                      <EyeIcon className="w-5 h-5" />
                    )}
                  </button>
                </div>
                {confirmPassword && password !== confirmPassword && (
                  <div className="label">
                    <span className="label-text-alt text-error flex items-center gap-1">
                      <ExclamationTriangleIcon className="w-3 h-3" />
                      Passwords do not match
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Error Message */}
            {error && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="alert alert-error"
              >
                <ExclamationTriangleIcon className="w-5 h-5" />
                <span>{error}</span>
              </motion.div>
            )}

            {/* Submit Button */}
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              type="submit"
              disabled={isSubmitting || !validation.email.isValid || !validation.password.isValid}
              className="btn btn-primary w-full gap-2 disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <ArrowPathIcon className="w-5 h-5 animate-spin" />
                  {isSignup ? 'Creating Account...' : 'Signing In...'}
                </>
              ) : (
                <>
                  {isSignup ? <UserPlusIcon className="w-5 h-5" /> : <LockClosedIcon className="w-5 h-5" />}
                  {isSignup ? 'Create Account' : 'Sign In'}
                </>
              )}
            </motion.button>

            {/* Divider */}
            <div className="divider">OR</div>

            {/* Google Sign In */}
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              type="button"
              onClick={handleGoogleSignIn}
              disabled={isGoogleLoading}
              className="btn btn-outline w-full gap-2 disabled:opacity-50"
            >
              {isGoogleLoading ? (
                <>
                  <ArrowPathIcon className="w-5 h-5 animate-spin" />
                  Signing in with Google...
                </>
              ) : (
                <>
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                  Continue with Google
                </>
              )}
            </motion.button>

            {/* Facebook Sign In */}
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              type="button"
              onClick={handleFacebookSignIn}
              disabled={isGoogleLoading}
              className="btn btn-outline w-full gap-2 disabled:opacity-50"
            >
              {isGoogleLoading ? (
                <>
                  <ArrowPathIcon className="w-5 h-5 animate-spin" />
                  Signing in with Facebook...
                </>
              ) : (
                <>
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M22.675 0h-21.35C.596 0 0 .593 0 1.326v21.348C0 23.406.596 24 1.325 24h11.495v-9.294H9.69V11.01h3.13V8.414c0-3.1 1.893-4.788 4.659-4.788 1.325 0 2.463.098 2.795.142v3.24l-1.918.001c-1.504 0-1.796.715-1.796 1.764v2.314h3.588l-.467 3.696h-3.12V24h6.116C23.404 24 24 23.406 24 22.674V1.326C24 .593 23.404 0 22.675 0z" />
                  </svg>
                  Continue with Facebook
                </>
              )}
            </motion.button>

            {/* Apple Sign In */}
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              type="button"
              onClick={handleAppleSignIn}
              disabled={isGoogleLoading}
              className="btn btn-outline w-full gap-2 disabled:opacity-50"
            >
              {isGoogleLoading ? (
                <>
                  <ArrowPathIcon className="w-5 h-5 animate-spin" />
                  Signing in with Apple...
                </>
              ) : (
                <>
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M16.365 1.43c0 1.14-.42 2.09-1.25 2.88-.9.87-1.9 1.38-3 1.3-.1-1.05.43-2.06 1.25-2.86.88-.86 2.2-1.49 3-1.32zM20.7 17.4c-.56 1.29-.85 1.86-1.6 3-.95 1.46-2.29 3.28-3.94 3.3-1.47.02-1.85-.95-3.84-.95-1.99 0-2.41.92-3.88.97-1.65.06-2.91-1.58-3.86-3.03C2.03 19.2.6 15.17 2.4 12.09c1.06-1.84 2.95-3 5-3.03 1.57-.03 3.06 1.06 3.84 1.06.78 0 2.66-1.31 4.5-1.12.77.03 2.95.31 4.35 2.34-3.84 2.1-3.22 7.62.6 6.06z" />
                  </svg>
                  Continue with Apple
                </>
              )}
            </motion.button>

            {/* Mode Switch */}
            <div className="text-center">
              <button
                type="button"
                onClick={handleModeSwitch}
                className="link link-primary text-sm font-medium"
              >
                {isSignup 
                  ? 'Already have an account? Sign in' 
                  : "Don't have an account? Sign up"
                }
              </button>
            </div>
          </form>
        </div>
      </motion.div>
    </>
  );
};

export default AuthForm;
