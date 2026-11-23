'use client';

import type React from 'react';
import { useSyncExternalStore } from 'react';

import { alertStyles, buttonStyles } from '@/components/ui/controlStyles';
import { withSafeNext } from '@/lib/safeRedirect';
import { isSignInExpired, subscribeSignInExpiry } from '@/lib/signInExpiry';

/** The login page returns a signed-in user to `next`; anything not a same-site path is dropped. */
export function loginHrefFor(pathname: string, search: string): string {
  return withSafeNext('/login', `${pathname}${search}`);
}

function currentLoginHref(): string {
  return loginHrefFor(window.location.pathname, window.location.search);
}

/**
 * The one app-wide notice that the signed-in user's credential stopped working (raised by the
 * shared request helpers after a forced token refresh failed). It sits in the page flow at the top
 * of the app shell, so it never covers the focused control, and announces itself without taking
 * focus. "Sign in again" is a full page load to the login page, which brings the user back here.
 */
export default function SignInExpiredPrompt(): React.ReactNode {
  const expired = useSyncExternalStore(subscribeSignInExpiry, isSignInExpired, () => false);
  if (!expired) return null;

  return (
    <div
      role="alert"
      className={`flex flex-col gap-3 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between ${alertStyles({ tone: 'error' })}`}
    >
      <p>
        <strong className="font-semibold">Your sign-in has expired.</strong> Sign in again to carry
        on. You will come back to this page.
      </p>
      <a
        href={currentLoginHref()}
        // The user may have moved on since the notice appeared; send them back to where they are now.
        onClick={(event) => {
          event.currentTarget.href = currentLoginHref();
        }}
        className={`shrink-0 ${buttonStyles({ variant: 'primary', size: 'sm' })}`}
      >
        Sign in again
      </a>
    </div>
  );
}
