import { memo } from 'react';

export type SparklineProps = {
  values: number[];
  width?: number;
  height?: number;
};

export const Sparkline = memo(({ values, width = 120, height = 32 }: SparklineProps) => {
  // Return nothing only when values are truly missing (null/undefined)
  if (values == null) return null;

  // For empty arrays, render a lightweight, accessible placeholder that matches dimensions
  if (values.length === 0) {
    return (
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="No data"
      />
    );
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const hasVariance = max !== min;
  const range = hasVariance ? max - min : 1;
  const step = values.length > 1 ? width / (values.length - 1) : width;

  const points = values
    .map((value, index) => {
      const x = index * step;
      const y = hasVariance ? height - ((value - min) / range) * height : height / 2;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Data trend"
    >
      <polyline fill="none" stroke="currentColor" strokeWidth="2" points={points} />
    </svg>
  );
});

Sparkline.displayName = 'Sparkline';
