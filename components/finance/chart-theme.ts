// Recharts takes colours as SVG attributes, which dark: classes can't reach.
// The chart's container sets these variables per theme and the chart reads them.
export const CHART_THEME_VARS = [
  '[--chart-grid:#e7e5e4] dark:[--chart-grid:rgba(255,255,255,0.08)]',
  '[--chart-zero:#d6d3d1] dark:[--chart-zero:rgba(255,255,255,0.2)]',
  '[--chart-cursor:#f5f5f4] dark:[--chart-cursor:rgba(255,255,255,0.1)]',
  '[--chart-balance:#1e3a5f] dark:[--chart-balance:var(--color-navy-200)]',
].join(' ');

export const CHART_GRID = 'var(--chart-grid)';
export const CHART_ZERO = 'var(--chart-zero)';
export const CHART_CURSOR = { fill: 'var(--chart-cursor)', opacity: 0.5 };
export const CHART_BALANCE = 'var(--chart-balance)';
