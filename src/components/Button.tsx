'use client';

import type { ButtonHTMLAttributes, AnchorHTMLAttributes, ReactNode, MouseEvent } from 'react';

import Link from 'next/link';

import clsx from 'clsx';

import { useReducedMotion } from '@/hooks/useAccessibility';

interface CommonProps {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  loadingText?: string;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  fullWidth?: boolean;
}

type ButtonAsButton = CommonProps & ButtonHTMLAttributes<HTMLButtonElement> & { href?: undefined };

type ButtonAsLink = CommonProps & AnchorHTMLAttributes<HTMLAnchorElement> & { href: string };

type ButtonProps = ButtonAsButton | ButtonAsLink;

function isLink(props: ButtonProps): props is ButtonAsLink {
  return 'href' in props && typeof (props as ButtonAsLink).href === 'string';
}

export default function Button(props: ButtonProps) {
  const variant = props.variant ?? 'primary';
  const size = props.size ?? 'md';
  const loading = props.loading ?? false;
  const fullWidth = props.fullWidth ?? false;
  const className = props.className;
  const children = props.children;

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
  } as const;

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
  } as const;

  const classes = clsx(
    baseClasses,
    sizeClasses[size],
    variantClasses[variant],
    fullWidth && 'w-full',
    className
  );

  const content = (
    <>
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

      {!loading && props.leftIcon && (
        <span className="mr-2" aria-hidden="true">
          {props.leftIcon}
        </span>
      )}

      <span>{loading ? props.loadingText || 'Loading...' : children}</span>

      {!loading && props.rightIcon && (
        <span className="ml-2" aria-hidden="true">
          {props.rightIcon}
        </span>
      )}
    </>
  );

  if (isLink(props)) {
    const isDisabled = Boolean(loading);
    const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
      if (isDisabled) {
        e.preventDefault();
        e.stopPropagation();
      }
      // Allow consumer onClick if provided
      if (props.onClick) props.onClick(e);
    };
    return (
      <Link
        href={props.href}
        className={classes}
        aria-disabled={isDisabled}
        onClick={handleClick}
        target={props.target}
        rel={props.rel}
        title={props.title}
        id={props.id}
        role="button"
      >
        {content}
      </Link>
    );
  }

  const isDisabled = Boolean(props.disabled || loading);
  return (
    <button
      className={classes}
      disabled={isDisabled}
      aria-disabled={isDisabled}
      title={props.title}
      id={props.id}
      onClick={props.onClick}
      type={props.type}
      name={props.name}
      value={props.value}
      form={props.form}
    >
      {content}
    </button>
  );
}
