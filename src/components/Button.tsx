'use client';

import clsx from 'clsx';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { useReducedMotion } from '@/hooks/useAccessibility';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  loadingText?: string;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  fullWidth?: boolean;
}

export default function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  loadingText,
  leftIcon,
  rightIcon,
  fullWidth = false,
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  const prefersReducedMotion = useReducedMotion();

  const baseClasses = [
    'inline-flex items-center justify-center font-medium rounded-md',
    'focus:outline-none focus:ring-2 focus:ring-offset-2',
    'transition-colors duration-200',
    'disabled:opacity-50 disabled:cursor-not-allowed',
    !prefersReducedMotion && 'transform transition-transform hover:scale-105 active:scale-95',
  ].filter(Boolean);

  const sizeClasses = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-2 text-sm',
    lg: 'px-6 py-3 text-base',
  };

  const variantClasses = {
    primary: [
      'bg-blue-600 text-white border border-transparent',
      'hover:bg-blue-700 focus:ring-blue-500',
      'disabled:bg-blue-300',
    ],
    secondary: [
      'bg-white text-gray-700 border border-gray-300',
      'hover:bg-gray-50 focus:ring-blue-500',
      'disabled:bg-gray-100',
    ],
    danger: [
      'bg-red-600 text-white border border-transparent',
      'hover:bg-red-700 focus:ring-red-500',
      'disabled:bg-red-300',
    ],
    ghost: [
      'bg-transparent text-gray-700 border border-transparent',
      'hover:bg-gray-100 focus:ring-gray-500',
      'disabled:bg-transparent',
    ],
  };

  const isDisabled = disabled || loading;

  return (
    <button
      className={clsx(
        baseClasses,
        sizeClasses[size],
        variantClasses[variant],
        fullWidth && 'w-full',
        className
      )}
      disabled={isDisabled}
      aria-disabled={isDisabled}
      aria-describedby={loading ? `${props.id || 'button'}-loading` : undefined}
      {...props}
    >
      {loading && (
        <svg
          className="animate-spin -ml-1 mr-2 h-4 w-4"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
      )}

      {!loading && leftIcon && (
        <span className="mr-2" aria-hidden="true">
          {leftIcon}
        </span>
      )}

      <span>
        {loading ? (loadingText || 'Loading...') : children}
      </span>

      {!loading && rightIcon && (
        <span className="ml-2" aria-hidden="true">
          {rightIcon}
        </span>
      )}

      {loading && (
        <span id={`${props.id || 'button'}-loading`} className="sr-only">
          Loading, please wait
        </span>
      )}
    </button>
  );
}
