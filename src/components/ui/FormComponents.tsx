'use client';

import React, { forwardRef } from 'react';
import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes, ReactNode } from 'react';
import { ExclamationCircleIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import { useId } from '@/hooks/useAccessibility';

// Base form field wrapper
interface FormFieldProps {
  label?: string;
  error?: string;
  success?: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}

export function FormField({ 
  label, 
  error, 
  success, 
  hint, 
  required, 
  children, 
  className = '' 
}: FormFieldProps) {
  const fieldId = useId('form-field');
  const errorId = useId('error');
  const hintId = useId('hint');

  return (
    <div className={`space-y-1 ${className}`}>
      {label && (
        <label 
          htmlFor={fieldId} 
          className="block text-sm font-medium text-gray-700"
        >
          {label}
          {required && <span className="text-red-500 ml-1">*</span>}
        </label>
      )}
      
      <div className="relative">
        {React.cloneElement(children as React.ReactElement, {
          id: fieldId,
          'aria-describedby': [
            error ? errorId : null,
            hint ? hintId : null,
          ].filter(Boolean).join(' ') || undefined,
          'aria-invalid': error ? 'true' : undefined,
        })}
        
        {/* Status icons */}
        {(error || success) && (
          <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
            {error && (
              <ExclamationCircleIcon className="h-5 w-5 text-red-500" aria-hidden="true" />
            )}
            {success && !error && (
              <CheckCircleIcon className="h-5 w-5 text-green-500" aria-hidden="true" />
            )}
          </div>
        )}
      </div>

      {/* Error message */}
      {error && (
        <p id={errorId} className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}

      {/* Success message */}
      {success && !error && (
        <p className="text-sm text-green-600">
          {success}
        </p>
      )}

      {/* Hint text */}
      {hint && !error && (
        <p id={hintId} className="text-sm text-gray-500">
          {hint}
        </p>
      )}
    </div>
  );
}

// Input component
interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: 'sm' | 'md' | 'lg';
  variant?: 'default' | 'filled' | 'minimal';
  error?: boolean;
  success?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(({
  size = 'md',
  variant = 'default',
  error = false,
  success = false,
  className = '',
  ...props
}, ref) => {
  const sizeClasses = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-3 py-2 text-sm',
    lg: 'px-4 py-3 text-base',
  };

  const variantClasses = {
    default: 'border border-gray-300 bg-white',
    filled: 'border border-gray-300 bg-gray-50',
    minimal: 'border-0 border-b-2 border-gray-300 bg-transparent rounded-none',
  };

  const stateClasses = error 
    ? 'border-red-300 focus:border-red-500 focus:ring-red-500' 
    : success
    ? 'border-green-300 focus:border-green-500 focus:ring-green-500'
    : 'focus:border-blue-500 focus:ring-blue-500';

  const baseClasses = [
    'block w-full rounded-md shadow-sm',
    'focus:outline-none focus:ring-1',
    'disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed',
    'transition-colors duration-200',
  ].join(' ');

  return (
    <input
      ref={ref}
      className={`${baseClasses} ${sizeClasses[size]} ${variantClasses[variant]} ${stateClasses} ${className}`}
      {...props}
    />
  );
});

Input.displayName = 'Input';

// Select component
interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  size?: 'sm' | 'md' | 'lg';
  error?: boolean;
  success?: boolean;
  placeholder?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(({
  size = 'md',
  error = false,
  success = false,
  placeholder,
  className = '',
  children,
  ...props
}, ref) => {
  const sizeClasses = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-3 py-2 text-sm',
    lg: 'px-4 py-3 text-base',
  };

  const stateClasses = error 
    ? 'border-red-300 focus:border-red-500 focus:ring-red-500' 
    : success
    ? 'border-green-300 focus:border-green-500 focus:ring-green-500'
    : 'border-gray-300 focus:border-blue-500 focus:ring-blue-500';

  const baseClasses = [
    'block w-full rounded-md border bg-white shadow-sm',
    'focus:outline-none focus:ring-1',
    'disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed',
    'transition-colors duration-200',
  ].join(' ');

  return (
    <select
      ref={ref}
      className={`${baseClasses} ${sizeClasses[size]} ${stateClasses} ${className}`}
      {...props}
    >
      {placeholder && (
        <option value="" disabled>
          {placeholder}
        </option>
      )}
      {children}
    </select>
  );
});

Select.displayName = 'Select';

// Textarea component
interface TextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'size'> {
  size?: 'sm' | 'md' | 'lg';
  error?: boolean;
  success?: boolean;
  resize?: 'none' | 'vertical' | 'horizontal' | 'both';
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(({
  size = 'md',
  error = false,
  success = false,
  resize = 'vertical',
  className = '',
  ...props
}, ref) => {
  const sizeClasses = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-3 py-2 text-sm',
    lg: 'px-4 py-3 text-base',
  };

  const resizeClasses = {
    none: 'resize-none',
    vertical: 'resize-y',
    horizontal: 'resize-x',
    both: 'resize',
  };

  const stateClasses = error 
    ? 'border-red-300 focus:border-red-500 focus:ring-red-500' 
    : success
    ? 'border-green-300 focus:border-green-500 focus:ring-green-500'
    : 'border-gray-300 focus:border-blue-500 focus:ring-blue-500';

  const baseClasses = [
    'block w-full rounded-md border bg-white shadow-sm',
    'focus:outline-none focus:ring-1',
    'disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed',
    'transition-colors duration-200',
  ].join(' ');

  return (
    <textarea
      ref={ref}
      className={`${baseClasses} ${sizeClasses[size]} ${stateClasses} ${resizeClasses[resize]} ${className}`}
      {...props}
    />
  );
});

Textarea.displayName = 'Textarea';

// Checkbox component
interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string;
  description?: string;
  error?: string;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(({
  label,
  description,
  error,
  className = '',
  ...props
}, ref) => {
  const checkboxId = useId('checkbox');
  const descriptionId = useId('description');
  const errorId = useId('error');

  return (
    <div className={`relative flex items-start ${className}`}>
      <div className="flex items-center h-5">
        <input
          ref={ref}
          id={checkboxId}
          type="checkbox"
          className={`
            h-4 w-4 rounded border-gray-300 text-blue-600 
            focus:ring-blue-500 focus:ring-offset-0
            disabled:cursor-not-allowed disabled:opacity-50
            ${error ? 'border-red-300' : ''}
          `}
          aria-describedby={[
            description ? descriptionId : null,
            error ? errorId : null,
          ].filter(Boolean).join(' ') || undefined}
          {...props}
        />
      </div>
      
      {(label || description) && (
        <div className="ml-3 text-sm">
          {label && (
            <label htmlFor={checkboxId} className="font-medium text-gray-700">
              {label}
            </label>
          )}
          {description && (
            <p id={descriptionId} className="text-gray-500">
              {description}
            </p>
          )}
          {error && (
            <p id={errorId} className="text-red-600" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
});

Checkbox.displayName = 'Checkbox';

// Radio component
interface RadioProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string;
  description?: string;
}

export const Radio = forwardRef<HTMLInputElement, RadioProps>(({
  label,
  description,
  className = '',
  ...props
}, ref) => {
  const radioId = useId('radio');
  const descriptionId = useId('description');

  return (
    <div className={`relative flex items-start ${className}`}>
      <div className="flex items-center h-5">
        <input
          ref={ref}
          id={radioId}
          type="radio"
          className="h-4 w-4 border-gray-300 text-blue-600 focus:ring-blue-500 focus:ring-offset-0"
          aria-describedby={description ? descriptionId : undefined}
          {...props}
        />
      </div>
      
      {(label || description) && (
        <div className="ml-3 text-sm">
          {label && (
            <label htmlFor={radioId} className="font-medium text-gray-700">
              {label}
            </label>
          )}
          {description && (
            <p id={descriptionId} className="text-gray-500">
              {description}
            </p>
          )}
        </div>
      )}
    </div>
  );
});

Radio.displayName = 'Radio';

export default {
  FormField,
  Input,
  Select,
  Textarea,
  Checkbox,
  Radio,
};
