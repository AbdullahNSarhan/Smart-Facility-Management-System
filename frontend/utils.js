// LCI-SFM Frontend Utility Module — Zero External Dependencies, Safe DOM Construction

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  if (attrs && typeof attrs === 'object') {
    for (const [key, val] of Object.entries(attrs)) {
      if (val === undefined || val === null || val === false) continue;
      if (key === 'class' || key === 'className') {
        node.className = String(val);
      } else if (key === 'text') {
        node.textContent = String(val);
      } else if (key === 'dataset' && typeof val === 'object') {
        for (const [dk, dv] of Object.entries(val)) {
          if (dv !== undefined && dv !== null) node.dataset[dk] = String(dv);
        }
      } else if (key.startsWith('on') && typeof val === 'function') {
        node.addEventListener(key.slice(2).toLowerCase(), val);
      } else if (key === 'value' && ('value' in node)) {
        node.value = String(val);
      } else if (key === 'checked' && ('checked' in node)) {
        node.checked = Boolean(val);
      } else if (key === 'disabled' && ('disabled' in node)) {
        node.disabled = Boolean(val);
      } else if (key === 'selected' && ('selected' in node)) {
        node.selected = Boolean(val);
      } else if (val === true) {
        node.setAttribute(key, '');
      } else {
        node.setAttribute(key, String(val));
      }
    }
  }
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child === null || child === undefined || child === false) continue;
    if (child instanceof Node) {
      node.appendChild(child);
    } else {
      node.appendChild(document.createTextNode(String(child)));
    }
  }
  return node;
}

export function clear(node) {
  if (!node) return;
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function svgIcon(symbolId, size = 18, className = '') {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', className ? `icon ${className}` : 'icon');
  const use = document.createElementNS(ns, 'use');
  use.setAttribute('href', `#${symbolId}`);
  svg.appendChild(use);
  return svg;
}

export function formatTimestamp(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
}

export function formatShortTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
}

export function formatAge(iso, nowMs = Date.now()) {
  if (!iso) return 'Never';
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return 'Unknown';
  const diffSec = Math.max(0, Math.floor((nowMs - ts) / 1000));
  if (diffSec < 5) return 'Just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const min = Math.floor(diffSec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h ${min % 60}m ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

export function formatNumber(val, decimals = 1) {
  if (val === null || val === undefined || val === '') return '—';
  const n = Number(val);
  if (!Number.isFinite(n)) return String(val);
  return Number.isInteger(n) && decimals === 0 ? String(n) : n.toFixed(decimals);
}

export function formatEndpointValue(val, endpoint = {}) {
  if (val === null || val === undefined) return '—';
  if (typeof val === 'boolean') {
    return val ? 'TRUE' : 'FALSE';
  }
  if (typeof val === 'number') {
    const unit = endpoint.unit ? ` ${endpoint.unit}` : '';
    const isInt = Math.abs(val - Math.round(val)) < 1e-6;
    return `${isInt ? String(Math.round(val)) : val.toFixed(1)}${unit}`;
  }
  return endpoint.unit ? `${String(val)} ${endpoint.unit}` : String(val);
}

export function formatUptime(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds || 0)));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${rem}s`;
  if (m > 0) return `${m}m ${rem}s`;
  return `${rem}s`;
}

export function sanitizeRedirectPath(raw) {
  if (typeof raw !== 'string') return '/app/overview';
  const trimmed = raw.trim();
  if (!trimmed.startsWith('/app')) return '/app/overview';
  if (trimmed.startsWith('//') || trimmed.includes('://') || /[\r\n\\]/.test(trimmed)) {
    return '/app/overview';
  }
  return trimmed;
}

export function exportRowsToCsv(filename, columns, rows) {
  const escapeCell = (value) => {
    const str = value === null || value === undefined ? '' : String(value);
    const safe = /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const header = columns.map((c) => escapeCell(c.label)).join(',');
  const lines = rows.map((row) =>
    columns.map((c) => escapeCell(typeof c.get === 'function' ? c.get(row) : row[c.key])).join(',')
  );
  const csv = [header, ...lines].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function buildSparklineSvg(values, options = {}) {
  const width = options.width || 110;
  const height = options.height || 28;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('class', options.className || 'sparkline-svg');
  svg.setAttribute('aria-hidden', 'true');

  const nums = (values || []).map(Number).filter((n) => Number.isFinite(n));
  if (nums.length < 2) {
    const line = document.createElementNS(ns, 'line');
    line.setAttribute('x1', '2');
    line.setAttribute('y1', String(height / 2));
    line.setAttribute('x2', String(width - 2));
    line.setAttribute('y2', String(height / 2));
    line.setAttribute('stroke', 'currentColor');
    line.setAttribute('stroke-opacity', '0.25');
    line.setAttribute('stroke-width', '1.5');
    line.setAttribute('stroke-dasharray', '3 3');
    svg.appendChild(line);
    return svg;
  }

  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const span = max - min || 1;
  const pad = 3;
  const pts = nums.map((v, idx) => {
    const x = pad + (idx / (nums.length - 1)) * (width - pad * 2);
    const y = height - pad - ((v - min) / span) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const poly = document.createElementNS(ns, 'polyline');
  poly.setAttribute('fill', 'none');
  poly.setAttribute('stroke', 'currentColor');
  poly.setAttribute('stroke-width', '1.75');
  poly.setAttribute('stroke-linecap', 'round');
  poly.setAttribute('stroke-linejoin', 'round');
  poly.setAttribute('points', pts.join(' '));
  svg.appendChild(poly);
  return svg;
}

function formatChartAxisTime(iso, spanMs = 0, rangePreset = '') {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const longRange = spanMs >= 6 * 3600 * 1000 || ['24h', '7d', 'all'].includes(String(rangePreset).toLowerCase());
  if (longRange) {
    return d.toLocaleString(undefined, {
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
  }
  return formatShortTime(iso);
}

const ACCESS_STATE_ORDER = ['LOCKED', 'CLOSED', 'UNLOCKED', 'OPEN'];

function resolveChartMode(samples, options = {}) {
  const kind = String(options.kind || '').toUpperCase();
  const dataType = String(options.dataType || '').toUpperCase();
  if (kind === 'ACCESS') {
    return {
      step: true,
      ticks: [
        { val: 0, label: 'LOCKED' },
        { val: 1, label: 'CLOSED' },
        { val: 2, label: 'UNLOCKED' },
        { val: 3, label: 'OPEN' }
      ],
      min: -0.25,
      max: 3.25,
      parse: (raw) => {
        const idx = ACCESS_STATE_ORDER.indexOf(String(raw ?? '').toUpperCase());
        return idx >= 0 ? idx : NaN;
      }
    };
  }
  if (kind === 'SWITCH') {
    return {
      step: true,
      ticks: [
        { val: 0, label: 'OFF' },
        { val: 1, label: 'ON' }
      ],
      min: -0.2,
      max: 1.2,
      parse: (raw) => {
        if (typeof raw === 'boolean') return raw ? 1 : 0;
        const s = String(raw ?? '').toUpperCase();
        if (s === 'ON' || s === 'TRUE' || s === '1') return 1;
        if (s === 'OFF' || s === 'FALSE' || s === '0') return 0;
        return NaN;
      }
    };
  }
  if (dataType === 'BOOLEAN') {
    return {
      step: true,
      ticks: [
        { val: 0, label: 'FALSE' },
        { val: 1, label: 'TRUE' }
      ],
      min: -0.2,
      max: 1.2,
      parse: (raw) => {
        if (typeof raw === 'boolean') return raw ? 1 : 0;
        const s = String(raw ?? '').toUpperCase();
        if (s === 'TRUE' || s === 'ON' || s === '1') return 1;
        if (s === 'FALSE' || s === 'OFF' || s === '0') return 0;
        return NaN;
      }
    };
  }
  return {
    step: false,
    ticks: null,
    min: null,
    max: null,
    parse: (raw) => (typeof raw === 'boolean' ? (raw ? 1 : 0) : Number(raw))
  };
}

export function buildHistoryChartSvg(samples, options = {}) {
  const width = options.width || 720;
  const height = options.height || 240;
  const unit = options.unit ? ` ${options.unit}` : '';
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('class', 'history-chart-svg');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', options.label || 'Endpoint history chart');

  const mode = resolveChartMode(samples, options);
  const padL = mode.ticks ? 74 : 58;
  const padR = 18;
  const padT = 16;
  const padB = 32;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const valid = (samples || [])
    .map((s) => ({
      ts: Date.parse(s.observed_at || s.timestamp || ''),
      iso: s.observed_at || s.timestamp || '',
      val: mode.parse(s.value)
    }))
    .filter((s) => Number.isFinite(s.val))
    .sort((a, b) => (Number.isFinite(a.ts) && Number.isFinite(b.ts) ? a.ts - b.ts : 0));

  if (valid.length === 0) {
    const text = document.createElementNS(ns, 'text');
    text.setAttribute('x', String(width / 2));
    text.setAttribute('y', String(height / 2));
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('fill', 'currentColor');
    text.setAttribute('opacity', '0.55');
    text.setAttribute('font-size', '13');
    text.textContent = 'No history samples recorded in the selected window';
    svg.appendChild(text);
    return svg;
  }

  let min = mode.min !== null ? mode.min : Math.min(...valid.map((v) => v.val));
  let max = mode.max !== null ? mode.max : Math.max(...valid.map((v) => v.val));
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const span = max - min;

  // Grid lines and Y labels
  if (mode.ticks) {
    for (const t of mode.ticks) {
      const y = padT + (1 - (t.val - min) / span) * plotH;
      const line = document.createElementNS(ns, 'line');
      line.setAttribute('x1', String(padL));
      line.setAttribute('y1', y.toFixed(1));
      line.setAttribute('x2', String(width - padR));
      line.setAttribute('y2', y.toFixed(1));
      line.setAttribute('class', 'chart-grid-line');
      svg.appendChild(line);

      const lbl = document.createElementNS(ns, 'text');
      lbl.setAttribute('x', String(padL - 8));
      lbl.setAttribute('y', (y + 4).toFixed(1));
      lbl.setAttribute('text-anchor', 'end');
      lbl.setAttribute('class', 'chart-axis-label');
      lbl.textContent = t.label;
      svg.appendChild(lbl);
    }
  } else {
    const ticks = 4;
    for (let i = 0; i <= ticks; i++) {
      const ratio = i / ticks;
      const y = padT + ratio * plotH;
      const val = max - ratio * span;

      const line = document.createElementNS(ns, 'line');
      line.setAttribute('x1', String(padL));
      line.setAttribute('y1', y.toFixed(1));
      line.setAttribute('x2', String(width - padR));
      line.setAttribute('y2', y.toFixed(1));
      line.setAttribute('class', 'chart-grid-line');
      svg.appendChild(line);

      const lbl = document.createElementNS(ns, 'text');
      lbl.setAttribute('x', String(padL - 8));
      lbl.setAttribute('y', (y + 4).toFixed(1));
      lbl.setAttribute('text-anchor', 'end');
      lbl.setAttribute('class', 'chart-axis-label');
      lbl.textContent = `${val.toFixed(1)}${unit}`;
      svg.appendChild(lbl);
    }
  }

  const tsValues = valid.map((v) => v.ts).filter((t) => Number.isFinite(t));
  const minTs = tsValues.length > 0 ? Math.min(...tsValues) : NaN;
  const maxTs = tsValues.length > 0 ? Math.max(...tsValues) : NaN;
  const tsSpan = Number.isFinite(minTs) && Number.isFinite(maxTs) ? maxTs - minTs : 0;

  const pts = valid.map((pt, i) => {
    let x;
    if (valid.length === 1) {
      x = padL + plotW / 2;
    } else if (tsSpan > 0 && Number.isFinite(pt.ts)) {
      x = padL + ((pt.ts - minTs) / tsSpan) * plotW;
    } else {
      x = padL + (i / (valid.length - 1)) * plotW;
    }
    const y = padT + (1 - (pt.val - min) / span) * plotH;
    return { x, y, pt };
  });

  if (pts.length >= 2) {
    let pathD = '';
    if (mode.step) {
      const cmds = [`M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`];
      for (let i = 1; i < pts.length; i++) {
        cmds.push(`H${pts[i].x.toFixed(1)}`);
        cmds.push(`V${pts[i].y.toFixed(1)}`);
      }
      pathD = cmds.join(' ');
    } else {
      pathD = pts.map((p, idx) => `${idx === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    }
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', pathD);
    path.setAttribute('fill', 'none');
    path.setAttribute('class', 'chart-series-line');
    svg.appendChild(path);
  }

  if (pts.length <= 60) {
    for (const p of pts) {
      const c = document.createElementNS(ns, 'circle');
      c.setAttribute('cx', p.x.toFixed(1));
      c.setAttribute('cy', p.y.toFixed(1));
      c.setAttribute('r', '2.5');
      c.setAttribute('class', 'chart-series-dot');
      svg.appendChild(c);
    }
  }

  // X start / mid / end timestamps (date+time on longer ranges)
  const firstLbl = document.createElementNS(ns, 'text');
  firstLbl.setAttribute('x', String(padL));
  firstLbl.setAttribute('y', String(height - 8));
  firstLbl.setAttribute('class', 'chart-axis-label');
  firstLbl.textContent = formatChartAxisTime(valid[0].iso, tsSpan, options.rangePreset);
  svg.appendChild(firstLbl);

  if (valid.length > 2 && tsSpan > 0) {
    const midIso = new Date(minTs + tsSpan / 2).toISOString();
    const midLbl = document.createElementNS(ns, 'text');
    midLbl.setAttribute('x', (padL + plotW / 2).toFixed(1));
    midLbl.setAttribute('y', String(height - 8));
    midLbl.setAttribute('text-anchor', 'middle');
    midLbl.setAttribute('class', 'chart-axis-label');
    midLbl.textContent = formatChartAxisTime(midIso, tsSpan, options.rangePreset);
    svg.appendChild(midLbl);
  }

  if (valid.length > 1) {
    const lastLbl = document.createElementNS(ns, 'text');
    lastLbl.setAttribute('x', String(width - padR));
    lastLbl.setAttribute('y', String(height - 8));
    lastLbl.setAttribute('text-anchor', 'end');
    lastLbl.setAttribute('class', 'chart-axis-label');
    lastLbl.textContent = formatChartAxisTime(valid[valid.length - 1].iso, tsSpan, options.rangePreset);
    svg.appendChild(lastLbl);
  }

  return svg;
}

export function buildRollupChartSvg(buckets, options = {}) {
  const width = options.width || 720;
  const height = options.height || 220;
  const metric = options.metric || 'temperature'; // 'temperature' | 'humidity'
  const unit = metric === 'humidity' ? ' %' : ' °C';
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('class', 'history-chart-svg');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', options.label || 'Time-bucketed environmental rollup chart');

  const padL = 58;
  const padR = 18;
  const padT = 16;
  const padB = 32;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const valid = (buckets || [])
    .map((b) => ({
      ts: Number.isFinite(Number(b.timestamp_ms)) ? Number(b.timestamp_ms) : Date.parse(b.timestamp || ''),
      iso: b.timestamp || '',
      avg: Number(b[`${metric}_avg`]),
      min: Number(b[`${metric}_min`]),
      max: Number(b[`${metric}_max`]),
      count: Number(b.sample_count || 0)
    }))
    .filter((b) => Number.isFinite(b.avg) && Number.isFinite(b.min) && Number.isFinite(b.max))
    .sort((a, b) => a.ts - b.ts);

  if (valid.length === 0) {
    const text = document.createElementNS(ns, 'text');
    text.setAttribute('x', String(width / 2));
    text.setAttribute('y', String(height / 2));
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('fill', 'currentColor');
    text.setAttribute('opacity', '0.55');
    text.setAttribute('font-size', '13');
    text.textContent = 'No environmental rollup buckets in selected range';
    svg.appendChild(text);
    return svg;
  }

  let min = Math.min(...valid.map((v) => v.min));
  let max = Math.max(...valid.map((v) => v.max));
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const span = max - min;

  for (let i = 0; i <= 4; i++) {
    const ratio = i / 4;
    const y = padT + ratio * plotH;
    const val = max - ratio * span;
    const line = document.createElementNS(ns, 'line');
    line.setAttribute('x1', String(padL));
    line.setAttribute('y1', y.toFixed(1));
    line.setAttribute('x2', String(width - padR));
    line.setAttribute('y2', y.toFixed(1));
    line.setAttribute('class', 'chart-grid-line');
    svg.appendChild(line);

    const lbl = document.createElementNS(ns, 'text');
    lbl.setAttribute('x', String(padL - 8));
    lbl.setAttribute('y', (y + 4).toFixed(1));
    lbl.setAttribute('text-anchor', 'end');
    lbl.setAttribute('class', 'chart-axis-label');
    lbl.textContent = `${val.toFixed(1)}${unit}`;
    svg.appendChild(lbl);
  }

  const minTs = valid[0].ts;
  const maxTs = valid[valid.length - 1].ts;
  const tsSpan = Math.max(0, maxTs - minTs);

  const pts = valid.map((pt, idx) => {
    const x =
      valid.length === 1
        ? padL + plotW / 2
        : tsSpan > 0
          ? padL + ((pt.ts - minTs) / tsSpan) * plotW
          : padL + (idx / (valid.length - 1)) * plotW;
    return {
      x,
      yAvg: padT + (1 - (pt.avg - min) / span) * plotH,
      yMin: padT + (1 - (pt.min - min) / span) * plotH,
      yMax: padT + (1 - (pt.max - min) / span) * plotH,
      pt
    };
  });

  if (pts.length >= 2) {
    const upper = pts.map((p, idx) => `${idx === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.yMax.toFixed(1)}`).join(' ');
    const lower = [...pts]
      .reverse()
      .map((p) => `L${p.x.toFixed(1)},${p.yMin.toFixed(1)}`)
      .join(' ');
    const band = document.createElementNS(ns, 'path');
    band.setAttribute('d', `${upper} ${lower} Z`);
    band.setAttribute('class', 'chart-band-area');
    svg.appendChild(band);

    const avgPath = document.createElementNS(ns, 'path');
    avgPath.setAttribute(
      'd',
      pts.map((p, idx) => `${idx === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.yAvg.toFixed(1)}`).join(' ')
    );
    avgPath.setAttribute('fill', 'none');
    avgPath.setAttribute('class', 'chart-series-line');
    svg.appendChild(avgPath);
  }

  for (const p of pts) {
    const c = document.createElementNS(ns, 'circle');
    c.setAttribute('cx', p.x.toFixed(1));
    c.setAttribute('cy', p.yAvg.toFixed(1));
    c.setAttribute('r', '2.5');
    c.setAttribute('class', 'chart-series-dot');
    svg.appendChild(c);
  }

  const firstLbl = document.createElementNS(ns, 'text');
  firstLbl.setAttribute('x', String(padL));
  firstLbl.setAttribute('y', String(height - 8));
  firstLbl.setAttribute('class', 'chart-axis-label');
  firstLbl.textContent = formatChartAxisTime(valid[0].iso, tsSpan, options.rangePreset);
  svg.appendChild(firstLbl);

  if (valid.length > 1) {
    const lastLbl = document.createElementNS(ns, 'text');
    lastLbl.setAttribute('x', String(width - padR));
    lastLbl.setAttribute('y', String(height - 8));
    lastLbl.setAttribute('text-anchor', 'end');
    lastLbl.setAttribute('class', 'chart-axis-label');
    lastLbl.textContent = formatChartAxisTime(valid[valid.length - 1].iso, tsSpan, options.rangePreset);
    svg.appendChild(lastLbl);
  }

  return svg;
}
