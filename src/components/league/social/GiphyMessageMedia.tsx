'use client';

import { Expand, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import type { SocialGif } from '@/types/social';

import { getGiphyClient, type GiphyGif } from './giphyClient';

interface GiphyMessageMediaProps {
  gif: SocialGif;
}

function getGifImage(gif: GiphyGif): { url: string; width: number; height: number } | null {
  const image = gif.images.downsized_medium ?? gif.images.original;
  if (!image?.url) return null;

  return {
    url: image.url,
    width: Number(image.width) || 480,
    height: Number(image.height) || 360,
  };
}

export default function GiphyMessageMedia({ gif }: GiphyMessageMediaProps): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const expandButtonRef = useRef<HTMLButtonElement>(null);
  const [resolvedGif, setResolvedGif] = useState<GiphyGif | null>(null);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const giphyUrl = `https://giphy.com/gifs/${encodeURIComponent(gif.id)}`;

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
        if (cancelled) return;
        if (getGifImage(data)) {
          setResolvedGif(data);
        } else {
          setFailed(true);
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [gif.id]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (expanded && !dialog.open) {
      dialog.showModal();
    } else if (!expanded && dialog.open) {
      dialog.close();
    }
  }, [expanded]);

  const resolvedImage = resolvedGif ? getGifImage(resolvedGif) : null;
  const imageAlt = resolvedGif?.title?.trim() || 'GIF';

  return (
    <div className="mt-2 max-w-[22.5rem]">
      {resolvedGif && resolvedImage ? (
        <>
          <div className="ground-white relative max-h-60 overflow-hidden bg-accent">
            <img
              src={resolvedImage.url}
              alt={imageAlt}
              width={resolvedImage.width}
              height={resolvedImage.height}
              loading="lazy"
              decoding="async"
              className="max-h-60 w-full object-cover"
            />
            <button
              ref={expandButtonRef}
              type="button"
              onClick={() => setExpanded(true)}
              className="ground-white absolute bottom-2 right-2 inline-flex min-h-9 items-center gap-1.5 rounded-cut border border-border bg-card px-3 text-xs font-semibold text-foreground transition-colors hover:bg-secondary active:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Expand GIF"
            >
              <Expand className="size-3.5" aria-hidden="true" />
              Expand
            </button>
          </div>
          <dialog
            ref={dialogRef}
            aria-labelledby={`giphy-preview-${gif.id}`}
            onCancel={() => setExpanded(false)}
            onClose={() => {
              setExpanded(false);
              expandButtonRef.current?.focus();
            }}
            className="ground-white m-auto max-h-[90dvh] w-[min(44rem,calc(100vw-2rem))] max-w-none rounded-cut-float border-[2.5px] border-foreground bg-card p-0 text-foreground shadow-hard backdrop:bg-overlay"
          >
            <div className="flex min-h-14 items-center justify-between gap-3 border-b border-border px-4">
              <h2 id={`giphy-preview-${gif.id}`} className="text-sm font-semibold">
                GIF preview
              </h2>
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="inline-flex size-10 items-center justify-center rounded-cut text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground active:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Close GIF preview"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
            <div className="max-h-[calc(90dvh-3.5rem)] overflow-auto p-4">
              <div className="mx-auto max-w-2xl overflow-hidden bg-accent">
                <img
                  src={resolvedImage.url}
                  alt={imageAlt}
                  width={resolvedImage.width}
                  height={resolvedImage.height}
                  decoding="async"
                  className="h-auto w-full"
                />
              </div>
              <a
                href="https://giphy.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 block text-right text-xs font-bold tracking-wide text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Powered by GIPHY
              </a>
            </div>
          </dialog>
        </>
      ) : failed ? (
        <a
          href={giphyUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="ground-white inline-flex min-h-10 items-center rounded-cut border border-border bg-accent px-3 text-sm font-semibold text-foreground underline-offset-4 transition-colors hover:bg-secondary hover:underline active:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          View GIF on GIPHY
        </a>
      ) : (
        <div
          role="status"
          className="ground-white flex aspect-video items-center justify-center bg-accent text-sm text-muted-foreground"
        >
          Loading GIF…
        </div>
      )}
      {resolvedGif && resolvedImage ? (
        <a
          href="https://giphy.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 block text-right text-[11px] font-bold tracking-wide underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 text-muted-foreground hover:text-foreground focus-visible:ring-ring"
        >
          Powered by GIPHY
        </a>
      ) : null}
    </div>
  );
}
