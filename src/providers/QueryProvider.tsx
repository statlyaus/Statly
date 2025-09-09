'use client';

import { useState, type ReactNode } from 'react';
import {
  Hydrate,
  QueryClient,
  QueryClientProvider,
  type DehydratedState,
} from '@tanstack/react-query';

interface Props {
  children: ReactNode;
  state?: DehydratedState;
}

export function QueryProvider({ children, state }: Props) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            gcTime: 5 * 60_000,
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={client}>
      <Hydrate state={state}>{children}</Hydrate>
    </QueryClientProvider>
  );
}