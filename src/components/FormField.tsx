'use client';

import React from 'react';
import clsx from 'clsx';
import type { ReactNode } from 'react';

interface FormFieldProps {
  label: string;
  children: ReactNode;
  className?: string;
  id?: string;
  error?: string;
  required?: boolean;
  helpText?: string;
}

export default function FormField({ 
  label, 
  children, 
  className,
  id,
  error,
  required = false,
  helpText
}: FormFieldProps) {
  // Generate a unique ID
  const generatedId = React.useId();
  const fieldId = id || generatedId;
  
  // If children is a React element, clone it with proper accessibility attributes
  let childElement = children;
  if (React.isValidElement(children)) {
    const element = children as React.ReactElement<Record<string, unknown>>;
    childElement = React.cloneElement(element, {
      ...element.props,
      id: fieldId,
      'aria-describedby': helpText || error ? `${fieldId}-description` : undefined,
      'aria-invalid': error ? 'true' : undefined,
      className: clsx(
        element.props.className as string,
        error && 'border-red-500 focus:border-red-500 focus:ring-red-500'
      )
    });
  }

  return (
    <div className={clsx('space-y-1', className)}>
      <label 
        htmlFor={fieldId}
        className="block text-sm font-medium text-gray-700"
      >
        {label}
        {required && (
          <span className="text-red-500 ml-1" aria-label="required">
            *
          </span>
        )}
      </label>
      
      {childElement}
      
      {(helpText || error) && (
        <div id={`${fieldId}-description`} className="text-sm">
          {error && (
            <p className="text-red-600" role="alert">
              {error}
            </p>
          )}
          {helpText && !error && (
            <p className="text-gray-600">
              {helpText}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
