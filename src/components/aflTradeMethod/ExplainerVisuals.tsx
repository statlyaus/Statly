import { useId } from 'react';

import { DAWSON_SEASONS, DAWSON_TRADE, type DawsonSeason, type Pool } from './dawsonExample';
import {
  f0,
  f1,
  f2,
  f3,
  f4,
  ordinal,
  pct,
  POOL_FILL,
  POOL_NAME,
  POOLS,
  round,
  roundParts,
  roundToTotal,
} from './explainerFormat';
import type { Step } from './explainerSteps';

/** The right-hand panel of each step. */
export function StepVisual({ step, season }: { step: Step; season: DawsonSeason }) {
  switch (step.id) {
    case 'what':
      return <IntroWhat />;
    case 'why':
      return <IntroWhy />;
    case 'use':
      return <IntroUse />;
    case 'meet':
      return <Meet />;
    case 'pot':
      return <PotView d={season} />;
    case 'season':
      return <SeasonView d={season} />;
    case 'stint':
      return <Stint />;
    case 'line':
      return <ValueLine />;
    case 'expected':
      return <ExpectedView />;
    case 'picks':
      return <PicksView />;
    case 'final':
      return <FinalView />;
    case 'misses':
      return <Misses />;
    default:
      break;
  }
  if (step.stage === 'club' && step.pool) return <ClubPool k={step.pool} d={season} />;
  if (step.stage === 'player' && step.pool) return <PlayerPool k={step.pool} d={season} />;
  return null;
}

const label = 'font-display text-[12px] font-semibold text-muted-foreground';

/* ---------- The idea ---------- */

type SketchKind = 'moneyball' | 'gridiron' | 'oval' | 'trade';

function IntroWhat() {
  const facts: [string, string][] = [
    ['Stands for', 'Player Approximate Value'],
    ['Made by', 'HPN (Hurling People Now)'],
    ['First published', 'August 2017'],
    ['Built from', 'Public AFL stats'],
    ['Named after', 'Matthew Pavlich, Fremantle'],
  ];
  const roots: [string, string, string, SketchKind, string][] = [
    [
      'Moneyball',
      '1982 · Bill James, baseball',
      '',
      'moneyball',
      'The stats thinking Moneyball made famous. James tried to put one rough number on what a player was worth.',
    ],
    ['2008', 'Pro-Football-Reference', 'NFL', 'gridiron', 'Value split by position'],
    ['2017', 'HPN', 'AFL', 'oval', 'Rebuilt for footy'],
    ['Today', 'Statly', 'AFL trades', 'trade', 'Used to judge trades'],
  ];
  return (
    <div className="grid gap-5">
      <div className="ground-cobalt grid grid-cols-[auto_1fr] items-center gap-6 px-6 py-4">
        <span className="font-display text-[56px] font-extrabold leading-none tracking-[-0.04em]">
          PAV
        </span>
        <dl className="grid text-[13px]">
          {facts.map(([k, v]) => (
            <div
              key={k}
              className="flex justify-between gap-4 border-t border-border py-1 first:border-t-0"
            >
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="text-right font-semibold">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="grid gap-2">
        <span className={label}>Where the idea came from</span>
        <ol className="grid grid-cols-2 gap-2 md:grid-cols-5">
          {roots.map(([year, who, sport, kind, note], i) => {
            const first = i === 0;
            const last = i === roots.length - 1;
            const ground = first ? 'ground-tint col-span-2' : last ? 'ground-sun' : 'ground-white';
            return (
              <li
                key={year}
                className={`${ground} grid content-start gap-1 border-2 border-foreground p-3`}
              >
                <Sketch kind={kind} />
                <span
                  className={`font-display font-bold leading-none ${first ? 'text-[30px] font-extrabold tracking-[-0.02em]' : 'text-[22px]'}`}
                >
                  {year}
                </span>
                <span className="text-[14px] font-semibold leading-tight">{who}</span>
                <span className="text-[12px] leading-snug text-muted-foreground">
                  {sport ? `${sport} · ` : ''}
                  {note}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

const COBALT = 'var(--primary)';
const INK = 'var(--foreground)';
const PAPER = 'var(--card)';
const SUN = 'var(--warning)';

/** Hand-drawn marker sketches: a 2.1px round cobalt line with a slight wobble. */
function Sketch({ kind }: { kind: SketchKind }) {
  const id = `rough-${useId().replace(/:/gu, '')}`;
  const line = {
    stroke: COBALT,
    strokeWidth: 2.1,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: 'none',
  };
  const moneyball = kind === 'moneyball';
  return (
    <svg
      viewBox={moneyball ? '0 0 220 118' : '0 0 120 80'}
      className={`mb-1 w-full ${moneyball ? 'h-[120px]' : 'h-[72px]'}`}
      aria-hidden="true"
    >
      <defs>
        <filter id={id}>
          <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="2" seed="7" />
          <feDisplacementMap in="SourceGraphic" scale="2.2" />
        </filter>
      </defs>
      <g filter={`url(#${id})`}>
        {moneyball && (
          <>
            {/* Original archetypes, not anyone's likeness (owner, 2026-11-20): the GM in the empty
                stands and the analyst with the numbers. */}
            <path
              d="M4 8 Q110 -2 216 8 M4 16 Q110 6 216 16 M4 24 Q110 14 216 24"
              {...line}
              strokeWidth={1.1}
              strokeDasharray="4 4"
            />
            <path d="M0 50 Q110 30 220 50" {...line} strokeWidth={1.4} />
            <path
              d="M50 66 Q72 56 94 66 L100 96 L44 96 Z"
              fill={INK}
              stroke={INK}
              strokeWidth={2.1}
              strokeLinejoin="round"
            />
            <path
              d="M64 61 L72 69 L80 61"
              stroke={PAPER}
              strokeWidth={1.4}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
            <path
              d="M47 72 L46 88"
              stroke={PAPER}
              strokeWidth={1.1}
              strokeLinecap="round"
              fill="none"
            />
            <path d="M72 54 V62" stroke={INK} strokeWidth={6} strokeLinecap="round" fill="none" />
            <circle cx="73" cy="45" r="11" fill={PAPER} stroke={INK} strokeWidth={2.1} />
            <path
              d="M61 46 Q60 31 74 32 Q87 32 85 44 Q80 37 72 38 Q65 39 64 50 Z"
              fill={INK}
              stroke={INK}
              strokeWidth={1.4}
              strokeLinejoin="round"
            />
            <path
              d="M84 45 L87 49 L84 50"
              stroke={INK}
              strokeWidth={1.4}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
            <path d="M79 44 h2" stroke={INK} strokeWidth={1.8} strokeLinecap="round" />
            <path
              d="M136 64 Q154 57 172 64 L176 104 L132 104 Z"
              fill={PAPER}
              stroke={COBALT}
              strokeWidth={2.1}
              strokeLinejoin="round"
            />
            <path d="M147 60 L154 66 L161 60" {...line} strokeWidth={1.6} />
            <path
              d="M154 66 L151 72 L154 86 L157 72 Z"
              fill={COBALT}
              stroke={COBALT}
              strokeWidth={1.2}
              strokeLinejoin="round"
            />
            <path d="M154 52 V59" {...line} strokeWidth={5} />
            <circle cx="154" cy="42" r="11" fill={PAPER} stroke={COBALT} strokeWidth={2.1} />
            <path
              d="M143 41 Q144 29 154 30 Q165 30 165 41 Q160 35 154 35 Q147 35 143 41 Z"
              fill={COBALT}
              stroke={COBALT}
              strokeWidth={1.2}
              strokeLinejoin="round"
            />
            <circle cx="149" cy="44" r="3.6" fill={PAPER} stroke={COBALT} strokeWidth={1.5} />
            <circle cx="159" cy="44" r="3.6" fill={PAPER} stroke={COBALT} strokeWidth={1.5} />
            <path d="M152.6 44 H155.4" {...line} strokeWidth={1.2} />
            <path d="M150 50 Q154 52 158 50" {...line} strokeWidth={1.3} />
            <path
              d="M160 76 L196 69 L199 90 L163 95 Z"
              fill={SUN}
              stroke={INK}
              strokeWidth={2.1}
              strokeLinejoin="round"
            />
            <path
              d="M170 88 V82 M177 87 V77 M184 86 V79 M191 84 V73"
              stroke={INK}
              strokeWidth={2.6}
              strokeLinecap="round"
              fill="none"
            />
            <path
              d="M163 95 L199 90 L203 94 L165 100 Z"
              fill={INK}
              stroke={INK}
              strokeWidth={1.4}
              strokeLinejoin="round"
            />
            <path
              d="M140 70 Q150 86 164 92"
              fill="none"
              stroke={COBALT}
              strokeWidth={5}
              strokeLinecap="round"
            />
            {/* Front row of empty seats */}
            <path
              d="M2 100 h24 v14 h-24 Z M30 100 h24 v14 h-24 Z M58 100 h24 v14 h-24 Z M86 100 h24 v14 h-24 Z M114 104 h24 v10 h-24 Z M178 104 h24 v10 h-24 Z"
              fill={PAPER}
              stroke={COBALT}
              strokeWidth={1.8}
              strokeLinejoin="round"
            />
            <path d="M44 96 H100" stroke={INK} strokeWidth={6} strokeLinecap="round" />
          </>
        )}
        {kind === 'gridiron' && (
          <>
            <rect x="10" y="16" width="100" height="52" {...line} />
            <path d="M30 16 V68 M50 16 V68 M70 16 V68 M90 16 V68" {...line} strokeWidth={1.4} />
            <path d="M104 42 H114 M114 30 V54 M114 30 L118 22 M114 54 L118 62" {...line} />
            <ellipse
              cx="52"
              cy="42"
              rx="10"
              ry="6"
              transform="rotate(-25 52 42)"
              fill={COBALT}
              stroke={COBALT}
            />
            <path d="M48 42 L56 40" stroke={PAPER} strokeWidth={1.4} strokeLinecap="round" />
          </>
        )}
        {kind === 'oval' && (
          <>
            <ellipse cx="60" cy="42" rx="50" ry="30" {...line} />
            <rect x="50" y="32" width="20" height="20" {...line} strokeWidth={1.6} />
            <circle cx="60" cy="42" r="3" {...line} />
            <path d="M10 34 V50 M13 30 V54 M107 30 V54 M110 34 V50" {...line} />
            <ellipse
              cx="86"
              cy="20"
              rx="7"
              ry="4.5"
              transform="rotate(-30 86 20)"
              fill={COBALT}
              stroke={COBALT}
            />
          </>
        )}
        {kind === 'trade' && (
          <>
            <path d="M16 28 H92 M84 20 L94 28 L84 36" {...line} stroke={INK} />
            <path d="M104 52 H28 M36 44 L26 52 L36 60" {...line} stroke={INK} />
            <path
              d="M14 74 L38 66 L60 70 L84 60 L106 62"
              {...line}
              stroke={INK}
              strokeWidth={1.6}
            />
          </>
        )}
      </g>
    </svg>
  );
}

function IntroWhy() {
  const points: [string, string][] = [
    [
      'Team first',
      "A player's value comes out of his club's value, so it is harder to earn value in a weak team than in a strong one.",
    ],
    [
      'Same pot every season',
      'The pot is always 100 per club for each part, so seasons from different years can sit side by side.',
    ],
    [
      'Checked against the experts',
      "HPN compared it with Brownlow votes, All-Australian teams, best and fairests and Champion Data's ratings. It largely agreed.",
    ],
  ];
  return (
    <div className="grid gap-3">
      {points.map(([head, body]) => (
        <div key={head} className="grid gap-1 border-2 border-foreground bg-card p-4">
          <span className="font-display text-[18px] font-bold">{head}</span>
          <span className="text-[15px] leading-relaxed">{body}</span>
        </div>
      ))}
    </div>
  );
}

function ListPanel({
  head,
  items,
  ground,
}: {
  head: string;
  items: readonly string[];
  ground: string;
}) {
  return (
    <div className={`${ground} grid content-start gap-3 p-5`}>
      <span className="font-display text-[18px] font-bold">{head}</span>
      <ul className="grid gap-2 text-[15px] leading-snug">
        {items.map((t) => (
          <li key={t} className="border-t border-foreground/15 pt-2">
            {t}
          </li>
        ))}
      </ul>
    </div>
  );
}

function IntroUse() {
  return (
    <ListPanel
      head="What it does well"
      ground="ground-tint"
      items={[
        'One measure for every player, position and year',
        'Anyone can check it: public stats and a published formula',
        'It counts a whole season, not one highlight',
      ]}
    />
  );
}

/* ---------- Meet Dawson ---------- */

function Bars({ bars }: { bars: readonly { key: string; value: number; label: string }[] }) {
  const max = Math.max(...bars.map((x) => x.value)) * 1.15;
  // Each label sits above or below its bar, never on it, so it reads on the white panel.
  return (
    <div className="flex h-52 items-stretch gap-3">
      {bars.map((x) => (
        <div key={x.key} className="flex flex-1 flex-col items-center justify-end gap-1">
          <span className="text-[13px] font-semibold">{x.label}</span>
          <span
            className="w-full bg-primary"
            style={{ height: `calc((100% - 3rem) * ${x.value / max})` }}
          />
          <em className="text-[12px] not-italic text-muted-foreground">{x.key}</em>
        </div>
      ))}
    </div>
  );
}

const seasonBars = DAWSON_SEASONS.map((x) => ({
  key: String(x.season),
  value: Math.round(x.dawson.total * 100) / 100,
  label: f2(x.dawson.total),
}));

function Meet() {
  return (
    <div className="grid gap-5">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 border-2 border-foreground p-4">
        <div className="grid gap-1">
          <span className="text-[13px] text-muted-foreground">From</span>
          <span className="font-display text-[22px] font-bold">{DAWSON_TRADE.from}</span>
        </div>
        <span className="font-display text-[28px]" aria-hidden="true">
          →
        </span>
        <div className="grid gap-1 text-right">
          <span className="text-[13px] text-muted-foreground">To</span>
          <span className="font-display text-[22px] font-bold">{DAWSON_TRADE.to}</span>
        </div>
        <p className="col-span-3 border-t border-muted pt-2 text-[14px]">
          Jordan Dawson, {DAWSON_TRADE.tradeYear} trade period. Adelaide gave{' '}
          {DAWSON_TRADE.pickLabel}.
        </p>
      </div>
      <div className="grid gap-2">
        <span className={label}>His PAV for Adelaide, each season</span>
        <Bars bars={seasonBars} />
      </div>
    </div>
  );
}

/* ---------- The pot ---------- */

function PotView({ d }: { d: DawsonSeason }) {
  return (
    <div className="grid gap-5">
      {POOLS.map((k) => (
        <div key={k} className="grid gap-2">
          <div className="flex justify-between text-[14px]">
            <b className="font-display font-semibold">{POOL_NAME[k]}</b>
            <span>
              {d.clubs} × 100 = {f0(d.clubs * 100)}
            </span>
          </div>
          <div
            className="grid gap-[3px]"
            style={{ gridTemplateColumns: `repeat(${d.clubs}, 1fr)` }}
          >
            {Array.from({ length: d.clubs }, (_, i) => (
              <i
                key={i}
                className={`h-6 ${POOL_FILL[k]} ${i === 0 ? `outline-3 outline-offset-1 ${k === 'mid' ? 'outline-primary' : 'outline-warning'}` : 'opacity-20'}`}
              />
            ))}
          </div>
        </div>
      ))}
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-muted pt-4">
        <span className="font-display text-[44px] font-bold leading-none tracking-[-0.03em]">
          {f0(d.clubs * 300)}
        </span>
        <span className="max-w-[40ch] text-[15px]">
          PAV in the {d.season} pot. The blocks show how big each part is, not who gets what. The
          outlined block is Adelaide; its real share comes next.
        </span>
      </div>
    </div>
  );
}

/* ---------- Adelaide's share ---------- */

function ClubPool({ k, d }: { k: Pool; d: DawsonSeason }) {
  const a = d.adelaide;
  // Decimals chosen so every printed sum gives its printed answer, for every season.
  const L = f4(d.leaguePointsPerInside50);
  const forPer50 = f4(a.pointsFor / a.inside50sFor);
  const againstPer50 = f4(a.pointsAgainst / a.inside50sAgainst);
  const lines: [string, string][] =
    k === 'off'
      ? [
          ['Points Adelaide scored', f0(a.pointsFor)],
          ['Its inside 50s', f0(a.inside50sFor)],
          ['Its points per inside 50', forPer50],
          ['Competition points per inside 50 (all points ÷ all inside 50s)', L],
          ['Rating', `${forPer50} ÷ ${L} = ${f3(a.rating.off)}`],
        ]
      : k === 'mid'
        ? [
            ["Adelaide's inside 50s", f0(a.inside50sFor)],
            ["Opponents' inside 50s", f0(a.inside50sAgainst)],
            ['Rating', `${f0(a.inside50sFor)} ÷ ${f0(a.inside50sAgainst)} = ${f3(a.rating.mid)}`],
          ]
        : [
            ['Points opponents scored', f0(a.pointsAgainst)],
            ["Opponents' inside 50s", f0(a.inside50sAgainst)],
            ['Their points per inside 50', againstPer50],
            ['Competition points per inside 50', L],
            [
              'Rating: 2 − (theirs ÷ competition)',
              `2 − ${againstPer50} ÷ ${L} = ${f3(a.rating.def)}`,
            ],
          ];
  const done = POOLS.slice(0, POOLS.indexOf(k) + 1);
  return (
    <div className="grid gap-4">
      <Ledger lines={lines} />
      <Scale value={a.rating[k]} fill={POOL_FILL[k]} />
      <div className="ground-tint flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3 text-[15px]">
        <span>
          Its share: {f0(d.clubs * 100)} × rating {f4(a.rating[k])} ÷ all {d.clubs} ratings{' '}
          {f3(a.allRatings[k])}
        </span>
        <strong className="font-display text-[28px] font-bold leading-none">{f1(a.pav[k])}</strong>
      </div>
      <Tally
        label={`Adelaide's value in ${d.season}`}
        items={POOLS.map((p) => ({ k: p, value: done.includes(p) ? f1(a.pav[p]) : null }))}
        // The total is the sum of the three shown parts, so the chips add up.
        total={k === 'def' ? f1(POOLS.reduce((sum, p) => sum + round(a.pav[p], 1), 0)) : null}
      />
    </div>
  );
}

/* ---------- Dawson's share ---------- */

type Row = { stat: string; count: number; weight: number; label: string };

function sheet(k: Pool, d: DawsonSeason): Row[] {
  const s = d.dawson.stats;
  const fd = s.freeKicksFor - s.freeKicksAgainst;
  if (k === 'off')
    return [
      { stat: 'Points scored', count: s.totalPoints, weight: 1, label: '1' },
      { stat: 'Hitouts', count: s.hitOuts, weight: 0.25, label: '¼' },
      { stat: 'Goal assists', count: s.goalAssists, weight: 3, label: '3' },
      { stat: 'Inside 50s', count: s.inside50s, weight: 1, label: '1' },
      { stat: 'Marks inside 50', count: s.marksInside50, weight: 1, label: '1' },
      { stat: 'Free kick difference', count: fd, weight: 1, label: '1' },
    ];
  if (k === 'mid')
    return [
      { stat: 'Inside 50s', count: s.inside50s, weight: 15, label: '15' },
      { stat: 'Clearances', count: s.clearances, weight: 20, label: '20' },
      { stat: 'Tackles', count: s.tackles, weight: 3, label: '3' },
      { stat: 'Hitouts', count: s.hitOuts, weight: 1.5, label: '1.5' },
      { stat: 'Free kick difference', count: fd, weight: 1, label: '1' },
    ];
  return [
    { stat: 'Rebound 50s', count: s.rebound50s, weight: 20, label: '20' },
    { stat: 'One-percenters', count: s.onePercenters, weight: 12, label: '12' },
    { stat: 'Marks', count: s.marks, weight: 1, label: '1' },
    { stat: 'Marks inside 50', count: s.marksInside50, weight: -4, label: '−4' },
    { stat: 'Free kick difference', count: fd, weight: 2, label: '2' },
    { stat: 'Hitouts', count: s.hitOuts, weight: -2 / 3, label: '−⅔' },
  ];
}

const th = 'pb-2 font-semibold';

function PlayerPool({ k, d }: { k: Pool; d: DawsonSeason }) {
  const w = d.dawson;
  const name = POOL_NAME[k].toLowerCase();
  const share = w.score[k] / w.clubScore[k];
  const done = POOLS.slice(0, POOLS.indexOf(k) + 1);
  return (
    <div className="grid gap-3">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="font-display text-[11px] text-muted-foreground">
              <th scope="col" className={`${th} text-left`}>
                Stat
              </th>
              <th scope="col" className={`${th} text-right`}>
                He had
              </th>
              <th scope="col" className={`${th} text-right`}>
                Worth each
              </th>
              <th scope="col" className={`${th} text-right`}>
                Score
              </th>
            </tr>
          </thead>
          <tbody>
            {sheet(k, d).map((row) => (
              <tr
                key={row.stat}
                className={`border-t border-muted ${row.count === 0 ? 'text-muted-foreground' : ''}`}
              >
                <td className="py-1.5">{row.stat}</td>
                <td className="py-1.5 text-right">{f0(row.count)}</td>
                <td className="py-1.5 text-right">× {row.label}</td>
                <td className="py-1.5 text-right">{f1(row.count * row.weight)}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-foreground font-semibold">
              <td className="py-1.5">His score</td>
              <td />
              <td />
              <td className="py-1.5 text-right">{f1(w.score[k])}</td>
            </tr>
            <tr className="border-t border-muted">
              <td className="py-1.5">Every Adelaide player&apos;s score added together</td>
              <td />
              <td />
              <td className="py-1.5 text-right">{f1(w.clubScore[k])}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="relative h-3 bg-muted" aria-hidden="true">
        <span
          className={`absolute inset-y-0 left-0 ${POOL_FILL[k]}`}
          style={{ width: `${Math.max(0, Math.min(100, share * 100))}%` }}
        />
      </div>
      <div className="ground-tint flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3 text-[15px]">
        <span>
          His share ({pct(share)}): Adelaide&apos;s {name} value {f2(d.adelaide.pav[k])} ×{' '}
          {f1(w.score[k])} ÷ {f1(w.clubScore[k])}
        </span>
        <strong className="font-display text-[28px] font-bold leading-none">{f2(w.pav[k])}</strong>
      </div>
      <Tally
        label="His value so far"
        items={POOLS.map((q) => ({ k: q, value: done.includes(q) ? f2(w.pav[q]) : null }))}
        total={null}
      />
    </div>
  );
}

/* ---------- His season ---------- */

function SeasonView({ d }: { d: DawsonSeason }) {
  const parts = roundParts(d.dawson.pav, d.dawson.total);
  const r = d.rank;
  const scale = (v: number) => `${Math.max(0, Math.min(100, (v / (r.top * 1.12)) * 100))}%`;
  const marks: [string, number][] = [
    ['Middle player', r.median],
    ['Top 10% starts', r.tenth],
    ['Highest', r.top],
  ];
  return (
    <div className="grid gap-4">
      <div className="grid gap-3">
        <div className="ground-ink grid gap-3 p-6">
          <span className="font-display text-[13px] font-semibold text-primary">
            His PAV for {d.season}
          </span>
          <div className="font-display text-[96px] font-extrabold leading-[0.85] tracking-[-0.05em]">
            {f2(d.dawson.total)}
          </div>
          <p className="text-[15px] text-muted-foreground">
            {f2(parts.off)} attack + {f2(parts.mid)} midfield + {f2(parts.def)} defence
          </p>
          <p className="text-[13px] text-muted-foreground">
            Each part is rounded so the three add up to his total.
          </p>
        </div>
        <div className="flex h-8 border-2 border-foreground" aria-hidden="true">
          {POOLS.map((k) => (
            <span key={k} className={POOL_FILL[k]} style={{ flexGrow: Math.max(0, parts[k]) }} />
          ))}
        </div>
      </div>
      <div className="grid gap-2">
        <p className="text-[15px]">
          <b>
            {ordinal(r.position)} of {f0(r.of)}
          </b>{' '}
          players with 10 or more games in {d.season}.
        </p>
        <div className="relative h-16" aria-hidden="true">
          <div className="absolute inset-x-0 top-6 h-2 bg-muted" />
          {marks.map(([name, v]) => (
            <div
              key={name}
              className="absolute top-3 grid -translate-x-1/2 justify-items-center"
              style={{ left: scale(v) }}
            >
              <i className="h-8 w-0.5 bg-muted-foreground" />
              <span className="whitespace-nowrap text-[11px] text-muted-foreground">
                {name} {f1(v)}
              </span>
            </div>
          ))}
          <div
            className="absolute top-3 h-8 w-3 -translate-x-1/2 border-2 border-foreground bg-warning"
            style={{ left: scale(d.dawson.total) }}
          />
        </div>
      </div>
    </div>
  );
}

/* ---------- The trade ---------- */

const lastOf = <T,>(items: readonly [T, ...T[]] | readonly T[]): T => {
  const last = items[items.length - 1];
  if (last === undefined) throw new RangeError('empty line');
  return last;
};

function Stint() {
  const produced = lastOf(DAWSON_TRADE.dawsonLine).produced;
  return (
    <div className="grid gap-6">
      <Bars bars={seasonBars} />
      <p className="text-[15px]">
        Five seasons at Adelaide: {seasonBars.map((x) => x.label).join(' + ')} ={' '}
        <strong className="font-display font-bold">{f2(produced)} PAV</strong> produced for the club
        so far.
      </p>
    </div>
  );
}

function ValueLine() {
  const line = DAWSON_TRADE.dawsonLine;
  const pick = DAWSON_TRADE.pickLine;
  const max = Math.max(...line.map((x) => x.value), ...pick.map((x) => x.value)) * 1.08;
  const last = lastOf(line);
  const lastPick = lastOf(pick);
  const outcome = DAWSON_TRADE.pickOutcome;
  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <span className={label}>Dawson&apos;s value line at Adelaide, end of each season</span>
        <div className="flex h-36 items-end gap-3 pt-5">
          {line.map((x) => (
            <div
              key={x.season}
              className="relative flex flex-1 flex-col-reverse"
              style={{ height: `${(x.value / max) * 100}%` }}
            >
              <span className="bg-primary" style={{ height: `${(x.produced / x.value) * 100}%` }} />
              <span
                className="border-2 border-dashed border-primary bg-accent"
                style={{ height: `${(x.expected / x.value) * 100}%` }}
              />
              <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[12px] font-semibold">
                {f1(x.value)}
              </span>
              <em className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[11px] not-italic text-muted-foreground">
                {x.season}
              </em>
            </div>
          ))}
        </div>
        <div className="flex gap-4 pt-5 text-[13px]">
          <span className="inline-flex items-center gap-1.5">
            <i className="inline-block h-3 w-3 bg-primary" />
            Produced so far
          </span>
          <span className="inline-flex items-center gap-1.5">
            <i className="inline-block h-3 w-3 border-2 border-dashed border-primary bg-accent" />
            Expected still to come
          </span>
        </div>
      </div>
      <Ledger
        lines={[
          [
            'Dawson at Adelaide, end of 2026',
            `${f1(last.produced)} + ${f1(last.expected)} = ${f1(last.value)}`,
          ],
          [
            `The pick (${outcome.player} at ${outcome.club}), end of 2026`,
            `${f1(lastPick.produced)} + ${f1(lastPick.expected)} = ${f1(lastPick.value)}`,
          ],
          [
            'Adelaide ahead on this trade by',
            `${f1(last.value)} − ${f1(lastPick.value)} = ${f1(DAWSON_TRADE.adelaideNet2026)}`,
          ],
        ]}
      />
    </div>
  );
}

function ExpectedView() {
  const e = DAWSON_TRADE.expected2026;
  // Rounded to 2 decimals so the shown parts add up to the shown total.
  const shown = roundToTotal([...e.seasons.map((s) => s.expected), e.later.expected], e.total);
  return (
    <div className="grid gap-3">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="font-display text-[11px] text-muted-foreground">
            <th scope="col" className={`${th} text-left`}>
              Season
            </th>
            <th scope="col" className={`${th} text-right`}>
              Chance still there
            </th>
            <th scope="col" className={`${th} text-right`}>
              Games
            </th>
            <th scope="col" className={`${th} text-right`}>
              PAV a game
            </th>
            <th scope="col" className={`${th} text-right`}>
              Expected PAV
            </th>
          </tr>
        </thead>
        <tbody>
          {e.seasons.map((s, i) => (
            <tr key={s.label} className="border-t border-muted">
              <td className="py-1.5">{s.label}</td>
              <td className="py-1.5 text-right">{pct(s.stillThere)}</td>
              <td className="py-1.5 text-right">× {f1(s.games)}</td>
              <td className="py-1.5 text-right">× {f2(s.pavPerGame)}</td>
              <td className="py-1.5 text-right">{f2(shown[i] ?? 0)}</td>
            </tr>
          ))}
          <tr className="border-t border-muted">
            <td className="py-1.5">{e.later.label}</td>
            <td className="py-1.5 text-right text-muted-foreground" colSpan={3}>
              smaller each year
            </td>
            <td className="py-1.5 text-right">{f2(shown[shown.length - 1] ?? 0)}</td>
          </tr>
          <tr className="border-t-2 border-foreground font-semibold">
            <td className="py-1.5" colSpan={4}>
              Expected still to come, end of 2026
            </td>
            <td className="py-1.5 text-right">{f2(e.total)}</td>
          </tr>
        </tbody>
      </table>
      <p className="text-[14px] text-muted-foreground">
        That&apos;s about {f1(e.expectedSeasons)} more seasons and {f0(e.expectedGames)} more games
        at Adelaide, on average. Figures are rounded to two decimals so they add up.
      </p>
    </div>
  );
}

function PicksView() {
  const last = lastOf(DAWSON_TRADE.pickLine);
  const o = DAWSON_TRADE.pickOutcome;
  const cards: [string, string, string][] = [
    [
      'Before the draft',
      `${f1(DAWSON_TRADE.pickAtTrade)} PAV`,
      `What pick ${o.projectedSlot}, its projected slot at the trade, has usually been worth.`,
    ],
    [
      'At the draft',
      `${f1(DAWSON_TRADE.pickAtDraft)} PAV`,
      `Used at pick ${o.selection} by ${o.club}, so it is valued as pick ${o.selection} and becomes ${o.player}.`,
    ],
    [
      'End of 2026',
      `${f1(last.value)} PAV`,
      `${f1(last.produced)} produced so far by ${o.player} + ${f1(last.expected)} expected still to come.`,
    ],
  ];
  return (
    <div className="grid gap-4">
      <div className="grid gap-2 md:grid-cols-3">
        {cards.map(([head, value, body]) => (
          <div
            key={head}
            className="grid content-start gap-1 border-2 border-foreground bg-card p-3"
          >
            <span className="text-[13px] text-muted-foreground">{head}</span>
            <span className="font-display text-[24px] font-bold leading-none">{value}</span>
            <span className="text-[13px] leading-snug">{body}</span>
          </div>
        ))}
      </div>
      <div className="ground-tint grid gap-1 p-4 text-[14px]">
        <b className="font-display">Matched bids</b>
        <span>
          A pick that covered 600 of the 1,000 draft points a bid needed owns 60% of the player
          taken, from the bid on.
        </span>
      </div>
      <Ledger
        lines={[
          ['Adelaide, end of 2026', `+${f1(DAWSON_TRADE.adelaideNet2026)}`],
          ['Sydney, end of 2026', `−${f1(DAWSON_TRADE.adelaideNet2026)}`],
          ['The two always add to zero', '0.0'],
        ]}
      />
    </div>
  );
}

function FinalView() {
  return (
    <ListPanel
      head="Keep in mind"
      ground="ground-stone"
      items={[
        'A value marked * is not in yet, usually a pick whose path through the draft Statly has not confirmed. Totals leave it out, so they will change.',
        "These are Statly's numbers. No club or the AFL has endorsed them.",
        'Club colours only: Statly does not use club logos.',
      ]}
    />
  );
}

function Misses() {
  return (
    <ListPanel
      head="Where it falls short"
      ground="ground-stone"
      items={[
        'It is approximate: close calls between two players can go either way.',
        "Pure shutdown defenders can be underrated. HPN's own example is Darren Glass.",
        'It is harder to earn value in a weak team than a strong one.',
        "It only sees the stats in its formula. Things like pressure acts and leadership aren't in it.",
      ]}
    />
  );
}

/* ---------- Shared pieces ---------- */

function Ledger({ lines }: { lines: readonly [string, string][] }) {
  return (
    <dl className="grid text-[15px]">
      {lines.map(([name, value], i) => (
        <div
          key={name}
          className={`flex justify-between gap-4 py-1.5 ${i === lines.length - 1 ? 'border-t-2 border-foreground font-semibold' : 'border-t border-muted'}`}
        >
          <dt>{name}</dt>
          <dd className="text-right">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Tally({
  label: head,
  items,
  total,
}: {
  label: string;
  items: readonly { k: Pool; value: string | null }[];
  total: string | null;
}) {
  return (
    <div className="grid gap-2">
      <span className={label}>{head}</span>
      <div className="flex flex-wrap gap-2 text-[14px]">
        {items.map(({ k, value }) => (
          <span
            key={k}
            className={`inline-flex items-center gap-1.5 border px-2.5 py-1 ${value ? 'border-foreground' : 'border-dashed border-border text-muted-foreground'}`}
          >
            <i
              className={`inline-block h-2.5 w-2.5 ${POOL_FILL[k]} ${value ? '' : 'opacity-30'}`}
            />
            {POOL_NAME[k]} {value ?? '—'}
          </span>
        ))}
        {total && (
          <span className="inline-flex items-center border border-foreground bg-warning px-2.5 py-1 font-semibold text-warning-foreground">
            Club total {total}
          </span>
        )}
      </div>
    </div>
  );
}

function Scale({ value, fill }: { value: number; fill: string }) {
  const lo = 0.75;
  const hi = 1.25;
  const pos = ((Math.min(hi, Math.max(lo, value)) - lo) / (hi - lo)) * 100;
  const ticks: [string, string][] = [
    ['0.75', '3%'],
    ['1.00 = competition', '50%'],
    ['1.25', '97%'],
  ];
  return (
    <div className="relative h-10" aria-hidden="true">
      <div className="absolute inset-x-0 top-[15px] h-1 bg-muted" />
      <div className="absolute bottom-3 left-1/2 top-1 w-0.5 bg-muted-foreground" />
      <div
        className={`absolute top-2 h-[18px] w-[18px] -translate-x-1/2 rounded-full border-[2.5px] border-foreground ${fill}`}
        style={{ left: `${pos}%` }}
      />
      {ticks.map(([t, l]) => (
        <span
          key={t}
          className="absolute top-[26px] -translate-x-1/2 whitespace-nowrap text-[11px] text-muted-foreground"
          style={{ left: l }}
        >
          {t}
        </span>
      ))}
    </div>
  );
}
