'use client';

import { Gif } from '@giphy/react-components';
import { useEffect, useRef, useState } from 'react';

import type { SocialGif } from '@/types/social';

import { getGiphyClient, type GiphyGif } from './giphyClient';

interface GiphyMessageMediaProps {
  gif: SocialGif;
}

export default function GiphyMessageMedia({ gif }: GiphyMessageMediaProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const [resolvedGif, setResolvedGif] = useState<GiphyGif | null>(null);
  const [width, setWidth] = useState(320);
  const [failed, setFailed] = useState(false);
  const giphyUrl = `https://giphy.com/gifs/${encodeURIComponent(gif.id)}`;

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const updateWidth = () => {
      setWidth(
        Math.min(360, Math.max(200, Math.floor(element.getBoundingClientRect().width || 320)))
      );
    };
    updateWidth();

    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const client = getGiphyClient();
    if (!client) {
      setFailed(true);
      return;
    }

    let cancelled = false;
    setResolvedGif(null);
    setFailed(false);
    void client
      .gif(gif.id)
      .then(({ data }) => {
        if (!cancelled) setResolvedGif(data);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [gif.id]);

  return (
    <div ref={containerRef} className="mt-2 max-w-[22.5rem]">
      {resolvedGif ? (
        <Gif gif={resolvedGif} width={width} percentWidth="100%" borderRadius={10} />
      ) : failed ? (
        <a
          href={giphyUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-10 items-center rounded-lg border border-border bg-muted px-3 text-sm font-semibold text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          View GIF on GIPHY
        </a>
      ) : (
        <div
          role="status"
          className="flex aspect-video items-center justify-center rounded-xl bg-muted text-sm text-muted-foreground"
        >
          Loading GIF…
        </div>
      )}
      {resolvedGif ? (
        <a
          href="https://giphy.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 block text-right text-[10px] font-bold tracking-wide text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Powered by GIPHY
        </a>
      ) : null}
    </div>
  );
}
