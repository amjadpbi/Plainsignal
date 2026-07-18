'use client';

/**
 * Minimal dependency-free line chart for a single metric over time.
 * Auto-scales the y-axis to the data range (with padding) and renders a flat
 * mid-line when every value is identical, so an unchanged series still reads
 * clearly rather than collapsing to the axis.
 */
export function TrendChart({
  points,
  label,
  color,
  format = (n: number) => String(n),
}: {
  points: { t: number; v: number }[];
  label: string;
  color: string;
  format?: (n: number) => string;
}) {
  const W = 320;
  const H = 120;
  const PAD = { top: 12, right: 10, bottom: 20, left: 10 };

  const values = points.map((p) => p.v);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const flat = min === max;

  // Pad the domain so a line never sits exactly on the frame.
  const lo = flat ? min - 1 : min - (max - min) * 0.15;
  const hi = flat ? max + 1 : max + (max - min) * 0.15;

  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const x = (i: number) =>
    PAD.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - ((v - lo) / (hi - lo)) * innerH;

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p.v)}`).join(' ');

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-xs uppercase tracking-wide text-neutral-500">{label}</span>
        <span className="text-sm font-semibold tabular-nums">
          {format(points[points.length - 1]?.v ?? 0)}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${label} over time`}>
        {/* baseline */}
        <line
          x1={PAD.left}
          x2={W - PAD.right}
          y1={H - PAD.bottom}
          y2={H - PAD.bottom}
          className="stroke-neutral-200 dark:stroke-neutral-700"
          strokeWidth="1"
        />
        {points.length > 1 && (
          <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
        )}
        {points.map((p, i) => (
          <circle key={i} cx={x(i)} cy={y(p.v)} r="3.5" fill={color} />
        ))}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-neutral-400">
        <span>{points.length ? new Date(points[0].t).toLocaleString() : ''}</span>
        {points.length > 1 && (
          <span>{new Date(points[points.length - 1].t).toLocaleString()}</span>
        )}
      </div>
      {flat && points.length > 1 && (
        <p className="mt-1 text-[10px] text-neutral-400">No change across captures.</p>
      )}
    </div>
  );
}
