import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TrendChart } from '@/components/trend-chart';

/**
 * Renders the real trend chart component (no JSX so no extra transform config).
 * Guards the property the trend view exists for: multiple dated captures must
 * each show up as a plotted point.
 */
function render(points: { t: number; v: number }[]) {
  return renderToStaticMarkup(
    createElement(TrendChart, { points, label: 'Competition', color: '#ef4444' }),
  );
}

function countPoints(html: string): number {
  return (html.match(/<circle/g) ?? []).length;
}

describe('TrendChart', () => {
  it('plots one dot for a single capture and draws no line', () => {
    const html = render([{ t: Date.parse('2026-07-18T19:49:01Z'), v: 98 }]);
    expect(countPoints(html)).toBe(1);
    expect(html).not.toContain('<path');
  });

  it('plots BOTH captures and connects them (the real two-snapshot case)', () => {
    // The exact values persisted during the live two-run verification.
    const html = render([
      { t: Date.parse('2026-07-18T19:49:01.559Z'), v: 98 },
      { t: Date.parse('2026-07-18T19:50:17.675Z'), v: 98 },
    ]);
    expect(countPoints(html)).toBe(2);
    expect(html).toContain('<path');
    // An unchanged series is labeled rather than collapsing onto the axis.
    expect(html).toContain('No change across captures.');
  });

  it('plots a moving series with distinct y positions', () => {
    const html = render([
      { t: 1, v: 1000 },
      { t: 2, v: 4200 },
      { t: 3, v: 2500 },
    ]);
    expect(countPoints(html)).toBe(3);
    expect(html).not.toContain('No change across captures.');

    // Distinct values must map to distinct vertical positions.
    const ys = Array.from(html.matchAll(/cy="([\d.]+)"/g)).map((m) => Number(m[1]));
    expect(new Set(ys).size).toBe(3);
  });

  it('shows the latest value as the headline figure', () => {
    const html = render([
      { t: 1, v: 100 },
      { t: 2, v: 777 },
    ]);
    expect(html).toContain('777');
  });
});
