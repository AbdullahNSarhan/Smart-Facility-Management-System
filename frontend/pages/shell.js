// LCI-SFM Authenticated Application Shell — Collapsible Sidebar, Mobile Drawer, Breadcrumbs & Live Connectivity
import {
  store,
  subscribe,
  isAdmin,
  toggleTheme,
  toggleSidebar,
  setMobileNavOpen,
  signOut
} from '../store.js';
import { el, svgIcon } from '../utils.js';
import { statusIndicator } from '../components/ui.js';

const NAV_GROUPS = [
  {
    label: 'Facility',
    items: [
      { path: '/app/overview', label: 'Overview', icon: 'icon-grid' },
      { path: '/app/rooms', label: 'Rooms', icon: 'icon-rooms' },
      { path: '/app/devices', label: 'Devices', icon: 'icon-cpu' },
      { path: '/app/network', label: 'Network', icon: 'icon-topology' }
    ]
  },
  {
    label: 'Monitoring',
    items: [
      { path: '/app/alarms', label: 'Alarms & Rules', icon: 'icon-warning', badgeKey: 'activeAlarmCount' },
      { path: '/app/notifications', label: 'Notifications', icon: 'icon-bell', badgeKey: 'unreadCount' },
      { path: '/app/events', label: 'Events & Audit', icon: 'icon-list' }
    ]
  },
  {
    label: 'Administration',
    items: [
      { path: '/app/diagnostics', label: 'Diagnostics', icon: 'icon-activity' },
      { path: '/app/users', label: 'Users & Access', icon: 'icon-users', adminOnly: true },
      { path: '/app/settings', label: 'Settings', icon: 'icon-settings', adminOnly: true }
    ]
  }
];

function isNavActive(itemPath, currentPath) {
  if (currentPath === itemPath) return true;
  if (itemPath === '/app/rooms' && currentPath.startsWith('/app/rooms/')) return true;
  if (itemPath === '/app/devices' && currentPath.startsWith('/app/devices/')) return true;
  return false;
}

function getConnectivityState() {
  if (store.wsTelemetry === 'CONNECTED' && store.wsNotifications === 'CONNECTED') {
    return { state: 'CONNECTED', label: 'Live Stream' };
  }
  if (store.wsTelemetry === 'CONNECTED' || store.wsNotifications === 'CONNECTED') {
    return { state: 'DEGRADED', label: 'Partial Stream' };
  }
  if (store.wsTelemetry === 'CONNECTING' || store.wsNotifications === 'CONNECTING') {
    return { state: 'CONNECTING', label: 'Connecting' };
  }
  return { state: 'OFFLINE', label: 'Stream Offline' };
}

export function renderAppShell({ pathname, breadcrumbs = [], contentNode, navigate }) {
  const shell = el('div', {
    class: `app-shell${store.sidebarCollapsed ? ' sidebar-collapsed' : ''}${store.mobileNavOpen ? ' mobile-nav-open' : ''}`
  });

  const admin = isAdmin();
  const badgeNodes = new Map();

  // Mobile nav backdrop
  const backdrop = el('div', {
    class: 'mobile-nav-backdrop',
    'aria-hidden': 'true',
    onClick: () => setMobileNavOpen(false)
  });

  // Sidebar navigation
  const navScroll = el('nav', { class: 'sidebar-scroll', 'aria-label': 'Primary navigation' });
  for (const group of NAV_GROUPS) {
    const visibleItems = group.items.filter((item) => !item.adminOnly || admin);
    if (!visibleItems.length) continue;

    const groupNode = el('div', { class: 'nav-group' }, [
      el('div', { class: 'nav-group-label', text: group.label })
    ]);

    for (const item of visibleItems) {
      const active = isNavActive(item.path, pathname);
      const countSpan = item.badgeKey ? el('span', { class: 'nav-counter' }) : null;
      if (countSpan) badgeNodes.set(item.badgeKey, countSpan);

      const link = el(
        'a',
        {
          href: item.path,
          class: `nav-item${active ? ' active' : ''}`,
          title: item.label,
          'aria-label': item.label,
          'aria-current': active ? 'page' : undefined,
          onClick: (e) => {
            e.preventDefault();
            setMobileNavOpen(false);
            navigate(item.path);
          }
        },
        [
          svgIcon(item.icon, 17),
          el('span', { class: 'nav-item-label', text: item.label }),
          countSpan
        ]
      );
      groupNode.appendChild(link);
    }

    navScroll.appendChild(groupNode);
  }

  const sidebar = el('aside', { class: 'app-sidebar', 'aria-label': 'Console navigation sidebar' }, [
    el('div', { class: 'sidebar-header' }, [
      el(
        'a',
        {
          href: '/app/overview',
          class: 'brand-lockup',
          title: 'LCI-SFM Facility Overview',
          onClick: (e) => {
            e.preventDefault();
            setMobileNavOpen(false);
            navigate('/app/overview');
          }
        },
        [
          el('span', { class: 'brand-mark' }, [svgIcon('icon-brand-emblem', 18)]),
          el('span', { class: 'brand-wordmark', text: 'LCI-SFM' })
        ]
      ),
      el(
        'button',
        {
          type: 'button',
          class: 'btn-icon sidebar-collapse-btn',
          title: store.sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar',
          'aria-label': store.sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar',
          onClick: toggleSidebar
        },
        [svgIcon('icon-menu', 16)]
      )
    ]),
    navScroll,
    el('div', { class: 'sidebar-footer' }, [
      el('div', { class: 'sidebar-user' }, [
        el('div', { class: 'sidebar-user-meta stack-xs truncate' }, [
          el('a', {
            href: '/app/profile',
            class: 'font-semibold text-sm truncate',
            text: store.user?.username || 'Operator',
            onClick: (e) => {
              e.preventDefault();
              setMobileNavOpen(false);
              navigate('/app/profile');
            }
          }),
          el('div', { class: 'text-xs text-muted', text: `${store.user?.role || 'Viewer'} · Local Session` })
        ]),
        el(
          'button',
          {
            type: 'button',
            class: 'btn-icon',
            title: 'Sign out',
            'aria-label': 'Sign out',
            onClick: async () => {
              await signOut();
              navigate('/login', { replace: true });
            }
          },
          [svgIcon('icon-logout', 15)]
        )
      ])
    ])
  ]);

  // Topbar breadcrumbs
  const crumbNav = el('nav', { class: 'breadcrumbs', 'aria-label': 'Breadcrumb' });
  breadcrumbs.forEach((c, idx) => {
    if (idx > 0) {
      crumbNav.appendChild(svgIcon('icon-chevron-right', 13));
    }
    if (c.path && idx < breadcrumbs.length - 1) {
      crumbNav.appendChild(
        el('a', {
          href: c.path,
          text: c.label,
          onClick: (e) => {
            e.preventDefault();
            navigate(c.path);
          }
        })
      );
    } else {
      crumbNav.appendChild(el('span', { class: 'breadcrumb-current', text: c.label }));
    }
  });

  // Live connectivity readout container
  const liveHost = el('a', {
    href: '/app/network',
    class: 'topbar-live-label',
    title: 'Inspect network and stream connectivity',
    onClick: (e) => {
      e.preventDefault();
      navigate('/app/network');
    }
  });

  const bellBadge = el('span', { class: 'bell-count', hidden: true });
  const themeBtn = el('button', {
    type: 'button',
    class: 'btn-icon',
    title: 'Toggle Dark / Light theme',
    'aria-label': 'Toggle theme',
    onClick: toggleTheme
  });

  const syncReactiveHeader = () => {
    shell.className = `app-shell${store.sidebarCollapsed ? ' sidebar-collapsed' : ''}${store.mobileNavOpen ? ' mobile-nav-open' : ''}`;

    const conn = getConnectivityState();
    liveHost.replaceChildren(statusIndicator(conn.state, conn.label, { compact: true }));

    const unread = Number(store.unreadCount || 0);
    bellBadge.hidden = unread <= 0;
    bellBadge.textContent = unread > 99 ? '99+' : String(unread);

    const unreadSidebar = badgeNodes.get('unreadCount');
    if (unreadSidebar) unreadSidebar.textContent = unread > 0 ? String(unread > 99 ? '99+' : unread) : '';

    const alarmSidebar = badgeNodes.get('activeAlarmCount');
    if (alarmSidebar) {
      const ac = Number(store.activeAlarmCount || 0);
      alarmSidebar.textContent = ac > 0 ? String(ac > 99 ? '99+' : ac) : '';
    }

    themeBtn.replaceChildren(svgIcon(store.theme === 'dark' ? 'icon-sun' : 'icon-moon', 16));
  };

  syncReactiveHeader();

  const topbar = el('header', { class: 'app-topbar' }, [
    el('div', { class: 'topbar-left' }, [
      el(
        'button',
        {
          type: 'button',
          class: 'btn-icon mobile-menu-btn',
          'aria-label': 'Toggle navigation menu',
          onClick: () => setMobileNavOpen(!store.mobileNavOpen)
        },
        [svgIcon('icon-menu', 17)]
      ),
      crumbNav
    ]),
    el('div', { class: 'topbar-right' }, [
      el('span', { class: 'host-origin-label mono', title: 'Local appliance origin', text: window.location.host }),
      liveHost,
      el(
        'button',
        {
          type: 'button',
          class: 'btn-icon bell-btn',
          title: 'Notifications',
          'aria-label': 'Open notifications',
          onClick: () => navigate('/app/notifications')
        },
        [svgIcon('icon-bell', 16), bellBadge]
      ),
      themeBtn,
      el('button', {
        type: 'button',
        class: 'btn btn-secondary btn-sm',
        text: store.user?.username || 'Profile',
        onClick: () => navigate('/app/profile')
      })
    ])
  ]);

  const mainEl = el('main', { class: 'app-content', id: 'main-content' }, [contentNode]);
  const mainCol = el('div', { class: 'app-main-col' }, [topbar, mainEl]);

  shell.appendChild(backdrop);
  shell.appendChild(sidebar);
  shell.appendChild(mainCol);

  const onEsc = (e) => {
    if (e.key === 'Escape' && store.mobileNavOpen) {
      setMobileNavOpen(false);
    }
  };
  document.addEventListener('keydown', onEsc);
  const unsub = subscribe(syncReactiveHeader);

  return {
    node: shell,
    cleanup: () => {
      unsub();
      document.removeEventListener('keydown', onEsc);
    }
  };
}
