// LCI-SFM History API Multi-Page Router
// Supports /, /login, /app/* deep-linking, server-verified auth guards, and clean lifecycle cleanup.

import { store, checkSession, setSessionExpiredHandler } from './store.js';
import { clear, el } from './utils.js';
import { renderLandingPage } from './pages/landing.js';
import { renderLoginPage } from './pages/login.js';
import { renderAppShell } from './pages/shell.js';
import { renderOverviewPage } from './pages/overview.js';
import { renderRoomsListPage, renderRoomDetailPage } from './pages/rooms.js';
import { renderDevicesListPage, renderDeviceDetailPage, renderEndpointDetailPage } from './pages/devices.js';
import { renderAlarmsPage, renderNotificationsPage, renderEventsPage } from './pages/operations.js';
import { renderDiagnosticsPage, renderUsersPage, renderSettingsPage, renderProfilePage } from './pages/admin.js';

const APP_ROUTES = [
  {
    pattern: /^\/app\/overview\/?$/,
    title: 'Facility Overview',
    crumbs: () => [{ label: 'Overview' }],
    render: (ctx) => renderOverviewPage(ctx)
  },
  {
    pattern: /^\/app\/rooms\/?$/,
    title: 'Rooms',
    crumbs: () => [{ label: 'Overview', path: '/app/overview' }, { label: 'Rooms' }],
    render: (ctx) => renderRoomsListPage(ctx)
  },
  {
    pattern: /^\/app\/rooms\/([^/]+)\/?$/,
    paramNames: ['roomId'],
    title: 'Room Detail',
    crumbs: (p) => [
      { label: 'Overview', path: '/app/overview' },
      { label: 'Rooms', path: '/app/rooms' },
      { label: decodeURIComponent(p.roomId) }
    ],
    render: (ctx) => renderRoomDetailPage(ctx)
  },
  {
    pattern: /^\/app\/devices\/?$/,
    title: 'Devices',
    crumbs: () => [{ label: 'Overview', path: '/app/overview' }, { label: 'Devices' }],
    render: (ctx) => renderDevicesListPage(ctx)
  },
  {
    pattern: /^\/app\/devices\/([^/]+)\/endpoints\/([^/]+)\/?$/,
    paramNames: ['deviceId', 'endpointKey'],
    title: 'Endpoint History',
    crumbs: (p) => [
      { label: 'Devices', path: '/app/devices' },
      { label: decodeURIComponent(p.deviceId), path: `/app/devices/${encodeURIComponent(decodeURIComponent(p.deviceId))}` },
      { label: decodeURIComponent(p.endpointKey) }
    ],
    render: (ctx) => renderEndpointDetailPage(ctx)
  },
  {
    pattern: /^\/app\/devices\/([^/]+)\/?$/,
    paramNames: ['deviceId'],
    title: 'Device Detail',
    crumbs: (p) => [
      { label: 'Overview', path: '/app/overview' },
      { label: 'Devices', path: '/app/devices' },
      { label: decodeURIComponent(p.deviceId) }
    ],
    render: (ctx) => renderDeviceDetailPage(ctx)
  },
  {
    pattern: /^\/app\/alarms\/?$/,
    title: 'Alarms & Monitoring Rules',
    crumbs: () => [{ label: 'Overview', path: '/app/overview' }, { label: 'Alarms & Rules' }],
    render: (ctx) => renderAlarmsPage(ctx)
  },
  {
    pattern: /^\/app\/notifications\/?$/,
    title: 'Notifications',
    crumbs: () => [{ label: 'Overview', path: '/app/overview' }, { label: 'Notifications' }],
    render: (ctx) => renderNotificationsPage(ctx)
  },
  {
    pattern: /^\/app\/events\/?$/,
    title: 'Events & Audit Logs',
    crumbs: () => [{ label: 'Overview', path: '/app/overview' }, { label: 'Events & Audit' }],
    render: (ctx) => renderEventsPage(ctx)
  },
  {
    pattern: /^\/app\/diagnostics\/?$/,
    title: 'Diagnostics',
    crumbs: () => [{ label: 'Overview', path: '/app/overview' }, { label: 'Diagnostics' }],
    render: (ctx) => renderDiagnosticsPage(ctx)
  },
  {
    pattern: /^\/app\/users\/?$/,
    title: 'Users & Access',
    crumbs: () => [{ label: 'Overview', path: '/app/overview' }, { label: 'Users & Access' }],
    render: (ctx) => renderUsersPage(ctx)
  },
  {
    pattern: /^\/app\/settings\/?$/,
    title: 'Facility Settings',
    crumbs: () => [{ label: 'Overview', path: '/app/overview' }, { label: 'Settings' }],
    render: (ctx) => renderSettingsPage(ctx)
  },
  {
    pattern: /^\/app\/profile\/?$/,
    title: 'Operator Profile',
    crumbs: () => [{ label: 'Overview', path: '/app/overview' }, { label: 'Profile' }],
    render: (ctx) => renderProfilePage(ctx)
  }
];

function matchAppRoute(pathname) {
  for (const route of APP_ROUTES) {
    const m = pathname.match(route.pattern);
    if (m) {
      const params = {};
      (route.paramNames || []).forEach((name, idx) => {
        params[name] = m[idx + 1];
      });
      return { route, params };
    }
  }
  return null;
}

export function createRouter(rootEl) {
  let currentCleanups = [];

  const runCleanups = () => {
    for (const fn of currentCleanups) {
      try {
        fn();
      } catch {
        // ignore cleanup error
      }
    }
    currentCleanups = [];
  };

  const navigate = (to, options = {}) => {
    const targetUrl = new URL(to, window.location.origin);
    const full = `${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`;
    if (options.replace) {
      window.history.replaceState({}, '', full);
    } else if (full !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      window.history.pushState({}, '', full);
    }
    renderCurrent();
  };

  const renderCurrent = async () => {
    if (!store.authChecked) {
      await checkSession();
    }

    runCleanups();
    const pathname = window.location.pathname || '/';
    const query = new URLSearchParams(window.location.search || '');

    // Landing page (/)
    if (pathname === '/' || pathname === '/index.html') {
      document.title = 'LCI-SFM · Smart Facility Management Platform';
      const view = renderLandingPage({ navigate, query });
      clear(rootEl);
      rootEl.appendChild(view.node);
      if (view.cleanup) currentCleanups.push(view.cleanup);
      return;
    }

    // Dedicated Login (/login)
    if (pathname === '/login' || pathname === '/login/') {
      if (store.authenticated) {
        navigate('/app/overview', { replace: true });
        return;
      }
      document.title = 'Sign In · LCI-SFM';
      const view = renderLoginPage({ navigate, query });
      clear(rootEl);
      rootEl.appendChild(view.node);
      if (view.cleanup) currentCleanups.push(view.cleanup);
      return;
    }

    // Authenticated Application Routes (/app/*)
    if (pathname === '/app' || pathname === '/app/') {
      navigate(store.authenticated ? '/app/overview' : '/login', { replace: true });
      return;
    }

    if (pathname.startsWith('/app/')) {
      if (!store.authenticated) {
        const nextTarget = encodeURIComponent(`${pathname}${window.location.search || ''}`);
        navigate(`/login?next=${nextTarget}`, { replace: true });
        return;
      }

      const matched = matchAppRoute(pathname);
      if (!matched) {
        document.title = 'Not Found · LCI-SFM';
        const nfContent = el('div', { class: 'card empty-state stack-md' }, [
          el('h2', { class: 'section-title', text: 'Route Not Found' }),
          el('p', { class: 'text-secondary', text: `No console view exists at ${pathname}.` }),
          el('div', {}, [
            el('button', {
              type: 'button',
              class: 'btn btn-primary',
              text: 'Return to Facility Overview',
              onClick: () => navigate('/app/overview')
            })
          ])
        ]);
        const shell = renderAppShell({
          pathname,
          title: 'Not Found',
          breadcrumbs: [{ label: 'Overview', path: '/app/overview' }, { label: 'Not Found' }],
          contentNode: nfContent,
          navigate
        });
        clear(rootEl);
        rootEl.appendChild(shell.node);
        if (shell.cleanup) currentCleanups.push(shell.cleanup);
        return;
      }

      const { route, params } = matched;
      document.title = `${route.title} · LCI-SFM`;
      const pageView = route.render({ params, query, navigate });
      const shell = renderAppShell({
        pathname,
        title: route.title,
        breadcrumbs: route.crumbs(params),
        contentNode: pageView.node,
        navigate
      });
      clear(rootEl);
      rootEl.appendChild(shell.node);
      if (pageView.cleanup) currentCleanups.push(pageView.cleanup);
      if (shell.cleanup) currentCleanups.push(shell.cleanup);
      return;
    }

    // Unknown top-level route -> clean 404
    document.title = 'Not Found · LCI-SFM';
    clear(rootEl);
    rootEl.appendChild(
      el('div', { class: 'login-center' }, [
        el('div', { class: 'card login-card stack-md' }, [
          el('h1', { class: 'login-title', text: 'Page Not Found' }),
          el('p', { class: 'text-secondary', text: `The requested path "${pathname}" was not found on this local LCI-SFM server.` }),
          el('button', {
            type: 'button',
            class: 'btn btn-primary',
            text: 'Go to Home',
            onClick: () => navigate('/')
          })
        ])
      ])
    );
  };

  window.addEventListener('popstate', () => renderCurrent());
  setSessionExpiredHandler(() => {
    const curr = window.location.pathname;
    if (curr.startsWith('/app')) {
      navigate(`/login?next=${encodeURIComponent(curr)}`, { replace: true });
    }
  });

  return {
    start: () => renderCurrent(),
    navigate
  };
}
