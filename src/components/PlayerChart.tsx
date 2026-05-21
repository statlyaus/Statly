import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  Chart as ChartJS,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Tooltip,
  Legend,
} from 'chart.js';
import { Line } from 'react-chartjs-2';

import { getTeamAbbreviation } from '@/lib/teamLogos';

ChartJS.register(LineElement, PointElement, LinearScale, CategoryScale, Tooltip, Legend);

type MatchData = {
  round: number | undefined;
  value: number | null;
  opposition: string;
};

type Props = {
  playerName: string;
  matchData: MatchData[];
  metricLabel?: string;
};

const CHIP_HOVER_TOOLTIP_DELAY_MS = 360;

function renderBroadcastTooltip(
  context: {
    chart: ChartJS;
    tooltip: {
      opacity: number;
      dataPoints?: Array<{ dataIndex: number; raw: unknown }>;
      caretX: number;
      caretY: number;
    };
  },
  metricLabel: string,
  sortedMatches: MatchData[]
) {
  const { chart, tooltip } = context;
  const parent = chart.canvas.parentElement;
  let tooltipEl = parent?.querySelector(
    'div[data-broadcast-tooltip="true"]'
  ) as HTMLDivElement | null;

  if (!tooltipEl && parent) {
    // Ensure absolute children are anchored to the chart container.
    if (typeof window !== 'undefined' && window.getComputedStyle(parent).position === 'static') {
      parent.style.position = 'relative';
    }

    tooltipEl = document.createElement('div');
    tooltipEl.setAttribute('data-broadcast-tooltip', 'true');
    tooltipEl.style.position = 'absolute';
    tooltipEl.style.pointerEvents = 'none';
    tooltipEl.style.transform = 'none';
    tooltipEl.style.transition = 'all .12s ease';
    tooltipEl.style.background = 'linear-gradient(145deg, rgba(2,6,23,.96), rgba(15,23,42,.96))';
    tooltipEl.style.border = '1px solid rgba(148,163,184,.35)';
    tooltipEl.style.borderRadius = '12px';
    tooltipEl.style.boxShadow = '0 10px 28px rgba(2,6,23,.45)';
    tooltipEl.style.padding = '10px 12px';
    tooltipEl.style.minWidth = '170px';
    tooltipEl.style.zIndex = '40';
    parent.appendChild(tooltipEl);
  }

  if (!tooltipEl) return;

  if (!tooltip || tooltip.opacity === 0) {
    tooltipEl.style.opacity = '0';
    return;
  }

  const point = tooltip.dataPoints?.[0];
  const index = point?.dataIndex ?? 0;
  const match = sortedMatches[index];
  const rawValue = typeof point?.raw === 'number' ? point.raw : null;
  const value =
    rawValue !== null && Number.isFinite(rawValue) ? rawValue.toFixed(1) : 'Unavailable';
  const abbr = getTeamAbbreviation(match?.opposition || 'Unknown');
  const round = match?.round ?? '—';

  tooltipEl.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
      <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--info);font-weight:700;">Focused Round</div>
      <div style="font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted-foreground);">Live</div>
    </div>
    <div style="margin-top:4px;font-size:15px;line-height:1.1;font-weight:800;color:var(--primary-foreground);">R${round} vs ${abbr}</div>
    <div style="margin-top:7px;display:flex;align-items:center;gap:8px;">
      <span style="display:inline-flex;height:10px;width:10px;border-radius:9999px;background:var(--success);box-shadow:0 0 0 3px rgba(16,185,129,.25);"></span>
      <span style="font-size:13px;font-weight:700;color:var(--primary-foreground);">${metricLabel}: ${value}</span>
    </div>
  `;

  tooltipEl.style.opacity = '1';

  // Position against the canvas box, then clamp so the panel stays visible.
  const canvasLeft = chart.canvas.offsetLeft;
  const canvasTop = chart.canvas.offsetTop;
  const canvasWidth = chart.canvas.clientWidth;
  const canvasHeight = chart.canvas.clientHeight;
  const panelWidth = tooltipEl.offsetWidth || 170;
  const panelHeight = tooltipEl.offsetHeight || 86;

  let left = canvasLeft + tooltip.caretX - panelWidth / 2;
  left = Math.max(canvasLeft + 8, Math.min(left, canvasLeft + canvasWidth - panelWidth - 8));

  let top = canvasTop + tooltip.caretY - panelHeight - 14; // prefer above point
  if (top < canvasTop + 8) {
    top = canvasTop + tooltip.caretY + 14; // fallback below point
  }
  top = Math.min(top, canvasTop + canvasHeight - panelHeight - 8);

  tooltipEl.style.left = `${left}px`;
  tooltipEl.style.top = `${top}px`;
}

const getAbbrBadgeClasses = (abbr: string): string => {
  const teamColor: Record<string, string> = {
    ADE: 'bg-destructive/10 text-destructive ring-destructive',
    BRI: 'bg-warning/10 text-warning ring-warning',
    CAR: 'bg-info/10 text-info ring-info',
    COL: 'bg-muted text-foreground ring-ring',
    ESS: 'bg-destructive/10 text-destructive ring-destructive',
    FRE: 'bg-violet-50 text-violet-700 ring-violet-200',
    GEE: 'bg-info/10 text-info ring-info',
    GCS: 'bg-warning/10 text-warning ring-warning',
    GWS: 'bg-warning/10 text-warning ring-warning',
    HAW: 'bg-warning/10 text-warning ring-warning',
    MEL: 'bg-destructive/10 text-destructive ring-destructive',
    NOR: 'bg-info/10 text-info ring-info',
    POR: 'bg-teal-50 text-teal-700 ring-teal-200',
    RIC: 'bg-warning/10 text-warning ring-warning',
    STK: 'bg-zinc-100 text-zinc-700 ring-zinc-300',
    SYD: 'bg-destructive/10 text-destructive ring-destructive',
    WCE: 'bg-warning/10 text-warning ring-warning',
    BUL: 'bg-info/10 text-info ring-info',
  };
  return teamColor[abbr] ?? 'bg-muted text-foreground ring-ring';
};

const PlayerChart: React.FC<Props> = ({ playerName, matchData, metricLabel = 'Total Value' }) => {
  const [activePointIndex, setActivePointIndex] = useState<number | null>(null);
  const [activeRound, setActiveRound] = useState<number | null>(null);
  const chartRef = useRef<ChartJS<'line'> | null>(null);
  const tooltipDelayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sort by round and create chart data
  const sortedMatches = [...matchData].sort((a, b) => (a.round ?? 0) - (b.round ?? 0));
  const labels = sortedMatches.map((match) => `R${match.round ?? '—'}`);
  const values = sortedMatches.map((match) => match.value);
  const focusPointValues = values.map((value, idx) =>
    activePointIndex !== null && idx === activePointIndex ? value : null
  );
  const numericValues = values.filter((value): value is number => typeof value === 'number');
  const hasData = numericValues.length > 0;
  const avg = numericValues.length
    ? numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length
    : 0;
  const best = numericValues.length ? Math.max(...numericValues) : 0;
  const worst = numericValues.length ? Math.min(...numericValues) : 0;
  const roundSlots = useMemo(() => {
    const byRound = new Map<number, { match: MatchData; chartIndex: number }>();
    sortedMatches.forEach((match, chartIndex) => {
      const round = match.round;
      if (typeof round !== 'number' || round < 1 || round > 24) return;
      const existing = byRound.get(round);
      if (!existing) {
        byRound.set(round, { match, chartIndex });
        return;
      }
      // Prefer rows with an actual numeric value, then larger magnitude among numeric rows.
      const existingNumeric = typeof existing.match.value === 'number';
      const matchNumeric = typeof match.value === 'number';
      if (matchNumeric && !existingNumeric) {
        byRound.set(round, { match, chartIndex });
        return;
      }
      if (
        matchNumeric &&
        existingNumeric &&
        Math.abs(match.value as number) > Math.abs(existing.match.value as number)
      ) {
        byRound.set(round, { match, chartIndex });
      }
    });

    return Array.from({ length: 24 }, (_, i) => {
      const round = i + 1;
      const found = byRound.get(round);
      return {
        round,
        match: found?.match ?? null,
        chartIndex: found?.chartIndex ?? null,
      };
    });
  }, [sortedMatches]);

  const focusedIndex = activePointIndex ?? null;
  const focusedSlot =
    activeRound !== null && activeRound >= 1 && activeRound <= 24
      ? roundSlots[activeRound - 1]
      : null;
  const latestPlayedSlot = [...roundSlots].reverse().find((slot) => slot.match);
  const focusedMatch =
    focusedIndex !== null
      ? (sortedMatches[focusedIndex] ?? null)
      : (focusedSlot?.match ?? latestPlayedSlot?.match ?? null);
  const focusedRound = activeRound ?? focusedMatch?.round ?? null;
  const focusedIsDnp = activeRound !== null && !focusedSlot?.match;
  const focusedValue = focusedIsDnp ? null : (focusedMatch?.value ?? null);
  const focusedHasUnavailableValue = !focusedIsDnp && focusedMatch != null && focusedValue === null;
  const focusedAbbr = focusedIsDnp
    ? 'DNP'
    : focusedMatch
      ? getTeamAbbreviation(focusedMatch.opposition || 'Unknown')
      : '—';
  const focusedDelta = focusedValue !== null && Number.isFinite(avg) ? focusedValue - avg : null;

  const setChartTooltipAtIndex = useCallback((index: number | null) => {
    const chart = chartRef.current;
    if (!chart) return;

    if (index === null || index < 0) {
      chart.setActiveElements([]);
      chart.tooltip?.setActiveElements([], { x: 0, y: 0 });
      chart.update('none');
      return;
    }

    const meta = chart.getDatasetMeta(0);
    const point = meta?.data?.[index];
    if (!point) {
      chart.setActiveElements([]);
      chart.tooltip?.setActiveElements([], { x: 0, y: 0 });
      chart.update('none');
      return;
    }

    const props = point.getProps(['x', 'y'], true) as { x: number; y: number };
    chart.setActiveElements([{ datasetIndex: 0, index }]);
    chart.tooltip?.setActiveElements([{ datasetIndex: 0, index }], { x: props.x, y: props.y });
    chart.update('none');
  }, []);

  useEffect(() => {
    return () => {
      if (tooltipDelayTimerRef.current) {
        clearTimeout(tooltipDelayTimerRef.current);
      }
    };
  }, []);

  return (
    <div className="rounded-xl border border-border bg-white p-6">
      <div className="mb-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Player Trend
        </p>
        <h2 className="mt-1 text-3xl font-extrabold tracking-tight text-foreground">
          {playerName}
        </h2>
        <p className="mt-1 text-lg text-muted-foreground">{metricLabel} by round</p>
      </div>

      {hasData ? (
        <div className="h-[26rem] rounded-lg border border-border bg-white p-3">
          <Line
            ref={chartRef}
            data={{
              labels,
              datasets: [
                {
                  label: metricLabel,
                  data: values,
                  borderColor: 'var(--success)',
                  backgroundColor: 'rgba(15, 118, 110, 0.12)',
                  fill: true,
                  spanGaps: false,
                  tension: 0.35,
                  pointBackgroundColor: 'var(--success)',
                  pointBorderColor: 'var(--card)',
                  pointBorderWidth: 2,
                  pointRadius: values.map((value) => (value === null ? 0 : 4)),
                  pointHoverRadius: 6,
                },
                {
                  label: 'Focused Round',
                  data: focusPointValues,
                  showLine: false,
                  pointBackgroundColor: 'var(--success)',
                  pointBorderColor: 'var(--success)',
                  pointBorderWidth: 4,
                  pointRadius: 11,
                  pointHoverRadius: 11,
                },
              ],
            }}
            options={{
              maintainAspectRatio: false,
              responsive: true,
              plugins: {
                legend: {
                  display: false,
                },
                tooltip: {
                  enabled: false,
                  external: (ctx) =>
                    renderBroadcastTooltip(ctx as never, metricLabel, sortedMatches),
                },
              },
              scales: {
                y: {
                  beginAtZero: true,
                  ticks: { font: { size: 14 } },
                  grid: {
                    color: 'rgba(15, 23, 42, 0.06)',
                  },
                  title: {
                    display: true,
                    text: metricLabel,
                    font: { size: 15, weight: 'bold' as const },
                  },
                },
                x: {
                  ticks: { font: { size: 13 } },
                  grid: {
                    color: 'rgba(15, 23, 42, 0.04)',
                  },
                  title: {
                    display: true,
                    text: 'Round',
                    font: { size: 15, weight: 'bold' as const },
                  },
                },
              },
              interaction: {
                intersect: false,
                mode: 'index' as const,
              },
              onHover: (_event, elements) => {
                if (elements.length > 0) {
                  const idx = elements[0]?.index;
                  if (typeof idx === 'number') {
                    const round = sortedMatches[idx]?.round;
                    setActivePointIndex(idx);
                    setActiveRound(typeof round === 'number' ? round : null);
                  } else {
                    setActivePointIndex(null);
                    setActiveRound(null);
                  }
                } else {
                  setActivePointIndex(null);
                  setActiveRound(null);
                }
              },
            }}
          />
        </div>
      ) : (
        <div className="flex h-80 items-center justify-center rounded-lg border border-dashed border-border bg-muted text-base text-muted-foreground">
          No {metricLabel.toLowerCase()} data for the selected filters.
        </div>
      )}

      {sortedMatches.length > 0 && (
        <div className="mt-5 rounded-xl border border-border bg-gradient-to-r from-muted via-white to-muted p-5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3 md:items-center">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Focused Round
              </p>
              <h3 className="mt-1 text-2xl font-bold text-foreground">
                R{focusedRound ?? '—'} vs {focusedAbbr}
              </h3>
              <p className="text-sm text-muted-foreground">
                {activePointIndex !== null || activeRound !== null
                  ? 'Hover active'
                  : 'Showing latest by default'}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-white px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {metricLabel}
              </p>
              <p className="text-4xl font-extrabold text-foreground">
                {focusedIsDnp
                  ? 'DNP'
                  : focusedHasUnavailableValue
                    ? '—'
                    : focusedValue !== null
                      ? focusedValue.toFixed(1)
                      : '—'}
              </p>
            </div>
            <div className="text-right">
              {focusedValue !== null && focusedDelta !== null ? (
                <p
                  className={`text-sm font-semibold ${
                    focusedDelta >= 0 ? 'text-success' : 'text-destructive'
                  }`}
                >
                  {focusedDelta >= 0 ? '+' : ''}
                  {focusedDelta.toFixed(1)} vs avg
                </p>
              ) : focusedHasUnavailableValue ? (
                <p className="text-sm font-semibold text-muted-foreground">
                  Stat unavailable for this match
                </p>
              ) : (
                <p className="text-sm font-semibold text-muted-foreground">No match recorded</p>
              )}
            </div>
          </div>
        </div>
      )}

      {sortedMatches.length > 0 && (
        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <span>Opponents by Round</span>
            <span>Rounds 1-24</span>
          </div>
          <p className="mb-3 text-sm text-muted-foreground">
            Hover a round to spotlight it on the chart.
          </p>
          <div className="grid grid-cols-8 gap-2">
            {roundSlots.map((slot) => {
              const opponent = slot.match?.opposition || 'DNP';
              const abbr = getTeamAbbreviation(opponent);
              const isActive = activeRound === slot.round;
              const isDnp = slot.match == null;
              return (
                <div
                  key={`round-${slot.round}`}
                  className={`flex cursor-pointer flex-col items-center rounded-lg border px-2 py-2 transition ${
                    isActive
                      ? 'border-teal-400 bg-teal-50/60 shadow-sm'
                      : 'border-border bg-muted hover:border-border'
                  }`}
                  title={isDnp ? `Round ${slot.round}: DNP` : `Round ${slot.round} vs ${opponent}`}
                  onMouseEnter={() => {
                    setActiveRound(slot.round);
                    setActivePointIndex(slot.chartIndex);
                    // Stage 1: highlight immediately, Stage 2: show tooltip after animation starts.
                    setChartTooltipAtIndex(null);
                    if (tooltipDelayTimerRef.current) clearTimeout(tooltipDelayTimerRef.current);
                    tooltipDelayTimerRef.current = setTimeout(() => {
                      setChartTooltipAtIndex(slot.chartIndex);
                    }, CHIP_HOVER_TOOLTIP_DELAY_MS);
                  }}
                  onMouseLeave={() => {
                    setActiveRound(null);
                    setActivePointIndex(null);
                    if (tooltipDelayTimerRef.current) clearTimeout(tooltipDelayTimerRef.current);
                    setChartTooltipAtIndex(null);
                  }}
                  onFocus={() => {
                    setActiveRound(slot.round);
                    setActivePointIndex(slot.chartIndex);
                    setChartTooltipAtIndex(null);
                    if (tooltipDelayTimerRef.current) clearTimeout(tooltipDelayTimerRef.current);
                    tooltipDelayTimerRef.current = setTimeout(() => {
                      setChartTooltipAtIndex(slot.chartIndex);
                    }, CHIP_HOVER_TOOLTIP_DELAY_MS);
                  }}
                  onBlur={() => {
                    setActiveRound(null);
                    setActivePointIndex(null);
                    if (tooltipDelayTimerRef.current) clearTimeout(tooltipDelayTimerRef.current);
                    setChartTooltipAtIndex(null);
                  }}
                  tabIndex={0}
                >
                  <span
                    className={`inline-flex h-8 min-w-8 items-center justify-center rounded-full px-2 text-xs font-bold ring-1 ${getAbbrBadgeClasses(abbr)}`}
                  >
                    {isDnp ? 'DNP' : abbr}
                  </span>
                  <span className="mt-1 text-xs font-semibold text-foreground">R{slot.round}</span>
                  <span className="text-[11px] font-medium text-muted-foreground">
                    {isDnp ? 'DNP' : abbr}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {sortedMatches.length > 0 && (
        <div className="mt-5 grid grid-cols-2 gap-3 text-base md:grid-cols-4">
          <div className="rounded-lg bg-muted p-3">
            <div className="text-muted-foreground">Average</div>
            <div className="text-xl font-bold text-foreground">{avg.toFixed(1)}</div>
          </div>
          <div className="rounded-lg bg-muted p-3">
            <div className="text-muted-foreground">Best</div>
            <div className="text-xl font-bold text-success">{best.toFixed(1)}</div>
          </div>
          <div className="rounded-lg bg-muted p-3">
            <div className="text-muted-foreground">Worst</div>
            <div className="text-xl font-bold text-destructive">{worst.toFixed(1)}</div>
          </div>
          <div className="rounded-lg bg-muted p-3">
            <div className="text-muted-foreground">Games</div>
            <div className="text-xl font-bold text-foreground">{sortedMatches.length}</div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PlayerChart;
