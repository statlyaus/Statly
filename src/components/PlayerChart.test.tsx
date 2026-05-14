import '@testing-library/jest-dom/vitest';

import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import PlayerChart, {
  formatNullableMetricValue,
  summarizeNullableChartValues,
} from './PlayerChart';

const lineRenderMock = vi.fn();

vi.mock('chart.js', () => ({
  CategoryScale: class CategoryScale {},
  Chart: {
    register: vi.fn(),
  },
  Legend: class Legend {},
  LineElement: class LineElement {},
  LinearScale: class LinearScale {},
  PointElement: class PointElement {},
  Tooltip: class Tooltip {},
}));

vi.mock('react-chartjs-2', () => ({
  Line: (props: ComponentProps<'div'> & { data: unknown; options: unknown }) => {
    lineRenderMock(props);
    return <div data-testid="line-chart" />;
  },
}));

describe('PlayerChart nullable values', () => {
  beforeEach(() => {
    lineRenderMock.mockClear();
  });

  it('passes null values to Chart.js as gaps instead of converting them to zero', () => {
    render(
      <PlayerChart
        playerName="Test Player"
        metricLabel="Disposal Efficiency"
        matchData={[
          { round: 1, value: 72.5, opposition: 'Carlton' },
          { round: 2, value: null, opposition: 'Collingwood' },
          { round: 3, value: 84, opposition: 'Essendon' },
        ]}
      />
    );

    expect(screen.getByTestId('line-chart')).toBeInTheDocument();

    const props = lineRenderMock.mock.calls[0]?.[0] as {
      data: { datasets: Array<{ data: Array<number | null>; spanGaps?: boolean }> };
    };

    expect(props.data.datasets[0]?.data).toEqual([72.5, null, 84]);
    expect(props.data.datasets[0]?.spanGaps).toBe(false);
  });

  it('does not retain non-finite active values in the focused dataset', () => {
    render(
      <PlayerChart
        playerName="Test Player"
        metricLabel="Disposal Efficiency"
        matchData={[
          { round: 1, value: 72.5, opposition: 'Carlton' },
          { round: 2, value: Number.NaN, opposition: 'Collingwood' },
          { round: 3, value: 84, opposition: 'Essendon' },
        ]}
      />
    );

    const initialProps = lineRenderMock.mock.calls[0]?.[0] as {
      options: { onHover: (event: unknown, elements: Array<{ index: number }>) => void };
    };

    act(() => {
      initialProps.options.onHover({}, [{ index: 1 }]);
    });

    const focusedProps = lineRenderMock.mock.calls.at(-1)?.[0] as {
      data: { datasets: Array<{ data: Array<number | null> }> };
    };

    expect(focusedProps.data.datasets[1]?.data).toEqual([null, null, null]);
  });

  it('keeps focused missing rounds distinct from unavailable stats', () => {
    render(
      <PlayerChart
        playerName="Test Player"
        metricLabel="Disposal Efficiency"
        matchData={[
          { round: 1, value: 72.5, opposition: 'Carlton' },
          { round: 3, value: 84, opposition: 'Essendon' },
        ]}
      />
    );

    const dnpRoundChip = screen.getByTitle('Round 2: DNP');

    fireEvent.focus(dnpRoundChip);

    expect(
      screen.getByText((content, element) => {
        return (
          content === 'DNP' &&
          element?.tagName.toLowerCase() === 'p' &&
          element.className.includes('text-4xl')
        );
      })
    ).toBeInTheDocument();
    expect(screen.getByText('No match recorded')).toBeInTheDocument();
    expect(screen.queryByText('Not available')).not.toBeInTheDocument();
    expect(screen.queryByText('Stat unavailable for this match')).not.toBeInTheDocument();
  });

  it('summarizes only finite numeric chart values', () => {
    expect(summarizeNullableChartValues([72.5, null, 84])).toEqual({
      average: 78.25,
      best: 84,
      worst: 72.5,
      numericCount: 2,
      hasData: true,
    });
  });

  it('formats unavailable chart values without implying a zero result', () => {
    expect(formatNullableMetricValue(null)).toBe('Not available');
    expect(formatNullableMetricValue(72.5)).toBe('72.5');
  });
});
