import React from 'react';

interface LoadingStateProps {
  message?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function LoadingState({
  message = 'Loading...',
  size = 'md',
  className = '',
}: LoadingStateProps) {
  const sizeClasses = {
    sm: 'h-4 w-4',
    md: 'h-6 w-6',
    lg: 'h-8 w-8',
  };

  return (
    <div className={`flex items-center justify-center p-4 ${className}`}>
      <div
        className={`mr-2 animate-spin rounded-full border-b-2 border-primary ${sizeClasses[size]}`}
      />
      <span className="text-muted-foreground">{message}</span>
    </div>
  );
}

export default LoadingState;
