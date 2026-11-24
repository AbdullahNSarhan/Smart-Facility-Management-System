// LCI-SFM Local Landing Page (/)
// Clean 3-zone header, grounded local-first posture, zero external assets, safe /api/public/info status.

import { api } from '../api.js';
import { store, toggleTheme } from '../store.js';
import { el, svgIcon } from '../utils.js';

export function renderLandingPage({ navigate }) {
  const page = el('div', { class: 'landing-page' });

  // 3-Zone Top Header: Brand (Left) | 4 Concise Links (Center) | Single Action CTA (Right)
  const ctaLabel = store.authenticated ? 'Open Console' : 'Sign In';
  const ctaTarget = store.authenticated ? '/app/overview' : '/login';

  const header = el('header', { class: 'landing-nav' }, [
    el('div', { class: 'landing-nav-inner' }, [
      el('a', {
        href: '/',
        class: 'brand-lockup',
        onClick: (e) => {
          e.preventDefault();
          navigate('/');
        }
      }, [
        el('span', { class: 'brand-mark' }, [svgIcon('icon-brand-emblem', 20)]),
        el('span', { class: 'brand-wordmark', text: 'LCI-SFM' })
      ]),
      el('nav', { class: 'landing-links', 'aria-label': 'Landing navigation' }, [
        el('a', { href: '#platform', text: 'Platform' }),
        el('a', { href: '#capabilities', text: 'Capabilities' }),
        el('a', { href: '#deployment', text: 'Deployment' }),
        el('a', { href: '#system-status', text: 'System' })
      ]),
      el('div', { class: 'landing-nav-actions' }, [
        el('button', {
          type: 'button',
          class: 'btn-icon',
          title: 'Toggle Dark / Light theme',
          'aria-label': 'Toggle theme',
          onClick: toggleTheme
        }, [svgIcon(store.theme === 'dark' ? 'icon-sun' : 'icon-moon', 17)]),
        el('button', {
          type: 'button',
          class: 'btn btn-primary',
          text: ctaLabel,
          onClick: () => navigate(ctaTarget)
        })
      ])
    ])
  ]);
  page.appendChild(header);

  // Live safe status readout elements populated from /api/public/info
  const versionVal = el('span', { class: 'mono tabular-nums', text: '2.0.0-rc.1' });
  const dbStateVal = el('span', { class: 'status-label', text: 'Checking...' });
  const dbDot = el('span', { class: 'status-dot dot-muted', 'aria-hidden': 'true' });
  const modeVal = el('span', { class: 'mono', text: 'On-Premises LAN' });

  // Hero Section
  const hero = el('section', { id: 'platform', class: 'landing-hero' }, [
    el('div', { class: 'landing-container landing-hero-grid' }, [
      el('div', { class: 'landing-hero-copy' }, [
        el('div', { class: 'kicker', text: 'ON-PREMISES SMART FACILITY OPERATIONS' }),
        el('h1', {
          class: 'landing-h1',
          text: 'Local-First Infrastructure Control Across Every Room and Wired Node.'
        }),
        el('p', {
          class: 'landing-lead',
          text: 'Manage multi-room facilities, register MQTT and LAN controllers dynamically, monitor live sensor telemetry, evaluate alarms, and maintain full SQLite audit trails on a private wired network with zero cloud dependency.'
        }),
        el('div', { class: 'landing-hero-cta' }, [
          el('button', {
            type: 'button',
            class: 'btn btn-primary btn-lg',
            text: store.authenticated ? 'Enter Operations Console' : 'Sign In to Operations Console',
            onClick: () => navigate(ctaTarget)
          }),
          el('a', {
            href: '#capabilities',
            class: 'btn btn-secondary btn-lg',
            text: 'Explore Architecture'
          })
        ]),
        el('div', { class: 'landing-trust-strip' }, [
          el('span', { text: 'Air-Gapped Ready' }),
          el('span', { class: 'sep', text: '·' }),
          el('span', { text: 'CAT6 Ethernet / PoE' }),
          el('span', { class: 'sep', text: '·' }),
          el('span', { text: 'Edge-First Autonomy' }),
          el('span', { class: 'sep', text: '·' }),
          el('span', { text: 'SQLite WAL Audit Store' })
        ])
      ]),

      // Grounded Architectural Overview Card (Not a fake ticker)
      el('aside', { id: 'system-status', class: 'card landing-status-card', 'aria-label': 'Local Server Posture' }, [
        el('div', { class: 'card-head' }, [
          el('h2', { class: 'card-title', text: 'Local Node Posture' }),
          el('div', { class: 'status-inline' }, [dbDot, dbStateVal])
        ]),
        el('div', { class: 'spec-list' }, [
          el('div', { class: 'spec-row' }, [
            el('span', { class: 'spec-key', text: 'Software Release' }),
            versionVal
          ]),
          el('div', { class: 'spec-row' }, [
            el('span', { class: 'spec-key', text: 'Operating Posture' }),
            modeVal
          ]),
          el('div', { class: 'spec-row' }, [
            el('span', { class: 'spec-key', text: 'Hierarchy Model' }),
            el('span', { class: 'mono', text: 'Facility → Rooms → Devices → Endpoints' })
          ]),
          el('div', { class: 'spec-row' }, [
            el('span', { class: 'spec-key', text: 'Access Boundary' }),
            el('span', { class: 'mono', text: 'HttpOnly Cookie + CSRF + RBAC' })
          ]),
          el('div', { class: 'spec-row' }, [
            el('span', { class: 'spec-key', text: 'External Dependencies' }),
            el('span', { class: 'mono text-ok', text: 'None (100% Local Assets)' })
          ])
        ]),
        el('p', {
          class: 'landing-status-note',
          text: 'Operational telemetry, device addresses, and operator logs remain restricted behind server-verified authentication.'
        })
      ])
    ])
  ]);
  page.appendChild(hero);

  // Capabilities Grid
  const capabilities = [
    {
      icon: 'icon-grid',
      title: 'Multi-Room Facility Topology',
      desc: 'Organize rooms across floors and buildings, reassign devices cleanly without losing historical telemetry, and filter alarms per room.'
    },
    {
      icon: 'icon-network',
      title: 'Generic Endpoint Engine',
      desc: 'Define sensors, boolean detectors, relays, access controllers, and snapshot cameras via structured Capability and Data-Type metadata.'
    },
    {
      icon: 'icon-shield',
      title: 'Quarantine & Manifest Drift',
      desc: 'Unregistered MQTT devices are quarantined for Admin review. Capability changes trigger drift alerts without mutating your schema.'
    },
    {
      icon: 'icon-warning',
      title: 'Deterministic Alarming',
      desc: 'Numeric high/low thresholds and boolean rules with dwell timers, hysteresis recovery, operator acknowledgements, and full audit history.'
    },
    {
      icon: 'icon-lock',
      title: 'Edge-Safe Access & Commands',
      desc: 'Audited remote overrides and switch commands track PUBLISHED, ACKNOWLEDGED, and STATE_REPORTED states without bypassing edge safety.'
    },
    {
      icon: 'icon-activity',
      title: 'Air-Gapped Deployment Platform',
      desc: 'Guided Ubuntu Server installer, static IP helper, optional local TLS, and signed offline release bundles with automatic rollback.'
    }
  ];

  page.appendChild(
    el('section', { id: 'capabilities', class: 'landing-section' }, [
      el('div', { class: 'landing-container' }, [
        el('div', { class: 'section-header-block' }, [
          el('div', { class: 'kicker', text: 'CORE PLATFORM ARCHITECTURE' }),
          el('h2', { class: 'section-h2', text: 'Built for Long-Running On-Premises Reliability' })
        ]),
        el(
          'div',
          { class: 'feature-grid' },
          capabilities.map((c) =>
            el('article', { class: 'card feature-card' }, [
              el('div', { class: 'feature-icon' }, [svgIcon(c.icon, 20)]),
              el('h3', { class: 'feature-title', text: c.title }),
              el('p', { class: 'feature-desc', text: c.desc })
            ])
          )
        )
      ])
    ])
  );

  // Deployment Summary Band
  page.appendChild(
    el('section', { id: 'deployment', class: 'landing-section landing-section-alt' }, [
      el('div', { class: 'landing-container' }, [
        el('div', { class: 'deploy-band card' }, [
          el('div', { class: 'deploy-band-copy' }, [
            el('div', { class: 'kicker', text: 'LOCAL SERVER DEPLOYMENT' }),
            el('h2', { class: 'section-h2', text: 'Deploy Once on Ubuntu Server, Expand Without Rewriting Code' }),
            el('p', {
              class: 'text-secondary',
              text: 'Run the interactive deployment assistant or import an air-gapped offline release bundle. Every service runs inside isolated Docker containers on your private LAN.'
            })
          ]),
          el('div', { class: 'deploy-band-commands mono' }, [
            el('div', { class: 'cmd-line', text: 'sudo ./install.sh --discover-only' }),
            el('div', { class: 'cmd-line', text: 'sudo ./install.sh' }),
            el('div', { class: 'cmd-line', text: 'sudo ./scripts/provision-mqtt-device.sh add <device_id>' })
          ])
        ])
      ])
    ])
  );

  // Footer
  page.appendChild(
    el('footer', { class: 'landing-footer' }, [
      el('div', { class: 'landing-container landing-footer-inner' }, [
        el('span', { class: 'text-muted', text: 'LCI-SFM · Light Current Infrastructure for Smart Facility Management' }),
        el('span', { class: 'text-muted mono', text: 'Local-First · On-Premises · Zero Cloud Telemetry' })
      ])
    ])
  );

  // Fetch safe /api/public/info (non-blocking)
  api.getPublicInfo()
    .then((info) => {
      if (info?.version) versionVal.textContent = info.version;
      if (info?.mode) modeVal.textContent = info.mode === 'simulator' ? 'Isolated Simulator' : 'On-Premises LAN';
      if (info?.database_ok) {
        dbDot.className = 'status-dot dot-ok';
        dbStateVal.textContent = 'Server Online';
      } else {
        dbDot.className = 'status-dot dot-warn';
        dbStateVal.textContent = 'Degraded';
      }
    })
    .catch(() => {
      dbDot.className = 'status-dot dot-crit';
      dbStateVal.textContent = 'Unreachable';
    });

  return { node: page };
}
