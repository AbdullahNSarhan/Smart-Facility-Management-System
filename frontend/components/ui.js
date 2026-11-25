// LCI-SFM Shared UI Primitives — Consistent Status Semantics, Adaptive Collections, Skeletons & Copyables
import { el, svgIcon } from '../utils.js';
import { showToast } from '../store.js';

/**
 * 6-state semantic mapping (never color-only: always icon + color + explicit label).
 * States: ok | warn | crit | info | pending | muted
 */
const STATUS_MAP = {
  // OK / Healthy
  ONLINE: { tone: 'ok', icon: 'icon-check-circle', label: 'Online' },
  FRESH: { tone: 'ok', icon: 'icon-check-circle', label: 'Fresh' },
  HEALTHY: { tone: 'ok', icon: 'icon-check-circle', label: 'Healthy' },
  READY: { tone: 'ok', icon: 'icon-check-circle', label: 'Ready' },
  CONNECTED: { tone: 'ok', icon: 'icon-check-circle', label: 'Connected' },
  ACTIVE: { tone: 'ok', icon: 'icon-check-circle', label: 'Active' },
  ASSIGNED: { tone: 'ok', icon: 'icon-check-circle', label: 'Assigned' },
  PROVISIONED: { tone: 'ok', icon: 'icon-check-circle', label: 'Provisioned' },
  RESOLVED: { tone: 'ok', icon: 'icon-check-circle', label: 'Resolved' },
  STATE_REPORTED: { tone: 'ok', icon: 'icon-check-circle', label: 'State Reported' },
  STATE_CONFIRMED: { tone: 'ok', icon: 'icon-check-circle', label: 'State Confirmed' },
  EXECUTED: { tone: 'ok', icon: 'icon-check-circle', label: 'Executed' },
  GRANTED: { tone: 'ok', icon: 'icon-check-circle', label: 'Granted' },
  VERIFIED: { tone: 'ok', icon: 'icon-check-circle', label: 'Verified' },
  APPROVED: { tone: 'ok', icon: 'icon-check-circle', label: 'Approved' },

  // Warning / Stale / Degraded
  WARNING: { tone: 'warn', icon: 'icon-warning', label: 'Warning' },
  WARN: { tone: 'warn', icon: 'icon-warning', label: 'Warning' },
  STALE: { tone: 'warn', icon: 'icon-clock', label: 'Stale' },
  DEGRADED: { tone: 'warn', icon: 'icon-warning', label: 'Degraded' },
  ATTENTION: { tone: 'warn', icon: 'icon-warning', label: 'Attention' },
  ACKNOWLEDGED: { tone: 'warn', icon: 'icon-clock', label: 'Acknowledged' },
  DRIFT: { tone: 'warn', icon: 'icon-warning', label: 'Manifest Drift' },
  SUSPENDED: { tone: 'warn', icon: 'icon-clock', label: 'Suspended' },
  BLOCKED: { tone: 'warn', icon: 'icon-lock', label: 'Blocked' },
  TIMED_OUT: { tone: 'warn', icon: 'icon-clock', label: 'Timed Out' },

  // Critical / Error / Offline / Denied
  CRITICAL: { tone: 'crit', icon: 'icon-x-circle', label: 'Critical' },
  ERROR: { tone: 'crit', icon: 'icon-x-circle', label: 'Error' },
  OFFLINE: { tone: 'crit', icon: 'icon-x-circle', label: 'Offline' },
  DISCONNECTED: { tone: 'crit', icon: 'icon-x-circle', label: 'Disconnected' },
  FAILED: { tone: 'crit', icon: 'icon-x-circle', label: 'Failed' },
  REJECTED: { tone: 'crit', icon: 'icon-x-circle', label: 'Rejected' },
  DENIED: { tone: 'crit', icon: 'icon-x-circle', label: 'Denied' },
  REVOKED: { tone: 'crit', icon: 'icon-x-circle', label: 'Revoked' },
  UNAVAILABLE: { tone: 'crit', icon: 'icon-x-circle', label: 'Unavailable' },

  // Pending / Maintenance / Review / Sync
  PENDING: { tone: 'pending', icon: 'icon-clock', label: 'Pending' },
  PENDING_REVIEW: { tone: 'pending', icon: 'icon-clock', label: 'Pending Review' },
  PENDING_DEVICE_SYNC: { tone: 'pending', icon: 'icon-clock', label: 'Pending Device Sync' },
  MAINTENANCE: { tone: 'pending', icon: 'icon-wrench', label: 'Maintenance' },
  CONNECTING: { tone: 'pending', icon: 'icon-clock', label: 'Connecting' },
  PUBLISHED: { tone: 'pending', icon: 'icon-clock', label: 'Published' },

  // Info
  INFO: { tone: 'info', icon: 'icon-info', label: 'Info' },
  ADMIN: { tone: 'info', icon: 'icon-shield', label: 'Admin' },
  SIMULATION: { tone: 'info', icon: 'icon-activity', label: 'Simulation' },

  // Unknown / Muted / Standby / Archived / Disabled
  UNKNOWN: { tone: 'muted', icon: 'icon-info', label: 'Unknown' },
  UNSEEN: { tone: 'muted', icon: 'icon-info', label: 'Unseen' },
  DISABLED: { tone: 'muted', icon: 'icon-x-circle', label: 'Disabled' },
  ARCHIVED: { tone: 'muted', icon: 'icon-clock', label: 'Archived' },
  STANDBY: { tone: 'muted', icon: 'icon-clock', label: 'Standby' },
  DISMISSED: { tone: 'muted', icon: 'icon-x-circle', label: 'Dismissed' },
  UNVERIFIED: { tone: 'muted', icon: 'icon-info', label: 'Unverified' },
  LOGGED_OUT: { tone: 'muted', icon: 'icon-info', label: 'Logged Out' },
  UNPROVISIONED: { tone: 'muted', icon: 'icon-info', label: 'Unprovisioned' },
  NOT_APPLICABLE: { tone: 'muted', icon: 'icon-info', label: 'N/A' },
  LEGACY: { tone: 'muted', icon: 'icon-info', label: 'Legacy' },
  VIEWER: { tone: 'muted', icon: 'icon-users', label: 'Viewer' }
};

export function resolveStatusMeta(rawState, customLabel = null) {
  const key = String(rawState || 'UNKNOWN').toUpperCase().replace(/[\s-]+/g, '_');
  const meta = STATUS_MAP[key] || { tone: 'muted', icon: 'icon-info', label: String(rawState || 'Unknown') };
  return {
    tone: meta.tone,
    icon: meta.icon,
    label: customLabel || meta.label
  };
}

/**
 * Clean non-pill semantic status readout: icon + crisp color + explicit label.
 */
export function statusIndicator(rawState, customLabel = null, { compact = false, toneOverride = null } = {}) {
  const meta = resolveStatusMeta(rawState, customLabel);
  const tone = toneOverride || meta.tone;
  return el('span', { class: `status-indicator status-tone-${tone}${compact ? ' status-compact' : ''}` }, [
    svgIcon(meta.icon, compact ? 13 : 14, 'status-svg'),
    el('span', { class: 'status-text', text: meta.label })
  ]);
}

/**
 * Standardized Page Header across all /app/* pages.
 */
export function pageHeader({ title, description = '', meta = null, actions = [] }) {
  const rightActions = Array.isArray(actions) ? actions.filter(Boolean) : [actions].filter(Boolean);
  return el('div', { class: 'page-header' }, [
    el('div', { class: 'page-header-main' }, [
      el('div', { class: 'page-title-row' }, [
        el('h1', { class: 'page-title', text: title }),
        meta || null
      ]),
      description ? el('p', { class: 'page-subtitle', text: description }) : null
    ]),
    rightActions.length > 0 ? el('div', { class: 'page-actions' }, rightActions) : null
  ]);
}

/**
 * Standardized KPI Metric Card with click-through support and tabular numerals.
 */
export function kpiCard({ label, value, sub = '', tone = 'default', category = '', icon = '', onClick = null }) {
  const clickable = typeof onClick === 'function';
  const catCls = category ? ` cat-${category} kpi-has-cat` : '';
  const node = el(
    clickable ? 'button' : 'div',
    {
      type: clickable ? 'button' : undefined,
      class: `card kpi-card kpi-tone-${tone}${catCls}${clickable ? ' kpi-clickable' : ''}`,
      onClick: clickable ? onClick : undefined
    },
    [
      el('div', { class: 'kpi-top-row' }, [
        el('div', { class: 'kpi-label-wrap' }, [
          icon
            ? el('span', { class: `kpi-cat-icon${category ? ` cat-${category}` : ''}`, 'aria-hidden': 'true' }, [
                svgIcon(icon, 15)
              ])
            : null,
          el('span', { class: 'kpi-label', text: label })
        ]),
        clickable
          ? el('span', { class: 'kpi-action-cue', 'aria-hidden': 'true' }, [svgIcon('icon-arrow-up-right', 14)])
          : null
      ]),
      el('div', { class: 'kpi-value tabular-nums', text: String(value) }),
      sub ? el('div', { class: 'kpi-sub', text: sub }) : null
    ]
  );
  return node;
}

/**
 * Loading skeletons (no raw "Loading..." text jumps).
 */
export function loadingSkeleton(variant = 'table', count = 4) {
  if (variant === 'kpi') {
    return el(
      'div',
      { class: 'kpi-grid', 'aria-busy': 'true', 'aria-label': 'Loading summary metrics' },
      Array.from({ length: count }, () =>
        el('div', { class: 'card kpi-card' }, [
          el('div', { class: 'skel skel-sm' }),
          el('div', { class: 'skel skel-lg' }),
          el('div', { class: 'skel skel-xs' })
        ])
      )
    );
  }
  if (variant === 'cards') {
    return el(
      'div',
      { class: 'rooms-grid', 'aria-busy': 'true', 'aria-label': 'Loading cards' },
      Array.from({ length: count }, () =>
        el('div', { class: 'card stack-sm' }, [
          el('div', { class: 'skel skel-md' }),
          el('div', { class: 'skel skel-sm' }),
          el('div', { class: 'skel skel-xs' })
        ])
      )
    );
  }
  return el(
    'div',
    { class: 'card stack-sm', 'aria-busy': 'true', 'aria-label': 'Loading records' },
    Array.from({ length: count }, () => el('div', { class: 'skel skel-row' }))
  );
}

/**
 * Structured Empty State with optional primary and secondary actions.
 */
export function emptyState({
  icon = 'icon-info',
  illustration = '',
  title,
  message,
  actionLabel = '',
  onAction = null,
  secondaryLabel = '',
  onSecondary = null
}) {
  return el('div', { class: 'empty-state' }, [
    illustration
      ? el('div', { class: 'empty-state-illus', 'aria-hidden': 'true' }, [
          el('img', { src: illustration, alt: '', loading: 'eager', decoding: 'async' })
        ])
      : el('div', { class: 'empty-state-icon' }, [svgIcon(icon, 22)]),
    el('h3', { class: 'empty-state-title', text: title }),
    message ? el('p', { class: 'empty-state-msg', text: message }) : null,
    actionLabel || secondaryLabel
      ? el('div', { class: 'btn-row empty-state-actions' }, [
          actionLabel && onAction
            ? el('button', { type: 'button', class: 'btn btn-primary btn-sm', text: actionLabel, onClick: onAction })
            : null,
          secondaryLabel && onSecondary
            ? el('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: secondaryLabel, onClick: onSecondary })
            : null
        ])
      : null
  ]);
}

/**
 * Section-level Error Panel with Retry action (preserves sibling loaded sections).
 */
export function errorPanel({ title = 'Unable to load section', message = 'Please verify local server connectivity and try again.', onRetry = null }) {
  return el('div', { class: 'card error-panel', role: 'alert' }, [
    el('div', { class: 'error-panel-head' }, [
      svgIcon('icon-x-circle', 18, 'status-tone-crit'),
      el('div', { class: 'stack-xs' }, [
        el('div', { class: 'font-semibold', text: title }),
        el('div', { class: 'text-sm text-secondary', text: message })
      ])
    ]),
    onRetry
      ? el('button', { type: 'button', class: 'btn btn-secondary btn-sm', onClick: onRetry }, [
          svgIcon('icon-refresh', 14),
          el('span', { text: 'Retry' })
        ])
      : null
  ]);
}

/**
 * Operational Boundary / Disclaimer Banner (subtle neutral/amber surface, zero thick left borders).
 */
export function disclaimerBanner({ icon = 'icon-info', title = '', message, tone = 'info', actions = [] }) {
  const actionList = Array.isArray(actions) ? actions.filter(Boolean) : [actions].filter(Boolean);
  return el('div', { class: `notice-banner notice-${tone}`, role: tone === 'warn' || tone === 'crit' ? 'alert' : 'note' }, [
    el('div', { class: 'notice-banner-main' }, [
      el('span', { class: `notice-icon status-tone-${tone}` }, [svgIcon(icon, 16)]),
      el('div', { class: 'notice-copy' }, [
        title ? el('div', { class: 'notice-title', text: title }) : null,
        el('div', { class: 'notice-text', text: message })
      ])
    ]),
    actionList.length > 0 ? el('div', { class: 'btn-row' }, actionList) : null
  ]);
}

/**
 * Copyable technical value (Device ID, MQTT topic, CLI snippet) with clipboard feedback.
 */
export function copyableValue(value, { label = 'Copy value', block = false } = {}) {
  const str = String(value ?? '');
  const copyBtn = el(
    'button',
    {
      type: 'button',
      class: 'btn-copy',
      title: label,
      'aria-label': label,
      onClick: async (e) => {
        e.stopPropagation();
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(str);
          } else {
            const area = el('textarea', { class: 'sr-only' });
            area.value = str;
            document.body.appendChild(area);
            area.select();
            document.execCommand('copy');
            area.remove();
          }
          showToast('Copied to clipboard', str.length > 64 ? `${str.slice(0, 64)}…` : str, 'success', 2400);
        } catch {
          showToast('Copy unavailable', 'Select and copy the text manually.', 'warning', 3000);
        }
      }
    },
    [svgIcon('icon-copy', 13), el('span', { text: 'Copy' })]
  );

  return el('div', { class: block ? 'copyable-block' : 'copyable-inline' }, [
    el('code', { class: 'mono copyable-text', text: str }),
    copyBtn
  ]);
}

/**
 * Structured Key-Value detail list (used in Slide-Over Drawers and Spec panels).
 */
export function keyValueList(entries = []) {
  return el(
    'dl',
    { class: 'kv-list' },
    entries
      .filter((item) => item && item.label)
      .map((item) =>
        el('div', { class: 'kv-row' }, [
          el('dt', { class: 'kv-key', text: item.label }),
          el('dd', { class: `kv-val${item.mono ? ' mono tabular-nums' : ''}` }, [
            item.node ? item.node : String(item.value ?? '—')
          ])
        ])
      )
  );
}

/**
 * Structured Chronological Timeline (Alarm lifecycle, Command lifecycle, Audit trails).
 */
export function timelineList(items = []) {
  if (!items.length) {
    return el('div', { class: 'text-sm text-muted', text: 'No lifecycle events recorded.' });
  }
  return el(
    'ol',
    { class: 'timeline-list' },
    items.map((item) =>
      el('li', { class: 'timeline-item' }, [
        el('div', { class: 'timeline-marker' }),
        el('div', { class: 'timeline-content' }, [
          el('div', { class: 'timeline-head' }, [
            item.status ? statusIndicator(item.status, item.statusLabel || null, { compact: true }) : null,
            item.title ? el('span', { class: 'font-semibold text-sm', text: item.title }) : null,
            item.timestamp ? el('span', { class: 'mono text-xs text-muted tabular-nums', text: item.timestamp }) : null
          ]),
          item.actor ? el('div', { class: 'text-xs text-secondary', text: `Actor: ${item.actor}` }) : null,
          item.detail ? el('div', { class: 'text-sm text-secondary timeline-detail', text: item.detail }) : null
        ])
      ])
    )
  );
}

/**
 * Segmented Filter Control (compact radio-like tabs for status/scope toggles).
 */
export function segmentedFilter({ options = [], value = '', onChange, ariaLabel = 'Filter options' }) {
  return el(
    'div',
    { class: 'segmented-control', role: 'group', 'aria-label': ariaLabel },
    options.map((opt) =>
      el('button', {
        type: 'button',
        class: `segmented-btn${opt.value === value ? ' active' : ''}`,
        'aria-pressed': opt.value === value ? 'true' : 'false',
        text: opt.label,
        onClick: () => {
          if (opt.value !== value) onChange(opt.value);
        }
      })
    )
  );
}

/**
 * Adaptive Collection Renderer:
 * Renders a dense semantic `.data-table` on desktop (> 768px) and clean stacked `.record-card`
 * items on mobile (<= 768px), avoiding cramped horizontal table scrolling on phone viewports.
 */
export function renderAdaptiveCollection({
  columns = [],
  rows = [],
  renderMobileCard,
  emptyNode = null,
  onRowClick = null,
  ariaLabel = 'Records table'
}) {
  if (!rows || rows.length === 0) {
    return el('div', { class: 'card' }, [
      emptyNode || emptyState({ title: 'No records found', message: 'Adjust your filters or add a new item.' })
    ]);
  }

  const table = el('table', { class: 'data-table', 'aria-label': ariaLabel }, [
    el('thead', {}, [
      el(
        'tr',
        {},
        columns.map((c) => el('th', { class: c.align === 'right' ? 'text-right' : undefined, text: c.label }))
      )
    ]),
    el(
      'tbody',
      {},
      rows.map((row) => {
        const clickable = typeof onRowClick === 'function';
        const tr = el(
          'tr',
          {
            class: clickable ? 'row-clickable' : undefined,
            tabindex: clickable ? '0' : undefined,
            onClick: clickable
              ? (e) => {
                  if (e.target.closest('button, a, input, select, textarea, label, .copyable-inline, .copyable-block')) {
                    return;
                  }
                  onRowClick(row);
                }
              : undefined,
            onKeydown: clickable
              ? (e) => {
                  if (e.target !== tr) return;
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onRowClick(row);
                  }
                }
              : undefined
          },
          columns.map((c) => {
            const cellVal = typeof c.render === 'function' ? c.render(row) : row[c.key];
            const tdAttrs = { class: c.className || (c.align === 'right' ? 'text-right' : undefined) };
            if (cellVal instanceof Node) {
              return el('td', tdAttrs, [cellVal]);
            }
            if (Array.isArray(cellVal)) {
              return el('td', tdAttrs, cellVal);
            }
            return el('td', { ...tdAttrs, text: String(cellVal ?? '—') });
          })
        );
        return tr;
      })
    )
  ]);

  const desktopWrap = el('div', { class: 'card table-card adaptive-desktop-table' }, [
    el('div', { class: 'table-wrap' }, [table])
  ]);

  const mobileList = el(
    'div',
    { class: 'adaptive-mobile-cards' },
    rows.map((row) => (typeof renderMobileCard === 'function' ? renderMobileCard(row) : el('div', { class: 'card record-card' })))
  );

  return el('div', { class: 'adaptive-collection' }, [desktopWrap, mobileList]);
}
