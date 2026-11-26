'use client';

import { Fragment, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

import { buttonStyles, chipStyles } from '@/components/ui/controlStyles';

import { DAWSON_SEASONS } from './dawsonExample';
import { StepVisual } from './ExplainerVisuals';
import { REFERENCES, STAGES, STEPS } from './explainerSteps';

/*
 * "How Statly values trades" (/afl/trades/method, owner 2026-11-20): a click-through story that
 * follows Jordan Dawson through PAV to his trade's value line. Like a slide, it is laid out once at a
 * fixed size and scaled to fit the screen below the site header, so nothing scrolls. Phones get the
 * stacked layout, which scrolls with the page.
 */

const DESIGN_W = 1180;
const DESIGN_H = 880;
const PHONE_MAX = 768;
/** Below this the slide's text is too small to read, so short screens get the stacked layout too. */
const MIN_SCALE = 0.6;

/**
 * `stacked` is null until measured: the server render and first paint use the md breakpoint, so
 * phones get the stacked layout without JavaScript.
 */
function useFitToScreen() {
  const ref = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ scale: number; stacked: boolean | null }>({
    scale: 1,
    stacked: null,
  });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const header = el.getBoundingClientRect().top + window.scrollY;
      const scale = Math.min(
        1.25,
        (el.clientWidth - 32) / DESIGN_W,
        (window.innerHeight - header - 24) / DESIGN_H
      );
      const stacked = window.innerWidth < PHONE_MAX || scale < MIN_SCALE;
      setFit({ stacked, scale: stacked ? 1 : scale });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);
  return { ref, ...fit };
}

/** Turns [1] markers in copy into superscript citation numbers linking to the references. */
function cite(text: string): ReactNode {
  return text.split(/((?:\[\d\])+)/u).map((part, i) => {
    const nums = [...part.matchAll(/\[(\d)\]/gu)].map((m) => m[1]);
    if (nums.length === 0 || part.replace(/\[\d\]/gu, '') !== '') return part;
    return (
      <sup key={i} className="ml-0.5 font-display text-[11px] font-bold text-primary">
        {nums.map((n, j) => (
          <Fragment key={n}>
            {j > 0 && ','}
            <a href={`#ref-${n}`} aria-label={`Reference ${n}`}>
              {n}
            </a>
          </Fragment>
        ))}
      </sup>
    );
  });
}

function References() {
  return (
    <ol
      className="grid shrink-0 grid-cols-1 gap-x-6 gap-y-1 text-[11px] leading-snug text-muted-foreground md:grid-cols-2"
      aria-label="References"
    >
      {REFERENCES.map((r) => (
        <li key={r.n} id={`ref-${r.n}`} className="flex gap-1.5">
          <span className="font-display font-bold text-primary">{r.n}</span>
          <span>
            {r.text}
            {r.href && (
              <>
                {' '}
                <a className="underline underline-offset-2" href={r.href}>
                  {r.href.replace(/^https:\/\/(www\.)?/u, '')}
                </a>
              </>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Progress({ step, onPick }: { step: number; onPick: (n: number) => void }) {
  const current = STEPS[step];
  return (
    <>
      <div className="grid shrink-0 gap-1.5 border-b-2 border-foreground bg-warning px-4 py-2 text-warning-foreground md:hidden">
        <span className="font-display text-[13px] font-semibold">
          {STAGES.find((x) => x.stage === current?.stage)?.label}
        </span>
        <span className="flex gap-0.5">
          {STEPS.map((s, i) => (
            <i
              key={s.short}
              className={`h-1.5 flex-1 ${i <= step ? 'bg-foreground' : 'bg-foreground/20'}`}
            />
          ))}
        </span>
      </div>
      <nav
        className="hidden shrink-0 grid-cols-7 border-b-2 border-foreground md:grid"
        aria-label="Steps"
      >
        {STAGES.map(({ stage, label }) => {
          const idx = STEPS.flatMap((s, i) => (s.stage === stage ? [i] : []));
          const firstIdx = idx[0] ?? 0;
          const lastIdx = idx[idx.length - 1] ?? 0;
          const active = idx.includes(step);
          const ground = active
            ? 'bg-warning text-warning-foreground'
            : lastIdx < step
              ? 'bg-accent'
              : 'bg-card hover:bg-muted';
          return (
            <button
              key={stage}
              type="button"
              onClick={() => onPick(firstIdx)}
              aria-current={active ? 'step' : undefined}
              className={`grid cursor-pointer gap-1.5 border-r border-border px-3 py-2 text-left last:border-r-0 ${ground}`}
            >
              <span className="truncate font-display text-[13px] font-semibold">{label}</span>
              <span className="flex gap-1">
                {idx.map((i) => (
                  <i
                    key={i}
                    className={`h-1.5 flex-1 ${i <= step ? 'bg-foreground' : 'bg-border'}`}
                  />
                ))}
              </span>
            </button>
          );
        })}
      </nav>
    </>
  );
}

/** Layout classes by mode; each string is literal so Tailwind sees it. */
const LAYOUT = {
  unmeasured: {
    outer: 'md:h-[calc(100dvh-4rem-1px)] md:overflow-hidden',
    inner:
      'max-md:p-4 md:absolute md:left-1/2 md:top-1/2 md:h-[880px] md:w-[1180px] md:[transform:translate(-50%,-50%)_scale(var(--fit))]',
    footer: 'max-md:sticky max-md:bottom-0 max-md:z-10',
    short: 'md:hidden',
    long: 'max-md:hidden',
  },
  stacked: { outer: '', inner: 'p-4', footer: 'sticky bottom-0 z-10', short: '', long: 'hidden' },
  slide: {
    outer: 'h-[calc(100dvh-4rem-1px)] overflow-hidden',
    inner:
      'absolute left-1/2 top-1/2 h-[880px] w-[1180px] [transform:translate(-50%,-50%)_scale(var(--fit))]',
    footer: '',
    short: 'hidden',
    long: '',
  },
} as const;

export function TradeMethodExplainer() {
  const [season, setSeason] = useState(2025);
  const [step, setStep] = useState(0);
  const fit = useFitToScreen();
  const sectionRef = useRef<HTMLElement>(null);
  const layout = LAYOUT[fit.stacked === null ? 'unmeasured' : fit.stacked ? 'stacked' : 'slide'];
  // The arrow keys step through the story from anywhere on the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === 'ArrowRight') setStep((n) => Math.min(STEPS.length - 1, n + 1));
      if (e.key === 'ArrowLeft') setStep((n) => Math.max(0, n - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const d = DAWSON_SEASONS.find((x) => x.season === season) ?? DAWSON_SEASONS[0];
  const s = STEPS[step];
  if (!d || !s) return null;
  const go = (n: number) => {
    setStep(Math.min(STEPS.length - 1, Math.max(0, n)));
    // Stacked, the step can be longer than the screen: start the next one at its top.
    const top = sectionRef.current?.getBoundingClientRect().top;
    if (fit.stacked && top !== undefined && top < 0) sectionRef.current?.scrollIntoView?.();
  };
  const title = typeof s.title === 'function' ? s.title(d) : s.title;
  const last = step === STEPS.length - 1;
  const next = STEPS[step + 1];

  return (
    <div ref={fit.ref} className={`ground-stone relative w-full font-sans ${layout.outer}`}>
      <div
        className={`flex flex-col gap-3 ${layout.inner}`}
        style={{ '--fit': fit.scale } as CSSProperties}
      >
        <div className="flex shrink-0 flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <h1 className="font-display text-[30px] font-extrabold leading-none tracking-[-0.03em] md:text-[36px]">
            How Statly values trades
          </h1>
          <div className="grid gap-2" role="group" aria-label="Season to follow">
            <span className="font-display text-[12px] font-semibold text-muted-foreground">
              Follow Jordan Dawson&apos;s season
            </span>
            <div className="flex flex-wrap gap-2">
              {DAWSON_SEASONS.map(({ season: y }) => (
                <button
                  key={y}
                  type="button"
                  aria-pressed={season === y}
                  onClick={() => setSeason(y)}
                  className={chipStyles({ picked: season === y })}
                >
                  {y}
                </button>
              ))}
            </div>
          </div>
        </div>

        <section
          ref={sectionRef}
          className="ground-white flex min-h-0 flex-1 scroll-mt-28 flex-col border-2 border-foreground"
          aria-label="How PAV is calculated, step by step"
        >
          <Progress step={step} onPick={go} />

          <div
            key={step}
            className="grid min-h-0 flex-1 animate-in content-start gap-6 overflow-y-auto p-5 fade-in slide-in-from-right-4 duration-300 motion-reduce:animate-none md:grid-cols-[4fr_6fr] md:gap-8 md:px-8 md:py-6"
          >
            <div className="grid content-start gap-3">
              <span className="font-display text-[12px] font-extrabold tracking-[0.04em] text-primary">
                {s.kicker}
              </span>
              <h2 className="font-display text-[28px] font-bold leading-[1.05] tracking-[-0.02em] [text-wrap:balance] md:text-[32px]">
                {title}
              </h2>
              {(typeof s.copy === 'function' ? s.copy(d) : s.copy).map((c) => (
                <p key={c} className="max-w-[52ch] text-[15px] leading-relaxed">
                  {cite(c)}
                </p>
              ))}
            </div>
            <div className="min-w-0">
              <StepVisual step={s} season={d} />
            </div>
          </div>

          <div
            className={`flex shrink-0 items-center justify-between gap-4 border-t-2 border-foreground bg-card px-5 py-3 md:px-8 ${layout.footer}`}
          >
            <button
              type="button"
              onClick={() => go(step - 1)}
              disabled={step === 0}
              className={buttonStyles({ className: 'disabled:invisible' })}
            >
              ← Back
            </button>
            <span className="text-[14px] text-muted-foreground" aria-live="polite">
              Step {step + 1} of {STEPS.length}
              <span className="sr-only">: {title}</span>
            </span>
            <button
              type="button"
              onClick={() => go(last ? 0 : step + 1)}
              className={buttonStyles({ variant: 'primary' })}
            >
              {last || !next ? (
                'Start again'
              ) : (
                <>
                  <span className={layout.short}>Next →</span>
                  <span className={layout.long}>Next: {next.short} →</span>
                </>
              )}
            </button>
          </div>
        </section>

        <References />
      </div>
    </div>
  );
}
