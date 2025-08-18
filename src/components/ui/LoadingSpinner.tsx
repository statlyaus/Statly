'use client';

import React from 'react';
import type { ReactNode } from 'react';
import { motion } from 'framer-motion';

// Spinner types
export type SpinnerType = 'circular' | 'dots' | 'pulse' | 'bars' | 'football' | 'wave';

// Spinner sizes
export type SpinnerSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

// Spinner colors
export type SpinnerColor = 'blue' | 'green' | 'red' | 'yellow' | 'purple' | 'gray' | 'white';

// Component props
interface LoadingSpinnerProps {
  type?: SpinnerType;
  size?: SpinnerSize;
  color?: SpinnerColor;
  text?: string;
  overlay?: boolean;
  className?: string;
  children?: ReactNode;
}

// Size configurations
const SIZE_CONFIG = {
  xs: { spinner: 'w-4 h-4', text: 'text-xs', container: 'gap-2' },
  sm: { spinner: 'w-6 h-6', text: 'text-sm', container: 'gap-2' },
  md: { spinner: 'w-8 h-8', text: 'text-base', container: 'gap-3' },
  lg: { spinner: 'w-12 h-12', text: 'text-lg', container: 'gap-4' },
  xl: { spinner: 'w-16 h-16', text: 'text-xl', container: 'gap-4' },
};

// Color configurations
const COLOR_CONFIG = {
  blue: 'text-blue-600 border-blue-600',
  green: 'text-green-600 border-green-600',
  red: 'text-red-600 border-red-600',
  yellow: 'text-yellow-600 border-yellow-600',
  purple: 'text-purple-600 border-purple-600',
  gray: 'text-gray-600 border-gray-600',
  white: 'text-white border-white',
};

// Circular spinner component
function CircularSpinner({ size, color }: { size: SpinnerSize; color: SpinnerColor }) {
  const sizeClass = SIZE_CONFIG[size].spinner;
  const colorClass = COLOR_CONFIG[color];

  return (
    <div
      className={`animate-spin rounded-full border-2 border-t-transparent ${sizeClass} ${colorClass}`}
    />
  );
}

// Dots spinner component
function DotsSpinner({ size, color }: { size: SpinnerSize; color: SpinnerColor }) {
  const dotSize = {
    xs: 'w-1 h-1',
    sm: 'w-1.5 h-1.5',
    md: 'w-2 h-2',
    lg: 'w-3 h-3',
    xl: 'w-4 h-4',
  }[size];

  const bgColor = COLOR_CONFIG[color].split(' ')[0].replace('text-', 'bg-');

  return (
    <div className="flex space-x-1">
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          className={`${dotSize} ${bgColor} rounded-full`}
          animate={{
            scale: [1, 1.2, 1],
            opacity: [0.5, 1, 0.5],
          }}
          transition={{
            duration: 1,
            repeat: Infinity,
            delay: i * 0.2,
          }}
        />
      ))}
    </div>
  );
}

// Pulse spinner component
function PulseSpinner({ size, color }: { size: SpinnerSize; color: SpinnerColor }) {
  const sizeClass = SIZE_CONFIG[size].spinner;
  const bgColor = COLOR_CONFIG[color].split(' ')[0].replace('text-', 'bg-');

  return (
    <motion.div
      className={`${sizeClass} ${bgColor} rounded-full`}
      animate={{
        scale: [1, 1.2, 1],
        opacity: [0.8, 0.4, 0.8],
      }}
      transition={{
        duration: 1.5,
        repeat: Infinity,
      }}
    />
  );
}

// Bars spinner component
function BarsSpinner({ size, color }: { size: SpinnerSize; color: SpinnerColor }) {
  const barHeight = {
    xs: 'h-4',
    sm: 'h-6',
    md: 'h-8',
    lg: 'h-12',
    xl: 'h-16',
  }[size];

  const barWidth = {
    xs: 'w-0.5',
    sm: 'w-1',
    md: 'w-1',
    lg: 'w-1.5',
    xl: 'w-2',
  }[size];

  const bgColor = COLOR_CONFIG[color].split(' ')[0].replace('text-', 'bg-');

  return (
    <div className="flex items-end space-x-1">
      {[0, 1, 2, 3].map((i) => (
        <motion.div
          key={i}
          className={`${barWidth} ${barHeight} ${bgColor} rounded-sm`}
          animate={{
            scaleY: [1, 0.4, 1],
          }}
          transition={{
            duration: 0.8,
            repeat: Infinity,
            delay: i * 0.1,
          }}
        />
      ))}
    </div>
  );
}

// Football spinner component (sports-themed)
function FootballSpinner({ size, color }: { size: SpinnerSize; color: SpinnerColor }) {
  const sizeClass = SIZE_CONFIG[size].spinner;
  const colorClass = COLOR_CONFIG[color];

  return (
    <motion.div
      className={`${sizeClass} ${colorClass} flex items-center justify-center`}
      animate={{ rotate: 360 }}
      transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
    >
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-full h-full">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14.5v-3L8 12l3-1.5v-3l6 3.5-6 3.5z" />
      </svg>
    </motion.div>
  );
}

// Wave spinner component
function WaveSpinner({ size, color }: { size: SpinnerSize; color: SpinnerColor }) {
  const dotSize = {
    xs: 'w-1 h-1',
    sm: 'w-1.5 h-1.5',
    md: 'w-2 h-2',
    lg: 'w-3 h-3',
    xl: 'w-4 h-4',
  }[size];

  const bgColor = COLOR_CONFIG[color].split(' ')[0].replace('text-', 'bg-');

  return (
    <div className="flex space-x-1">
      {[0, 1, 2, 3, 4].map((i) => (
        <motion.div
          key={i}
          className={`${dotSize} ${bgColor} rounded-full`}
          animate={{
            y: [-4, 4, -4],
          }}
          transition={{
            duration: 1.2,
            repeat: Infinity,
            delay: i * 0.1,
          }}
        />
      ))}
    </div>
  );
}

// Main spinner component
function Spinner({
  type,
  size,
  color,
}: {
  type: SpinnerType;
  size: SpinnerSize;
  color: SpinnerColor;
}) {
  switch (type) {
    case 'dots':
      return <DotsSpinner size={size} color={color} />;
    case 'pulse':
      return <PulseSpinner size={size} color={color} />;
    case 'bars':
      return <BarsSpinner size={size} color={color} />;
    case 'football':
      return <FootballSpinner size={size} color={color} />;
    case 'wave':
      return <WaveSpinner size={size} color={color} />;
    default:
      return <CircularSpinner size={size} color={color} />;
  }
}

// Main loading spinner component
export default function LoadingSpinner({
  type = 'circular',
  size = 'md',
  color = 'blue',
  text,
  overlay = false,
  className = '',
  children,
}: LoadingSpinnerProps) {
  const sizeConfig = SIZE_CONFIG[size];

  const content = (
    <div
      className={`flex flex-col items-center justify-center ${sizeConfig.container} ${className}`}
    >
      <Spinner type={type} size={size} color={color} />
      {text && <p className={`${sizeConfig.text} text-gray-600 text-center`}>{text}</p>}
      {children}
    </div>
  );

  if (overlay) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <div className="absolute inset-0 bg-black bg-opacity-50" />
        <div className="relative bg-white rounded-lg p-8 shadow-lg">{content}</div>
      </div>
    );
  }

  return content;
}

// Inline loading component for buttons and small spaces
interface InlineLoadingProps {
  size?: 'xs' | 'sm' | 'md';
  color?: SpinnerColor;
  text?: string;
  className?: string;
}

export function InlineLoading({
  size = 'sm',
  color = 'blue',
  text,
  className = '',
}: InlineLoadingProps) {
  return (
    <div className={`inline-flex items-center space-x-2 ${className}`}>
      <CircularSpinner size={size} color={color} />
      {text && <span className="text-sm text-gray-600">{text}</span>}
    </div>
  );
}

// Page loading component
interface PageLoadingProps {
  title?: string;
  subtitle?: string;
  type?: SpinnerType;
  color?: SpinnerColor;
  className?: string;
}

export function PageLoading({
  title = 'Loading...',
  subtitle,
  type = 'football',
  color = 'blue',
  className = '',
}: PageLoadingProps) {
  return (
    <div className={`min-h-screen flex items-center justify-center bg-gray-50 ${className}`}>
      <div className="text-center">
        <LoadingSpinner type={type} size="xl" color={color} />
        <h2 className="mt-6 text-2xl font-semibold text-gray-900">{title}</h2>
        {subtitle && <p className="mt-2 text-gray-600">{subtitle}</p>}
      </div>
    </div>
  );
}

// Section loading component
interface SectionLoadingProps {
  height?: string;
  title?: string;
  type?: SpinnerType;
  color?: SpinnerColor;
  className?: string;
}

export function SectionLoading({
  height = 'h-64',
  title = 'Loading...',
  type = 'circular',
  color = 'blue',
  className = '',
}: SectionLoadingProps) {
  return (
    <div
      className={`${height} flex items-center justify-center bg-white rounded-lg border border-gray-200 ${className}`}
    >
      <LoadingSpinner type={type} size="lg" color={color} text={title} />
    </div>
  );
}

// Button loading state
interface ButtonLoadingProps {
  loading?: boolean;
  children: ReactNode;
  size?: 'xs' | 'sm' | 'md';
  color?: SpinnerColor;
  className?: string;
  disabled?: boolean;
  [key: string]: unknown;
}

export function ButtonWithLoading({
  loading = false,
  children,
  size = 'sm',
  color = 'white',
  className = '',
  disabled = false,
  ...props
}: ButtonLoadingProps) {
  return (
    <button disabled={disabled || loading} className={`relative ${className}`} {...props}>
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <CircularSpinner size={size} color={color} />
        </div>
      )}
      <span className={loading ? 'invisible' : ''}>{children}</span>
    </button>
  );
}

// Skeleton loading component
interface SkeletonProps {
  width?: string;
  height?: string;
  rounded?: boolean;
  className?: string;
}

export function Skeleton({
  width = 'w-full',
  height = 'h-4',
  rounded = false,
  className = '',
}: SkeletonProps) {
  return (
    <div
      className={`animate-pulse bg-gray-200 ${width} ${height} ${
        rounded ? 'rounded-full' : 'rounded'
      } ${className}`}
    />
  );
}

// Skeleton text component
interface SkeletonTextProps {
  lines?: number;
  className?: string;
}

export function SkeletonText({ lines = 3, className = '' }: SkeletonTextProps) {
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} width={i === lines - 1 ? 'w-3/4' : 'w-full'} height="h-4" />
      ))}
    </div>
  );
}

// Card skeleton component
export function SkeletonCard({ className = '' }: { className?: string }) {
  return (
    <div className={`bg-white rounded-lg border border-gray-200 p-6 ${className}`}>
      <div className="flex items-center space-x-4 mb-4">
        <Skeleton width="w-12" height="h-12" rounded />
        <div className="flex-1">
          <Skeleton width="w-1/2" height="h-5" className="mb-2" />
          <Skeleton width="w-1/3" height="h-4" />
        </div>
      </div>
      <SkeletonText lines={3} />
    </div>
  );
}

// Standardized page loading states
export function PageLoadingSkeleton() {
  return (
    <div className="container-full">
      <div className="page-header">
        <Skeleton className="w-1/3 h-8 mb-2" />
        <Skeleton className="w-1/2 h-4" />
      </div>

      <div className="page-content">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 card-padding">
          <Skeleton className="w-1/4 h-6 mb-4" />
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="w-full h-4" />
            ))}
          </div>
        </div>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="bg-white rounded-lg shadow-sm border border-gray-200 card-padding">
              <Skeleton className="w-3/4 h-6 mb-3" />
              <Skeleton className="w-full h-4 mb-2" />
              <Skeleton className="w-2/3 h-4" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Table loading skeleton
export function TableLoadingSkeleton({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="bg-gray-50 table-header-padding">
        <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
          {[...Array(columns)].map((_, i) => (
            <Skeleton key={i} className="w-3/4 h-4" />
          ))}
        </div>
      </div>

      {/* Rows */}
      <div className="divide-y divide-gray-200">
        {[...Array(rows)].map((_, i) => (
          <div key={i} className="table-cell-padding">
            <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
              {[...Array(columns)].map((_, j) => (
                <Skeleton key={j} className="w-full h-4" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
