'use client';

import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { useAuth } from '@/AuthContext';
import { useRouter } from 'next/navigation';
import { useNotification, NotificationToast } from '@/hooks/useNotification';
import { buttonStyles } from '@/components/ui/controlStyles';
import { cn } from '@/lib/utils';
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
  ArrowPathIcon,
} from '@heroicons/react/24/outline';

interface AuthFormProps {
  initialMode?: 'login' | 'signup';
  onSuccess?: () => void;
  className?: string;
  // Optional URL to redirect to after successful auth
  nextUrl?: string;
  // When true, redirect immediately if a user session already exists
  autoRedirectIfAuthenticated?: boolean;
  // When false, hides the mode switch CTA to avoid duplication with external CTAs
  showModeSwitch?: boolean;
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

const AuthForm = ({
  initialMode = 'login',
  onSuccess,
  className = '',
  nextUrl,
  autoRedirectIfAuthenticated = false,
  showModeSwitch = true,
}: AuthFormProps) => {
  const {
    login,
    signup,
    user,
    logout,
    loginWithGoogle,
    loginWithFacebook,
    loading,
    loginWithApple,
  } = useAuth();
  const router = useRouter();
  const { notification, showNotification } = useNotification();
  const hasStartedRedirect = useRef(false);

  // Safe redirect helper to avoid open redirects
  const toSafeRedirect = (url?: string) =>
    url && url.startsWith('/') && !url.startsWith('//') ? url : undefined;

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
  const [isAppleLoading, setIsAppleLoading] = useState(false);
  const [isGithubLoading, setIsGithubLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [touched, setTouched] = useState({
    email: false,
    password: false,
  });
  const [validation, setValidation] = useState<FormValidation>({
    email: { isValid: true, message: '' },
    password: { isValid: true, message: '' },
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
      password: passwordValidation,
    });
  }, [email, password, isSignup]);

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

  const redirectAfterAuthentication = () => {
    const destination = toSafeRedirect(nextUrl);
    if (destination) {
      hasStartedRedirect.current = true;
      router.replace(destination);
      return;
    }

    onSuccess?.();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setHasSubmitted(true);
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
      redirectAfterAuthentication();
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
      redirectAfterAuthentication();
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
    setIsGithubLoading(true);
    try {
      await loginWithFacebook();
      showNotification('success', 'Successfully signed in with Facebook!');
      redirectAfterAuthentication();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Facebook sign-in failed';
      setError(message);
      showNotification('error', message);
    } finally {
      setIsGithubLoading(false);
    }
  };

  const handleAppleSignIn = async () => {
    setError(null);
    setIsAppleLoading(true);
    try {
      await loginWithApple();
      showNotification('success', 'Successfully signed in with Apple!');
      redirectAfterAuthentication();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Apple sign-in failed';
      setError(message);
      showNotification('error', message);
    } finally {
      setIsAppleLoading(false);
    }
  };

  // Optional: redirect immediately if already authenticated
  useEffect(() => {
    if (autoRedirectIfAuthenticated && user && !hasStartedRedirect.current) {
      const destination = toSafeRedirect(nextUrl) || '/dashboard';
      hasStartedRedirect.current = true;
      router.replace(destination);
    }
  }, [autoRedirectIfAuthenticated, nextUrl, router, user]);

  const handleModeSwitch = () => {
    setIsSignup(!isSignup);
    setError(null);
    setHasSubmitted(false);
    setTouched({
      email: false,
      password: false,
    });
    setPassword('');
    setConfirmPassword('');
    setValidation({
      email: { isValid: true, message: '' },
      password: { isValid: true, message: '' },
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

  if (user && autoRedirectIfAuthenticated) {
    return null;
  }

  if (user) {
    return (
      <section
        aria-labelledby="auth-signed-in-heading"
        className={`rounded-lg border border-border bg-background p-5 ${className}`}
      >
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-bar text-brand-bar-foreground">
            {user.photoURL ? (
              <img src={user.photoURL} alt="" className="h-full w-full object-cover" />
            ) : (
              <UserIcon aria-hidden="true" className="h-7 w-7" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h3 id="auth-signed-in-heading" className="text-xl font-semibold text-foreground">
              Welcome back!
            </h3>
            <p className="truncate text-muted-foreground">{user.displayName || user.email}</p>
            <p className="mt-1 flex items-center gap-2 text-sm text-result-win">
              <CheckCircleIcon aria-hidden="true" className="h-4 w-4" />
              Authenticated
            </p>
          </div>
        </div>

        <dl className="mt-5 grid gap-3 sm:grid-cols-2">
          <div className="flex items-center gap-3 rounded-md bg-muted p-3">
            <ShieldCheckIcon aria-hidden="true" className="h-6 w-6 text-muted-foreground" />
            <div>
              <dt className="text-xs font-medium text-muted-foreground">Status</dt>
              <dd className="font-semibold text-foreground">Active</dd>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-md bg-muted p-3">
            <EnvelopeIcon aria-hidden="true" className="h-6 w-6 text-muted-foreground" />
            <div>
              <dt className="text-xs font-medium text-muted-foreground">Email</dt>
              <dd className="font-semibold text-foreground">
                {user.emailVerified ? 'Email verified' : 'Verification needed'}
              </dd>
            </div>
          </div>
        </dl>

        <button
          type="button"
          onClick={handleLogout}
          className={cn(buttonStyles({ variant: 'outline' }), 'mt-5 text-result-loss')}
        >
          <ArrowRightOnRectangleIcon aria-hidden="true" className="h-5 w-5" />
          Sign Out
        </button>
      </section>
    );
  }

  const showEmailError = (hasSubmitted || touched.email) && !validation.email.isValid;
  const showPasswordError = (hasSubmitted || touched.password) && !validation.password.isValid;

  return (
    <>
      <NotificationToast notification={notification} />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className={className}
      >
        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-6" noValidate>
          {/* Email Field */}
          <div className="space-y-2">
            <label htmlFor="email" className="block text-sm font-semibold text-foreground">
              Email Address
            </label>
            <div className="relative group">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <EnvelopeIcon
                  className={`w-5 h-5 transition-colors ${
                    showEmailError
                      ? 'text-result-loss'
                      : email && validation.email.isValid
                        ? 'text-result-win'
                        : 'text-muted-foreground group-focus-within:text-foreground'
                  }`}
                />
              </div>
              <input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="Enter your email address"
                className={`block w-full pl-10 pr-10 py-3 border rounded-md shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all duration-200 ${
                  showEmailError
                    ? 'border-result-loss/50 bg-result-loss/5 text-result-loss'
                    : email && validation.email.isValid
                      ? 'border-result-win/50 bg-result-win/5 text-result-win'
                      : 'border-input bg-background text-foreground hover:border-foreground/40'
                }`}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onBlur={() => setTouched((current) => ({ ...current, email: true }))}
                required
                aria-describedby={showEmailError ? 'email-error' : undefined}
              />
              {email && validation.email.isValid && (
                <div className="absolute inset-y-0 right-0 pr-3 flex items-center">
                  <CheckCircleIcon className="w-5 h-5 text-result-win" />
                </div>
              )}
            </div>
            {showEmailError && (
              <p id="email-error" className="text-sm text-result-loss flex items-center gap-1">
                <ExclamationTriangleIcon className="w-4 h-4" />
                {validation.email.message}
              </p>
            )}
          </div>

          {/* Password Field */}
          <div className="space-y-2">
            <label htmlFor="password" className="block text-sm font-semibold text-foreground">
              Password
            </label>
            <div className="relative group">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <LockClosedIcon
                  className={`w-5 h-5 transition-colors ${
                    showPasswordError
                      ? 'text-result-loss'
                      : password && validation.password.isValid
                        ? 'text-result-win'
                        : 'text-muted-foreground group-focus-within:text-foreground'
                  }`}
                />
              </div>
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete={isSignup ? 'new-password' : 'current-password'}
                placeholder="Enter your password"
                className={`block w-full pl-10 pr-10 py-3 border rounded-md shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all duration-200 ${
                  showPasswordError
                    ? 'border-result-loss/50 bg-result-loss/5 text-result-loss'
                    : password && validation.password.isValid
                      ? 'border-result-win/50 bg-result-win/5 text-result-win'
                      : 'border-input bg-background text-foreground hover:border-foreground/40'
                }`}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onBlur={() => setTouched((current) => ({ ...current, password: true }))}
                required
                aria-describedby={showPasswordError ? 'password-error' : undefined}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-muted-foreground hover:text-foreground transition-colors"
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
              <div className="mt-3">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-xs font-medium text-muted-foreground">
                    Password strength
                  </span>
                  <span
                    className={`text-xs font-semibold ${
                      getPasswordStrength(password) < 25
                        ? 'text-result-loss'
                        : getPasswordStrength(password) < 50
                          ? 'text-foreground'
                          : getPasswordStrength(password) < 75
                            ? 'text-brand-bar'
                            : 'text-result-win'
                    }`}
                  >
                    {getPasswordStrengthLabel(getPasswordStrength(password)).label}
                  </span>
                </div>
                <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      getPasswordStrength(password) < 25
                        ? 'bg-result-loss'
                        : getPasswordStrength(password) < 50
                          ? 'bg-warning'
                          : getPasswordStrength(password) < 75
                            ? 'bg-brand-bar'
                            : 'bg-result-win'
                    }`}
                    style={{ width: `${getPasswordStrength(password)}%` }}
                  />
                </div>
              </div>
            )}

            {showPasswordError && (
              <p
                id="password-error"
                className="text-sm text-result-loss flex items-center gap-1 mt-2"
              >
                <ExclamationTriangleIcon className="w-4 h-4" />
                {validation.password.message}
              </p>
            )}
          </div>

          {/* Confirm Password Field (for signup) */}
          {isSignup && (
            <div className="space-y-2">
              <label
                htmlFor="confirmPassword"
                className="block text-sm font-semibold text-foreground"
              >
                Confirm Password
              </label>
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <LockClosedIcon
                    className={`w-5 h-5 transition-colors ${
                      confirmPassword && password !== confirmPassword
                        ? 'text-result-loss'
                        : confirmPassword && password === confirmPassword
                          ? 'text-result-win'
                          : 'text-muted-foreground group-focus-within:text-foreground'
                    }`}
                  />
                </div>
                <input
                  id="confirmPassword"
                  type={showConfirmPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  placeholder="Confirm your password"
                  className={`block w-full pl-10 pr-10 py-3 border rounded-md shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all duration-200 ${
                    confirmPassword && password !== confirmPassword
                      ? 'border-result-loss/50 bg-result-loss/5 text-result-loss'
                      : confirmPassword && password === confirmPassword
                        ? 'border-result-win/50 bg-result-win/5 text-result-win'
                        : 'border-input bg-background text-foreground hover:border-foreground/40'
                  }`}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-muted-foreground hover:text-foreground transition-colors"
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
                <p className="text-sm text-result-loss flex items-center gap-1">
                  <ExclamationTriangleIcon className="w-4 h-4" />
                  Passwords do not match
                </p>
              )}
            </div>
          )}

          {/* Error Message */}
          {error && (
            <motion.div
              role="alert"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-result-loss/5 border border-result-loss/50 rounded-md p-4 flex items-center gap-3"
            >
              <ExclamationTriangleIcon className="w-5 h-5 text-result-loss flex-shrink-0" />
              <span className="text-sm text-result-loss font-medium">{error}</span>
            </motion.div>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isSubmitting}
            className={cn(buttonStyles({ variant: 'primary', size: 'lg' }), 'w-full')}
          >
            {isSubmitting ? (
              <>
                <ArrowPathIcon className="w-5 h-5 animate-spin" />
                <span>{isSignup ? 'Creating Account...' : 'Signing In...'}</span>
              </>
            ) : (
              <>
                {isSignup ? (
                  <UserPlusIcon className="w-5 h-5" />
                ) : (
                  <ArrowRightOnRectangleIcon className="w-5 h-5" />
                )}
                <span>{isSignup ? 'Create Account' : 'Sign In'}</span>
              </>
            )}
          </button>

          {/* Divider */}
          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-input"></div>
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-4 bg-background text-muted-foreground font-medium">
                Or continue with
              </span>
            </div>
          </div>

          {/* Social Sign In Buttons */}
          <div className="grid grid-cols-1 gap-3">
            {/* Google Sign In */}
            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={isGoogleLoading}
              className={cn(buttonStyles({ variant: 'outline', size: 'lg' }), 'w-full font-medium')}
            >
              {isGoogleLoading ? (
                <>
                  <ArrowPathIcon className="w-5 h-5 animate-spin text-muted-foreground" />
                  <span>Signing in with Google...</span>
                </>
              ) : (
                <>
                  <svg className="w-5 h-5" viewBox="0 0 24 24">
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
                  <span>Continue with Google</span>
                </>
              )}
            </button>

            {/* Facebook Sign In */}
            <button
              type="button"
              onClick={handleFacebookSignIn}
              disabled={isGithubLoading}
              className={cn(buttonStyles({ variant: 'outline', size: 'lg' }), 'w-full font-medium')}
            >
              {isGithubLoading ? (
                <>
                  <ArrowPathIcon className="w-5 h-5 animate-spin text-muted-foreground" />
                  <span>Signing in with Facebook...</span>
                </>
              ) : (
                <>
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="#1877F2">
                    <path d="M22.675 0h-21.35C.596 0 0 .593 0 1.326v21.348C0 23.406.596 24 1.325 24h11.495v-9.294H9.69V11.01h3.13V8.414c0-3.1 1.893-4.788 4.659-4.788 1.325 0 2.463.098 2.795.142v3.24l-1.918.001c-1.504 0-1.796.715-1.796 1.764v2.314h3.588l-.467 3.696h-3.12V24h6.116C23.404 24 24 23.406 24 22.674V1.326C24 .593 23.404 0 22.675 0z" />
                  </svg>
                  <span>Continue with Facebook</span>
                </>
              )}
            </button>

            {/* Apple Sign In */}
            <button
              type="button"
              onClick={handleAppleSignIn}
              disabled={isAppleLoading}
              className={cn(buttonStyles({ variant: 'outline', size: 'lg' }), 'w-full font-medium')}
            >
              {isAppleLoading ? (
                <>
                  <ArrowPathIcon className="w-5 h-5 animate-spin text-muted-foreground" />
                  <span>Signing in with Apple...</span>
                </>
              ) : (
                <>
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M16.365 1.43c0 1.14-.42 2.09-1.25 2.88-.9.87-1.9 1.38-3 1.3-.1-1.05.43-2.06 1.25-2.86.88-.86 2.2-1.49 3-1.32zM20.7 17.4c-.56 1.29-.85 1.86-1.6 3-.95 1.46-2.29 3.28-3.94 3.3-1.47.02-1.85-.95-3.84-.95-1.99 0-2.41.92-3.88.97-1.65.06-2.91-1.58-3.86-3.03C2.03 19.2.6 15.17 2.4 12.09c1.06-1.84 2.95-3 5-3.03 1.57-.03 3.06 1.06 3.84 1.06.78 0 2.66-1.31 4.5-1.12.77.03 2.95.31 4.35 2.34-3.84 2.1-3.22 7.62.6 6.06z" />
                  </svg>
                  <span>Continue with Apple</span>
                </>
              )}
            </button>
          </div>

          {/* Mode Switch */}
          {showModeSwitch && (
            <div className="text-center pt-4">
              <p className="text-sm text-muted-foreground">
                {isSignup ? 'Already have an account?' : "Don't have an account?"}{' '}
                <button
                  type="button"
                  onClick={handleModeSwitch}
                  className="font-semibold text-brand-bar hover:text-brand-bar transition-colors underline-offset-4 hover:underline"
                >
                  {isSignup ? 'Sign in' : 'Sign up'}
                </button>
              </p>
            </div>
          )}
        </form>
      </motion.div>
    </>
  );
};

export default AuthForm;
