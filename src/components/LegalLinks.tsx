import Button from '@/components/Button';

interface LegalLinksProps {
  prefix: string;
  className?: string;
}

export default function LegalLinks({ prefix, className = '' }: LegalLinksProps) {
  return (
    <div className={`text-center ${className}`}>
      <p className="text-sm text-slate-500 dark:text-slate-400">
        {prefix}{' '}
        <Button href="/terms" variant="ghost" className="p-0 h-auto text-sm underline">
          Terms of Service
        </Button>{' '}
        and{' '}
        <Button href="/privacy" variant="ghost" className="p-0 h-auto text-sm underline">
          Privacy Policy
        </Button>
      </p>
    </div>
  );
}
