import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';

import { getAuthenticatedUserIdFromServerContext } from '@/lib/serverAuth';
import { canUseBasketball } from '@/server/basketball/basketballAccess';

/**
 * Fantasy basketball is private to an allow-list until its NBA data is licensed (see
 * docs/domain/basketball.md). Anyone else gets the (app) not-found page, as for a page that does not
 * exist.
 */
export default async function BasketballLayout({ children }: { readonly children: ReactNode }) {
  if (!canUseBasketball(await getAuthenticatedUserIdFromServerContext())) notFound();
  return children;
}
