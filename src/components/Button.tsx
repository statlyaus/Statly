'use client';

import type { ButtonHTMLAttributes, AnchorHTMLAttributes, ReactNode, MouseEvent } from 'react';

import Link from 'next/link';
import { Loader2 } from 'lucide-react';

import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

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

  const classes = cn(buttonVariants({ variant, size, fullWidth }), className);

  const content = (
    <>
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}

      {!loading && props.leftIcon && <span aria-hidden="true">{props.leftIcon}</span>}

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
