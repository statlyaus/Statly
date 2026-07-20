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
    <p
      className={`whitespace-pre-wrap break-words text-sm leading-6 text-social-text ${className}`}
    >
      {parts.map((part, index) => {
        const href = safeExternalUrl(part);
        if (!href) return <span key={`${index}:${part}`}>{part}</span>;
        return (
          <a
            key={`${index}:${part}`}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-social-action underline decoration-social-action underline-offset-2 transition-colors hover:text-social-action-hover active:text-social-action-pressed focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-social-focus"
          >
            {part}
          </a>
        );
      })}
    </p>
  );
}
