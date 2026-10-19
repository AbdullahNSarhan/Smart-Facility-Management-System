/**
 * Air-Gapped Local Chart Engine (Drop-in Local Chart.js Replacement for FIFO Sliding Window Telemetry)
 * Hosted locally at /public/standalone/chart.local.js — Zero external CDN dependencies.
 */
export class LocalFIFOChart {
  constructor(canvas, config) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.maxPoints = config.maxPoints || 30;
    this.label = config.label || 'Telemetry';
    this.unit = config.unit || '';
    this.color = config.color || '#00D2FF';
    this.dangerThreshold = config.dangerThreshold || null;
    this.minY = config.minY ?? 0;
    this.maxY = config.maxY ?? 100;
    this.labels = config.initialLabels ? [...config.initialLabels].slice(-this.maxPoints) : [];
    this.data = config.initialData ? [...config.initialData].slice(-this.maxPoints) : [];
    this.render();
  }

  pushDataPoint(timestampLabel, numericValue) {
    // Strict FIFO queue with max 30 points to prevent browser memory leaks
    if (this.labels.length >= this.maxPoints) {
      this.labels.shift();
    }
    if (this.data.length >= this.maxPoints) {
      this.data.shift();
    }
    this.labels.push(timestampLabel);
    this.data.push(Number(numericValue));
    this.render();
  }

  render() {
    if (!this.ctx) return;
    const width = this.canvas.width;
    const height = this.canvas.height;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, width, height);

    const padLeft = 44;
    const padRight = 16;
    const padTop = 18;
    const padBottom = 26;
    const plotW = width - padLeft - padRight;
    const plotH = height - padTop - padBottom;

    // Grid lines
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.12)';
    ctx.lineWidth = 1;
    ctx.font = '10px monospace';
    ctx.fillStyle = '#94A3B8';

    for (let i = 0; i <= 4; i++) {
      const ratio = i / 4;
      const y = padTop + plotH - ratio * plotH;
      const val = (this.minY + ratio * (this.maxY - this.minY)).toFixed(0);
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(width - padRight, y);
      ctx.stroke();
      ctx.fillText(`${val}${this.unit}`, 6, y + 3);
    }

    // Optional danger zone line
    if (this.dangerThreshold !== null) {
      const dRatio = Math.min(1, Math.max(0, (this.dangerThreshold - this.minY) / (this.maxY - this.minY)));
      const dy = padTop + plotH - dRatio * plotH;
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 46, 84, 0.65)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(padLeft, dy);
      ctx.lineTo(width - padRight, dy);
      ctx.stroke();
      ctx.restore();
    }

    if (this.data.length < 2) return;

    const points = this.data.map((val, idx) => {
      const x = padLeft + (idx / Math.max(1, this.maxPoints - 1)) * plotW;
      const clamped = Math.min(this.maxY, Math.max(this.minY, val));
      const y = padTop + plotH - ((clamped - this.minY) / (this.maxY - this.minY)) * plotH;
      return { x, y, val };
    });

    // Area gradient under curve
    const grad = ctx.createLinearGradient(0, padTop, 0, padTop + plotH);
    grad.addColorStop(0, this.color + '44');
    grad.addColorStop(1, this.color + '02');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(points[0].x, padTop + plotH);
    points.forEach((p) => ctx.lineTo(p.x, p.y));
    ctx.lineTo(points[points.length - 1].x, padTop + plotH);
    ctx.closePath();
    ctx.fill();

    // Line stroke
    ctx.strokeStyle = this.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    points.forEach((p, idx) => {
      if (idx === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();

    // Data vertices
    points.forEach((p, idx) => {
      const isDanger = this.dangerThreshold !== null && p.val >= this.dangerThreshold;
      ctx.fillStyle = isDanger ? '#FF2E54' : this.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, idx === points.length - 1 ? 3.5 : 2, 0, Math.PI * 2);
      ctx.fill();
    });
  }
}
window.LocalFIFOChart = LocalFIFOChart;
