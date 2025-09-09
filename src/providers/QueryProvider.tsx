'use client';

import React, { ReactNode, useState } from 'react';
import {
  Hydrate,
  QueryClient,
  QueryClientProvider,
  DehydratedState,
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
