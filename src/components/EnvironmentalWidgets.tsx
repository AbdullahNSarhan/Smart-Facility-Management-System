import React, { useEffect, useRef } from 'react';

interface CircularGaugeProps {
  label: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  dangerThreshold?: number;
  warningThreshold?: number;
  accentColor: string;
  subtitle: string;
}

export const CircularGauge: React.FC<CircularGaugeProps> = ({
  label,
  value,
  min,
  max,
  unit,
  dangerThreshold,
  warningThreshold,
  accentColor,
  subtitle,
}) => {
  const clamped = Math.min(max, Math.max(min, value));
  const ratio = (clamped - min) / (max - min);
  const radius = 58;
  const circumference = 2 * Math.PI * radius;
  const arcLength = circumference * 0.75;
  const dashOffset = arcLength - ratio * arcLength;

  const isDanger = dangerThreshold !== undefined && value >= dangerThreshold;
  const isWarning =
    !isDanger && warningThreshold !== undefined && value >= warningThreshold;

  // Soft Coral for Danger, Soft Amber for Warning, Soft Mint/Blue for Normal
  const activeColor = isDanger
    ? 'var(--soft-coral-strong)'
    : isWarning
    ? 'var(--soft-amber)'
    : accentColor;

  const statusLabel = isDanger
    ? 'CRITICAL DANGER ZONE'
    : isWarning
    ? 'ELEVATED WARNING'
    : 'NOMINAL OPERATING RANGE';

  return (
    <div className="lci-surface rounded-xl p-5 flex flex-col items-center justify-between">
      <div className="w-full flex items-center justify-between text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>
        <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{label}</span>
        <span className="font-mono tabular-nums">
          {min}–{max} {unit}
        </span>
      </div>

      <div className="relative w-40 h-40 flex items-center justify-center my-1">
        <svg className="w-full h-full -rotate-[225deg]" viewBox="0 0 140 140">
          {/* Background Track */}
          <circle
            cx="70"
            cy="70"
            r={radius}
            fill="none"
            stroke="var(--border-subtle)"
            strokeWidth="10"
            strokeDasharray={`${arcLength} ${circumference}`}
            strokeLinecap="round"
          />
          {/* Soft Coral Danger Zone Arc */}
          {dangerThreshold !== undefined && (
            <circle
              cx="70"
              cy="70"
              r={radius}
              fill="none"
              stroke="rgba(251, 113, 133, 0.25)"
              strokeWidth="10"
              strokeDasharray={`${
                arcLength * ((max - dangerThreshold) / (max - min))
              } ${circumference}`}
              strokeDashoffset={
                -arcLength * ((dangerThreshold - min) / (max - min))
              }
              strokeLinecap="butt"
            />
          )}
          {/* Active Value Arc */}
          <circle
            cx="70"
            cy="70"
            r={radius}
            fill="none"
            stroke={activeColor}
            strokeWidth="10"
            strokeDasharray={`${arcLength} ${circumference}`}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            style={{
              transition: 'stroke-dashoffset 180ms cubic-bezier(0.16, 1, 0.3, 1), stroke 180ms ease',
            }}
          />
        </svg>

        {/* Center Readout */}
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span
            className="text-2xl font-bold font-mono tabular-nums tracking-tight"
            style={{ color: activeColor }}
          >
            {typeof value === 'number' && !Number.isInteger(value)
              ? value.toFixed(1)
              : value}
            <span className="text-xs font-normal ml-0.5" style={{ color: 'var(--text-secondary)' }}>
              {unit}
            </span>
          </span>
          <span className="text-[11px] mt-1" style={{ color: 'var(--text-secondary)' }}>
            {subtitle}
          </span>
        </div>
      </div>

      <div
        className="w-full pt-3 flex items-center justify-between text-xs"
        style={{ borderTop: '1px solid var(--border-subtle)' }}
      >
        <span style={{ color: 'var(--text-secondary)' }}>Sensor Status</span>
        <span
          className="font-mono tabular-nums font-medium"
          style={{ color: activeColor }}
        >
          {statusLabel}
        </span>
      </div>
    </div>
  );
};

interface FifoLineChartProps {
  title: string;
  variableName: string;
  labels: string[];
  data: number[];
  unit: string;
  minY: number;
  maxY: number;
  color: string;
  dangerThreshold?: number;
  theme?: 'dark' | 'light';
}

export const FifoLineChart: React.FC<FifoLineChartProps> = ({
  title,
  variableName,
  labels,
  data,
  unit,
  minY,
  maxY,
  color,
  dangerThreshold,
  theme = 'dark',
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    const padLeft = 48;
    const padRight = 18;
    const padTop = 18;
    const padBottom = 28;
    const plotW = width - padLeft - padRight;
    const plotH = height - padTop - padBottom;

    // Soft grid lines & Y axis labels
    ctx.strokeStyle =
      theme === 'light'
        ? 'rgba(100, 116, 139, 0.16)'
        : 'rgba(148, 163, 184, 0.14)';
    ctx.lineWidth = 1;
    ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillStyle = theme === 'light' ? '#475569' : '#94A3B8';

    for (let i = 0; i <= 4; i++) {
      const ratio = i / 4;
      const y = padTop + plotH - ratio * plotH;
      const val = (minY + ratio * (maxY - minY)).toFixed(0);
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(width - padRight, y);
      ctx.stroke();
      ctx.fillText(`${val}${unit}`, 6, y + 4);
    }

    // Soft Coral Danger threshold line
    if (dangerThreshold !== undefined) {
      const dRatio = Math.min(
        1,
        Math.max(0, (dangerThreshold - minY) / (maxY - minY))
      );
      const dy = padTop + plotH - dRatio * plotH;
      ctx.save();
      ctx.strokeStyle = 'rgba(251, 113, 133, 0.75)';
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(padLeft, dy);
      ctx.lineTo(width - padRight, dy);
      ctx.stroke();
      ctx.fillStyle = theme === 'light' ? '#e11d48' : '#fb7185';
      ctx.fillText(`ALARM ≥ ${dangerThreshold}${unit}`, width - 135, dy - 5);
      ctx.restore();
    }

    const windowSlice = data.slice(-30);
    const labelSlice = labels.slice(-30);
    if (windowSlice.length < 2) return;

    const maxPts = 30;
    const points = windowSlice.map((val, idx) => {
      const x = padLeft + (idx / Math.max(1, maxPts - 1)) * plotW;
      const clamped = Math.min(maxY, Math.max(minY, val));
      const y =
        padTop + plotH - ((clamped - minY) / (maxY - minY)) * plotH;
      return { x, y, val, label: labelSlice[idx] || '' };
    });

    // Soft Area fill under curve
    const grad = ctx.createLinearGradient(0, padTop, 0, padTop + plotH);
    grad.addColorStop(0, `${color}36`);
    grad.addColorStop(1, `${color}03`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(points[0].x, padTop + plotH);
    points.forEach((p) => ctx.lineTo(p.x, p.y));
    ctx.lineTo(points[points.length - 1].x, padTop + plotH);
    ctx.closePath();
    ctx.fill();

    // Main line stroke
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    points.forEach((p, idx) => {
      if (idx === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();

    // Points & X-axis timestamps
    points.forEach((p, idx) => {
      const isDanger =
        dangerThreshold !== undefined && p.val >= dangerThreshold;
      ctx.fillStyle = isDanger ? '#fb7185' : color;
      ctx.beginPath();
      ctx.arc(
        p.x,
        p.y,
        idx === points.length - 1 ? 4 : 2.2,
        0,
        Math.PI * 2
      );
      ctx.fill();

      if (
        idx === 0 ||
        idx === Math.floor(points.length / 2) ||
        idx === points.length - 1
      ) {
        ctx.fillStyle = theme === 'light' ? '#64748b' : '#64748B';
        ctx.fillText(p.label, Math.max(padLeft, p.x - 24), height - 8);
      }
    });
  }, [labels, data, minY, maxY, unit, color, dangerThreshold, theme]);

  const latestVal = data.length > 0 ? data[data.length - 1] : 0;

  return (
    <div className="lci-surface rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            {title}
          </h3>
          <p className="text-xs font-mono tabular-nums" style={{ color: 'var(--text-secondary)' }}>
            Variable: {variableName} · Sliding Window FIFO ({data.length}/30 pts)
          </p>
        </div>
        <div className="text-right font-mono tabular-nums">
          <span className="text-lg font-bold" style={{ color }}>
            {typeof latestVal === 'number' && !Number.isInteger(latestVal)
              ? latestVal.toFixed(1)
              : latestVal}
            {unit}
          </span>
        </div>
      </div>
      <canvas
        ref={canvasRef}
        width={620}
        height={210}
        className="w-full h-48 block rounded-lg lci-input"
      />
    </div>
  );
};
