const URL_PATTERN = /(https?:\/\/[^\s<]+)/gi;

interface SafeSocialTextProps {
  value: string;
  className?: string;
}

function safeExternalUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export default function SafeSocialText({
  value,
  className = '',
}: SafeSocialTextProps): React.JSX.Element {
  const parts = value.split(URL_PATTERN);

  return (
    <p className={`whitespace-pre-wrap break-words text-sm leading-6 text-foreground ${className}`}>
      {parts.map((part, index) => {
        const href = safeExternalUrl(part);
        if (!href) return <span key={`${index}:${part}`}>{part}</span>;
        return (
          <a
            key={`${index}:${part}`}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {part}
          </a>
        );
      })}
    </p>
  );
}
