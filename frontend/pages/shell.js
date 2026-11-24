// LCI-SFM Authenticated Multi-Page Operations Shell (/app/*)
// Collapsible desktop sidebar + mobile drawer, contextual topbar, live stream indicators, theme toggle, user menu.

import { store, isAdmin, toggleTheme, toggleSidebar, setMobileNavOpen, signOut, subscribe } from '../store.js';
import { el, svgIcon } from '../utils.js';

const NAV_GROUPS = [
  {
    label: 'Facility',
    items: [
      { path: '/app/overview', label: 'Overview', icon: 'icon-grid' },
      { path: '/app/rooms', label: 'Rooms', icon: 'icon-rooms' },
      { path: '/app/devices', label: 'Devices', icon: 'icon-network' }
    ]
  },
  {
    label: 'Operations',
    items: [
      { path: '/app/alarms', label: 'Alarms & Rules', icon: 'icon-warning' },
      { path: '/app/notifications', label: 'Notifications', icon: 'icon-bell', badge: 'unread' },
      { path: '/app/events', label: 'Events & Audit', icon: 'icon-list' }
    ]
  },
  {
    label: 'System',
    items: [
      { path: '/app/diagnostics', label: 'Diagnostics', icon: 'icon-activity' },
      { path: '/app/users', label: 'Users & Access', icon: 'icon-users', adminOnly: true },
      { path: '/app/settings', label: 'Settings', icon: 'icon-settings', adminOnly: true }
    ]
  }
];

export function renderAppShell({ pathname, title, breadcrumbs = [], contentNode, navigate }) {
  const wrapper = el('div', {
    class: `app-shell${store.sidebarCollapsed ? ' sidebar-collapsed' : ''}${store.mobileNavOpen ? ' mobile-nav-open' : ''}`
  });

  // Mobile backdrop
  const backdrop = el('div', {
    class: 'sidebar-backdrop',
    onClick: () => setMobileNavOpen(false)
  });
  wrapper.appendChild(backdrop);

  // Left Navigation Rail
  const navNodes = [];
  for (const group of NAV_GROUPS) {
    const visibleItems = group.items.filter((it) => !it.adminOnly || isAdmin());
    if (visibleItems.length === 0) continue;
    navNodes.push(el('div', { class: 'nav-group-label', text: group.label }));
    for (const item of visibleItems) {
      const isActive = pathname === item.path || pathname.startsWith(`${item.path}/`);
      const badgeEl =
        item.badge === 'unread'
          ? el('span', {
              class: `nav-counter tabular-nums${store.unreadCount > 0 ? '' : ' hidden'}`,
              dataset: { role: 'unread-count' },
              text: String(store.unreadCount)
            })
          : null;

      navNodes.push(
        el('a', {
          href: item.path,
          class: `nav-link${isActive ? ' active' : ''}`,
          title: item.label,
          onClick: (e) => {
            e.preventDefault();
            setMobileNavOpen(false);
            navigate(item.path);
          }
        }, [
          el('span', { class: 'nav-icon' }, [svgIcon(item.icon, 18)]),
          el('span', { class: 'nav-text', text: item.label }),
          badgeEl
        ])
      );
    }
  }

  // Live connection footer inside sidebar
  const wsDot = el('span', {
    class: `status-dot ${store.wsTelemetry === 'CONNECTED' ? 'dot-ok' : store.wsTelemetry === 'CONNECTING' ? 'dot-warn' : 'dot-muted'}`
  });
  const wsLabel = el('span', { class: 'mono', text: `WS ${store.wsTelemetry}` });
  const mqttDot = el('span', { class: 'status-dot dot-muted' });
  const mqttLabel = el('span', { class: 'mono', text: 'MQTT —' });

  const sidebar = el('aside', { class: 'app-sidebar', 'aria-label': 'Primary Navigation' }, [
    el('div', { class: 'sidebar-brand' }, [
      el('a', {
        href: '/app/overview',
        class: 'brand-lockup',
        onClick: (e) => {
          e.preventDefault();
          navigate('/app/overview');
        }
      }, [
        el('span', { class: 'brand-mark' }, [svgIcon('icon-brand-emblem', 18)]),
        el('span', { class: 'brand-wordmark', text: 'LCI-SFM' })
      ]),
      el('button', {
        type: 'button',
        class: 'btn-icon desktop-only',
        title: 'Collapse / Expand sidebar',
        'aria-label': 'Toggle sidebar width',
        onClick: toggleSidebar
      }, [svgIcon('icon-menu', 16)])
    ]),
    el('nav', { class: 'sidebar-nav' }, navNodes),
    el('div', { class: 'sidebar-footer' }, [
      el('div', { class: 'sidebar-health-row' }, [
        el('div', { class: 'status-inline' }, [wsDot, wsLabel]),
        el('div', { class: 'status-inline' }, [mqttDot, mqttLabel])
      ]),
      el('button', {
        type: 'button',
        class: 'sidebar-user-btn',
        onClick: () => {
          setMobileNavOpen(false);
          navigate('/app/profile');
        }
      }, [
        el('span', { class: 'user-avatar', text: (store.user?.username || 'OP').slice(0, 2).toUpperCase() }),
        el('div', { class: 'user-meta' }, [
          el('div', { class: 'user-name', text: store.user?.username || 'Operator' }),
          el('div', { class: 'user-role', text: store.user?.role || 'Viewer' })
        ])
      ]),
      el('button', {
        type: 'button',
        class: 'btn btn-secondary btn-sm btn-block',
        text: 'Sign Out',
        onClick: async () => {
          await signOut();
          navigate('/login', { replace: true });
        }
      })
    ])
  ]);
  wrapper.appendChild(sidebar);

  // Top Header Bar
  const unreadTopBadge = el('span', {
    class: `topbar-badge tabular-nums${store.unreadCount > 0 ? '' : ' hidden'}`,
    text: String(store.unreadCount)
  });

  const breadcrumbNodes = [];
  breadcrumbs.forEach((crumb, idx) => {
    if (idx > 0) breadcrumbNodes.push(el('span', { class: 'crumb-sep', text: '/' }));
    if (crumb.path) {
      breadcrumbNodes.push(
        el('a', {
          href: crumb.path,
          class: 'crumb-link',
          text: crumb.label,
          onClick: (e) => {
            e.preventDefault();
            navigate(crumb.path);
          }
        })
      );
    } else {
      breadcrumbNodes.push(el('span', { class: 'crumb-current', text: crumb.label }));
    }
  });

  const topbar = el('header', { class: 'app-topbar' }, [
    el('div', { class: 'topbar-left' }, [
      el('button', {
        type: 'button',
        class: 'btn-icon mobile-only',
        'aria-label': 'Open navigation menu',
        onClick: () => setMobileNavOpen(!store.mobileNavOpen)
      }, [svgIcon('icon-menu', 18)]),
      el('div', { class: 'topbar-heading' }, [
        breadcrumbNodes.length > 0 ? el('nav', { class: 'breadcrumbs', 'aria-label': 'Breadcrumb' }, breadcrumbNodes) : null,
        el('h1', { class: 'page-title', text: title })
      ])
    ]),
    el('div', { class: 'topbar-right' }, [
      el('button', {
        type: 'button',
        class: 'btn-icon topbar-bell-btn',
        title: 'Notifications',
        'aria-label': 'Open notifications',
        onClick: () => navigate('/app/notifications')
      }, [svgIcon('icon-bell', 18), unreadTopBadge]),
      el('button', {
        type: 'button',
        class: 'btn-icon',
        title: `Switch to ${store.theme === 'dark' ? 'Light' : 'Dark'} theme`,
        'aria-label': 'Toggle theme',
        onClick: toggleTheme
      }, [svgIcon(store.theme === 'dark' ? 'icon-sun' : 'icon-moon', 18)]),
      el('button', {
        type: 'button',
        class: 'btn btn-secondary btn-sm desktop-only',
        text: `${store.user?.username || 'Operator'} (${store.user?.role || 'Viewer'})`,
        onClick: () => navigate('/app/profile')
      })
    ])
  ]);

  const mainCol = el('div', { class: 'app-main-col' }, [
    topbar,
    el('main', { class: 'app-content' }, [contentNode])
  ]);
  wrapper.appendChild(mainCol);

  const syncLiveIndicators = () => {
    wrapper.classList.toggle('sidebar-collapsed', store.sidebarCollapsed);
    wrapper.classList.toggle('mobile-nav-open', store.mobileNavOpen);

    wsDot.className = `status-dot ${
      store.wsTelemetry === 'CONNECTED'
        ? 'dot-ok'
        : store.wsTelemetry === 'CONNECTING'
          ? 'dot-warn'
          : 'dot-muted'
    }`;
    wsLabel.textContent = `WS ${store.wsTelemetry}`;

    const mqtt = store.healthSummary?.mqtt;
    if (mqtt) {
      if (!mqtt.enabled) {
        mqttDot.className = 'status-dot dot-muted';
        mqttLabel.textContent = 'MQTT STANDBY';
      } else if (mqtt.connected && mqtt.subscriptions_ready) {
        mqttDot.className = 'status-dot dot-ok';
        mqttLabel.textContent = 'MQTT ONLINE';
      } else {
        mqttDot.className = 'status-dot dot-crit';
        mqttLabel.textContent = 'MQTT OFFLINE';
      }
    }

    unreadTopBadge.textContent = String(store.unreadCount);
    unreadTopBadge.classList.toggle('hidden', store.unreadCount <= 0);
    const navBadge = sidebar.querySelector('[data-role="unread-count"]');
    if (navBadge) {
      navBadge.textContent = String(store.unreadCount);
      navBadge.classList.toggle('hidden', store.unreadCount <= 0);
    }
  };

  syncLiveIndicators();
  const unsub = subscribe(syncLiveIndicators);

  return {
    node: wrapper,
    cleanup: () => {
      unsub();
    }
  };
}
