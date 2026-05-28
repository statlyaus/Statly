'use client';

import { useEffect, useState } from 'react';

import Link from 'next/link';

interface LegalLinksProps {
  prefix: string;
  className?: string;
}

export default function LegalLinks({ prefix, className = '' }: LegalLinksProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div className={`min-h-5 text-center ${className}`} aria-hidden="true" />;
  }

  return (
    <div className={`text-center ${className}`}>
      <p className="text-sm text-muted-foreground">
        <span>{prefix} </span>
        <Link
          href="/terms"
          className="font-medium underline underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Terms of Service
        </Link>
        <span> and </span>
        <Link
          href="/privacy"
          className="font-medium underline underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Privacy Policy
        </Link>
      </p>
    </div>
  );
}
