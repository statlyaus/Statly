import Link from 'next/link';

import { textLinkStyles } from '@/components/ui/controlStyles';

interface LegalLinksProps {
  prefix: string;
  className?: string;
}

export default function LegalLinks({ prefix, className = '' }: LegalLinksProps) {
  return (
    <div className={`text-center ${className}`}>
      <p className="text-sm text-muted-foreground">
        {prefix}{' '}
        <Link href="/terms" className={textLinkStyles}>
          Terms of Service
        </Link>{' '}
        and{' '}
        <Link href="/privacy" className={textLinkStyles}>
          Privacy Policy
        </Link>
      </p>
    </div>
  );
}
