'use client';

import React from 'react';
import type { ReactNode } from 'react';

import { UILabel } from '@/components/ui';
import { cn } from '@/lib/utils';

interface FormFieldProps {
  label: string;
  children: ReactNode;
  className?: string;
  id?: string;
  error?: string;
  required?: boolean;
  helpText?: string;
}

const nativeControlClassName =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';

export default function FormField({
  label,
  children,
  className,
  id,
  error,
  required = false,
  helpText,
}: FormFieldProps) {
  // Generate a unique ID
  const generatedId = React.useId();
  const fieldId = id || generatedId;

  // If children is a React element, clone it with proper accessibility attributes
  let childElement = children;
  if (React.isValidElement(children)) {
    const element = children as React.ReactElement<Record<string, unknown>>;
    const elementType = typeof element.type === 'string' ? element.type : null;
    const isNativeControl =
      elementType === 'input' || elementType === 'select' || elementType === 'textarea';

    childElement = React.cloneElement(element, {
      ...element.props,
      id: fieldId,
      'aria-describedby': helpText || error ? `${fieldId}-description` : undefined,
      'aria-invalid': error ? 'true' : undefined,
      className: cn(
        isNativeControl && nativeControlClassName,
        element.props.className as string,
        error && 'border-destructive/20 focus:border-destructive/20 focus:ring-destructive'
      ),
    });
  }

  return (
    <div className={cn('space-y-1.5', className)}>
      <UILabel htmlFor={fieldId} className="block">
        {label}
        {required && (
          <span className="text-destructive ml-1" aria-label="required">
            *
          </span>
        )}
      </UILabel>

      {childElement}

      {(helpText || error) && (
        <div id={`${fieldId}-description`} className="text-sm">
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          {helpText && !error && <p className="text-muted-foreground">{helpText}</p>}
        </div>
      )}
    </div>
  );
}
