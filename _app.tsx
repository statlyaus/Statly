import React from 'react';
import type { AppProps } from 'next/app';
import { AuthProvider } from '@/AuthContext';
// If you have global styles, they should be imported here:
// import '@/styles/globals.css';

function MyApp({ Component, pageProps }: AppProps) {
  return (
    <AuthProvider>
      <Component {...pageProps} />
    </AuthProvider>
  );
}

export default MyApp;