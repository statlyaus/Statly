'use client';

import React, { useState, useEffect } from 'react';

import { useRouter } from 'next/navigation';

import {
  CheckCircle,
  Eye,
  EyeOff,
  LoaderCircle,
  Lock,
  LogIn,
  LogOut,
  Mail,
  ShieldCheck,
  TriangleAlert,
  User,
  UserPlus,
} from 'lucide-react';
import { motion } from 'framer-motion';

import { useAuth } from '@/AuthContext';
import { useNotification, NotificationToast } from '@/hooks/useNotification';
import { UIButton } from '@/components/ui/button';
import { UIInput } from '@/components/ui/input';
import { UILabel } from '@/components/ui/label';
import { cn } from '@/lib/utils';

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

const fieldBaseClass = 'h-12 rounded-xl pl-10 pr-10 text-base shadow-sm focus-visible:ring-ring';
const fieldDefaultClass = 'border-input bg-background text-foreground hover:border-ring/50';
const fieldErrorClass =
  'border-destructive bg-destructive/10 text-foreground focus-visible:ring-destructive';
const fieldValidClass =
  'border-primary/40 bg-primary/10 text-foreground focus-visible:ring-primary/60';
const fieldIconDefaultClass = 'text-muted-foreground group-focus-within:text-foreground';
const fieldIconErrorClass = 'text-destructive';
const fieldIconValidClass = 'text-primary';
const validationMessageClass = 'flex items-center gap-1 text-sm font-medium text-destructive';
const socialButtonClass =
  'flex h-12 w-full items-center justify-center gap-3 rounded-xl border border-border bg-background px-4 py-3 font-medium text-foreground shadow-sm transition-all duration-200 hover:bg-accent hover:text-accent-foreground hover:shadow-md disabled:cursor-not-allowed disabled:opacity-70';

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
        const dest = toSafeRedirect(nextUrl);
        if (dest) {
          router.replace(dest);
        } else {
          onSuccess?.();
        }
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
        const dest = toSafeRedirect(nextUrl);
        if (dest) {
          router.replace(dest);
        } else {
          onSuccess?.();
        }
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
    setIsGithubLoading(true);
    try {
      await loginWithFacebook();
      showNotification('success', 'Successfully signed in with Facebook!');
      if (nextUrl) {
        const dest = toSafeRedirect(nextUrl);
        if (dest) {
          router.replace(dest);
        } else {
          onSuccess?.();
        }
      } else {
        onSuccess?.();
      }
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
      if (nextUrl) {
        const dest = toSafeRedirect(nextUrl);
        if (dest) {
          router.replace(dest);
        } else {
          onSuccess?.();
        }
      } else {
        onSuccess?.();
      }
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
    if (autoRedirectIfAuthenticated && user) {
      const destination = toSafeRedirect(nextUrl) || '/dashboard';
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
          <LoaderCircle className="mx-auto mb-4 h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Loading authentication...</p>
        </div>
      </div>
    );
  }

  if (user) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className={cn(
          'rounded-xl border border-border bg-card text-card-foreground shadow-xl',
          className
        )}
      >
        <div className="p-6">
          <div className="flex items-center gap-4 mb-6">
            <div>
              <div className="h-16 w-16 overflow-hidden rounded-full ring-2 ring-primary ring-offset-2 ring-offset-background">
                {user.photoURL ? (
                  <img src={user.photoURL} alt="Profile" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-primary text-primary-foreground">
                    <User className="h-8 w-8" />
                  </div>
                )}
              </div>
            </div>
            <div className="flex-1">
              <h3 className="text-xl font-bold text-foreground">Welcome back!</h3>
              <p className="text-muted-foreground">{user.displayName || user.email}</p>
              <div className="flex items-center gap-2 mt-1">
                <CheckCircle className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium text-primary">Authenticated</span>
              </div>
            </div>
          </div>

          <div className="grid gap-3 rounded-xl border border-border bg-muted/30 p-4 shadow-sm lg:grid-cols-2">
            <div className="flex items-start gap-3">
              <div className="text-primary">
                <ShieldCheck className="h-8 w-8" />
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Status</div>
                <div className="text-lg font-semibold text-primary">Active</div>
                <div className="text-xs text-muted-foreground">Securely authenticated</div>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="text-primary">
                <Mail className="h-8 w-8" />
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Email</div>
                <div className="text-lg font-semibold text-primary">
                  {user.emailVerified ? 'Verified' : 'Pending'}
                </div>
                <div className="text-xs text-muted-foreground">
                  {user.emailVerified ? 'Email confirmed' : 'Verification needed'}
                </div>
              </div>
            </div>
          </div>

          <UIButton onClick={handleLogout} variant="danger" className="mt-4">
            <LogOut className="h-5 w-5" />
            Sign Out
          </UIButton>
        </div>
      </motion.div>
    );
  }

  return (
    <>
      <NotificationToast notification={notification} />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className={className}
      >
        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Email Field */}
          <div className="space-y-2">
            <UILabel htmlFor="email" className="block font-semibold">
              Email Address
            </UILabel>
            <div className="relative group">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Mail
                  className={cn(
                    'h-5 w-5 transition-colors',
                    !validation.email.isValid
                      ? fieldIconErrorClass
                      : email && validation.email.isValid
                        ? fieldIconValidClass
                        : fieldIconDefaultClass
                  )}
                />
              </div>
              <UIInput
                id="email"
                type="email"
                placeholder="Enter your email address"
                className={cn(
                  fieldBaseClass,
                  !validation.email.isValid
                    ? fieldErrorClass
                    : email && validation.email.isValid
                      ? fieldValidClass
                      : fieldDefaultClass
                )}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                aria-invalid={!validation.email.isValid}
                aria-describedby={!validation.email.isValid ? 'email-error' : undefined}
              />
              {email && validation.email.isValid && (
                <div className="absolute inset-y-0 right-0 pr-3 flex items-center">
                  <CheckCircle className="h-5 w-5 text-primary" />
                </div>
              )}
            </div>
            {!validation.email.isValid && (
              <p id="email-error" className={validationMessageClass}>
                <TriangleAlert className="h-4 w-4" />
                {validation.email.message}
              </p>
            )}
          </div>

          {/* Password Field */}
          <div className="space-y-2">
            <UILabel htmlFor="password" className="block font-semibold">
              Password
            </UILabel>
            <div className="relative group">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Lock
                  className={cn(
                    'h-5 w-5 transition-colors',
                    !validation.password.isValid
                      ? fieldIconErrorClass
                      : password && validation.password.isValid
                        ? fieldIconValidClass
                        : fieldIconDefaultClass
                  )}
                />
              </div>
              <UIInput
                id="password"
                type={showPassword ? 'text' : 'password'}
                placeholder="Enter your password"
                className={cn(
                  fieldBaseClass,
                  !validation.password.isValid
                    ? fieldErrorClass
                    : password && validation.password.isValid
                      ? fieldValidClass
                      : fieldDefaultClass
                )}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                aria-invalid={!validation.password.isValid}
                aria-describedby={!validation.password.isValid ? 'password-error' : undefined}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground transition-colors hover:text-foreground"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
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
                    className={cn(
                      'text-xs font-semibold',
                      getPasswordStrength(password) < 25
                        ? 'text-destructive'
                        : getPasswordStrength(password) < 50
                          ? 'text-muted-foreground'
                          : getPasswordStrength(password) < 75
                            ? 'text-primary/70'
                            : 'text-primary'
                    )}
                  >
                    {getPasswordStrengthLabel(getPasswordStrength(password)).label}
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      'h-full rounded-full transition-all duration-500',
                      getPasswordStrength(password) < 25
                        ? 'bg-destructive'
                        : getPasswordStrength(password) < 50
                          ? 'bg-muted-foreground'
                          : getPasswordStrength(password) < 75
                            ? 'bg-primary/70'
                            : 'bg-primary'
                    )}
                    style={{ width: `${getPasswordStrength(password)}%` }}
                  />
                </div>
              </div>
            )}

            {!validation.password.isValid && (
              <p id="password-error" className={cn(validationMessageClass, 'mt-2')}>
                <TriangleAlert className="h-4 w-4" />
                {validation.password.message}
              </p>
            )}
          </div>

          {/* Confirm Password Field (for signup) */}
          {isSignup && (
            <div className="space-y-2">
              <UILabel htmlFor="confirmPassword" className="block font-semibold">
                Confirm Password
              </UILabel>
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock
                    className={cn(
                      'h-5 w-5 transition-colors',
                      confirmPassword && password !== confirmPassword
                        ? fieldIconErrorClass
                        : confirmPassword && password === confirmPassword
                          ? fieldIconValidClass
                          : fieldIconDefaultClass
                    )}
                  />
                </div>
                <UIInput
                  id="confirmPassword"
                  type={showConfirmPassword ? 'text' : 'password'}
                  placeholder="Confirm your password"
                  className={cn(
                    fieldBaseClass,
                    confirmPassword && password !== confirmPassword
                      ? fieldErrorClass
                      : confirmPassword && password === confirmPassword
                        ? fieldValidClass
                        : fieldDefaultClass
                  )}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  aria-invalid={Boolean(confirmPassword && password !== confirmPassword)}
                  aria-describedby={
                    confirmPassword && password !== confirmPassword
                      ? 'confirm-password-error'
                      : undefined
                  }
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground transition-colors hover:text-foreground"
                  aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                >
                  {showConfirmPassword ? (
                    <EyeOff className="h-5 w-5" />
                  ) : (
                    <Eye className="h-5 w-5" />
                  )}
                </button>
              </div>
              {confirmPassword && password !== confirmPassword && (
                <p id="confirm-password-error" className={validationMessageClass}>
                  <TriangleAlert className="h-4 w-4" />
                  Passwords do not match
                </p>
              )}
            </div>
          )}

          {/* Error Message */}
          {error && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4"
            >
              <TriangleAlert className="h-5 w-5 flex-shrink-0 text-destructive" />
              <span className="text-sm font-medium text-destructive">{error}</span>
            </motion.div>
          )}

          {/* Submit Button */}
          <motion.button
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.99 }}
            type="submit"
            disabled={isSubmitting || !validation.email.isValid || !validation.password.isValid}
            className="flex w-full items-center justify-center gap-3 rounded-xl bg-primary px-4 py-3 font-semibold text-primary-foreground shadow-lg transition-all duration-200 hover:bg-primary/90 hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isSubmitting ? (
              <>
                <LoaderCircle className="h-5 w-5 animate-spin" />
                <span>{isSignup ? 'Creating Account...' : 'Signing In...'}</span>
              </>
            ) : (
              <>
                {isSignup ? <UserPlus className="h-5 w-5" /> : <LogIn className="h-5 w-5" />}
                <span>{isSignup ? 'Create Account' : 'Sign In'}</span>
              </>
            )}
          </motion.button>

          {/* Divider */}
          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border"></div>
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="bg-card px-4 font-medium text-muted-foreground">
                Or continue with
              </span>
            </div>
          </div>

          {/* Social Sign In Buttons */}
          <div className="grid grid-cols-1 gap-3">
            {/* Google Sign In */}
            <motion.button
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
              type="button"
              onClick={handleGoogleSignIn}
              disabled={isGoogleLoading}
              className={socialButtonClass}
            >
              {isGoogleLoading ? (
                <>
                  <LoaderCircle className="h-5 w-5 animate-spin text-muted-foreground" />
                  <span>Signing in with Google...</span>
                </>
              ) : (
                <>
                  <svg className="w-5 h-5" viewBox="0 0 24 24">
                    <path
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                      fill="var(--brand-google-blue)"
                    />
                    <path
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      fill="var(--brand-google-green)"
                    />
                    <path
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                      fill="var(--brand-google-yellow)"
                    />
                    <path
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                      fill="var(--brand-google-red)"
                    />
                  </svg>
                  <span>Continue with Google</span>
                </>
              )}
            </motion.button>

            {/* Facebook Sign In */}
            <motion.button
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
              type="button"
              onClick={handleFacebookSignIn}
              disabled={isGithubLoading}
              className={socialButtonClass}
            >
              {isGithubLoading ? (
                <>
                  <LoaderCircle className="h-5 w-5 animate-spin text-muted-foreground" />
                  <span>Signing in with Facebook...</span>
                </>
              ) : (
                <>
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="var(--brand-facebook-blue)">
                    <path d="M22.675 0h-21.35C.596 0 0 .593 0 1.326v21.348C0 23.406.596 24 1.325 24h11.495v-9.294H9.69V11.01h3.13V8.414c0-3.1 1.893-4.788 4.659-4.788 1.325 0 2.463.098 2.795.142v3.24l-1.918.001c-1.504 0-1.796.715-1.796 1.764v2.314h3.588l-.467 3.696h-3.12V24h6.116C23.404 24 24 23.406 24 22.674V1.326C24 .593 23.404 0 22.675 0z" />
                  </svg>
                  <span>Continue with Facebook</span>
                </>
              )}
            </motion.button>

            {/* Apple Sign In */}
            <motion.button
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
              type="button"
              onClick={handleAppleSignIn}
              disabled={isAppleLoading}
              className={socialButtonClass}
            >
              {isAppleLoading ? (
                <>
                  <LoaderCircle className="h-5 w-5 animate-spin text-muted-foreground" />
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
            </motion.button>
          </div>

          {/* Mode Switch */}
          {showModeSwitch && (
            <div className="text-center pt-4">
              <p className="text-sm text-muted-foreground">
                {isSignup ? 'Already have an account?' : "Don't have an account?"}{' '}
                <button
                  type="button"
                  onClick={handleModeSwitch}
                  className="font-semibold text-primary underline-offset-4 transition-colors hover:text-primary/80 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
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
