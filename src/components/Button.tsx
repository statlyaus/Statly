'use client';

import type { ButtonHTMLAttributes, AnchorHTMLAttributes, ReactNode, MouseEvent } from 'react';
import Link from 'next/link';
import { buttonStyles } from '@/components/ui/controlStyles';
import { cn } from '@/lib/utils';

interface CommonProps {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  loading?: boolean;
  loadingText?: string;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  fullWidth?: boolean;
}

type ButtonAsButton = CommonProps & ButtonHTMLAttributes<HTMLButtonElement> & { href?: undefined };

type ButtonAsLink = CommonProps & AnchorHTMLAttributes<HTMLAnchorElement> & { href: string };

type ButtonProps = ButtonAsButton | ButtonAsLink;

const VARIANT_STYLE = {
  primary: 'primary',
  secondary: 'outline',
  danger: 'danger',
  ghost: 'ghost',
} as const;

function isLink(props: ButtonProps): props is ButtonAsLink {
  return 'href' in props && typeof (props as ButtonAsLink).href === 'string';
}

function getButtonClasses(props: ButtonProps): string {
  return cn(
    buttonStyles({
      variant: VARIANT_STYLE[props.variant ?? 'primary'],
      size: props.size ?? 'md',
    }),
    props.fullWidth && 'w-full',
    props.className
  );
}

function ButtonContent({
  loading,
  loadingText,
  leftIcon,
  rightIcon,
  children,
}: Pick<CommonProps, 'loading' | 'loadingText' | 'leftIcon' | 'rightIcon'> & {
  children: ReactNode;
}) {
  return (
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

      {!loading && leftIcon && (
        <span className="mr-2" aria-hidden="true">
          {leftIcon}
        </span>
      )}

      <span>{loading ? loadingText || 'Loading...' : children}</span>

      {!loading && rightIcon && (
        <span className="ml-2" aria-hidden="true">
          {rightIcon}
        </span>
      )}
    </>
  );
}

function LinkButton({
  props,
  classes,
  loading,
  children,
}: {
  props: ButtonAsLink;
  classes: string;
  loading: boolean;
  children: ReactNode;
}) {
  const isDisabled = Boolean(props.disabled || loading);
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (isDisabled) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    props.onClick?.(event);
  };

  return (
    <Link
      href={props.href}
      className={cn(classes, isDisabled && 'cursor-not-allowed opacity-50')}
      aria-disabled={isDisabled}
      onClick={handleClick}
      tabIndex={isDisabled ? -1 : props.tabIndex}
      target={props.target}
      rel={props.rel}
      title={props.title}
      id={props.id}
      role="button"
    >
      {children}
    </Link>
  );
}

function NativeButton({
  props,
  classes,
  loading,
  children,
}: {
  props: ButtonAsButton;
  classes: string;
  loading: boolean;
  children: ReactNode;
}) {
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
      {children}
    </button>
  );
}

export default function Button(props: ButtonProps) {
  const loading = props.loading ?? false;
  const classes = getButtonClasses(props);

  const content = (
    <ButtonContent
      loading={loading}
      loadingText={props.loadingText}
      leftIcon={props.leftIcon}
      rightIcon={props.rightIcon}
    >
      {props.children}
    </ButtonContent>
  );

  if (isLink(props)) {
    return (
      <LinkButton props={props} classes={classes} loading={loading}>
        {content}
      </LinkButton>
    );
  }

  return (
    <NativeButton props={props} classes={classes} loading={loading}>
      {content}
    </NativeButton>
  );
}
