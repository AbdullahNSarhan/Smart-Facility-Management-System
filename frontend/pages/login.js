// LCI-SFM Dedicated Operator Login Page (/login)
// Cookie-backed server authentication, show/hide password, inline errors, safe relative redirect.

import { api } from '../api.js';
import { setSessionState, store, toggleTheme } from '../store.js';
import { el, svgIcon, sanitizeRedirectPath } from '../utils.js';

export function renderLoginPage({ navigate, query }) {
  const nextPath = sanitizeRedirectPath(query.get('next') || '/app/overview');

  const page = el('div', { class: 'login-page' });

  const topBar = el('div', { class: 'login-topbar' }, [
    el('a', {
      href: '/',
      class: 'brand-lockup',
      onClick: (e) => {
        e.preventDefault();
        navigate('/');
      }
    }, [
      el('span', { class: 'brand-mark' }, [svgIcon('icon-brand-emblem', 18)]),
      el('span', { class: 'brand-wordmark', text: 'LCI-SFM' })
    ]),
    el('div', { class: 'login-topbar-right' }, [
      el('button', {
        type: 'button',
        class: 'btn-icon',
        title: 'Toggle Dark / Light theme',
        'aria-label': 'Toggle theme',
        onClick: toggleTheme
      }, [svgIcon(store.theme === 'dark' ? 'icon-sun' : 'icon-moon', 17)]),
      el('button', {
        type: 'button',
        class: 'btn btn-secondary btn-sm',
        text: '← Overview',
        onClick: () => navigate('/')
      })
    ])
  ]);
  page.appendChild(topBar);

  const errorBanner = el('div', { class: 'alert alert-error hidden', role: 'alert' });
  const usernameInput = el('input', {
    id: 'login-username',
    type: 'text',
    name: 'username',
    autocomplete: 'username',
    maxlength: '64',
    placeholder: 'Operator username',
    required: true,
    class: 'input'
  });

  const passwordInput = el('input', {
    id: 'login-password',
    type: 'password',
    name: 'password',
    autocomplete: 'current-password',
    maxlength: '128',
    placeholder: 'Operator password',
    required: true,
    class: 'input'
  });

  let showPassword = false;
  const togglePassBtn = el('button', {
    type: 'button',
    class: 'btn-ghost-inline',
    text: 'Show',
    'aria-label': 'Toggle password visibility',
    onClick: () => {
      showPassword = !showPassword;
      passwordInput.type = showPassword ? 'text' : 'password';
      togglePassBtn.textContent = showPassword ? 'Hide' : 'Show';
    }
  });

  const submitBtn = el('button', {
    type: 'submit',
    id: 'login-submit-btn',
    class: 'btn btn-primary btn-block',
    text: 'Sign In'
  });

  const form = el('form', { class: 'stack-md', novalidate: true }, [
    errorBanner,
    el('div', { class: 'field' }, [
      el('label', { for: 'login-username', class: 'field-label', text: 'Operator Username' }),
      usernameInput
    ]),
    el('div', { class: 'field' }, [
      el('div', { class: 'field-label-row' }, [
        el('label', { for: 'login-password', class: 'field-label', text: 'Password' }),
        togglePassBtn
      ]),
      passwordInput
    ]),
    submitBtn
  ]);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBanner.classList.add('hidden');
    errorBanner.textContent = '';

    const username = usernameInput.value.trim();
    const password = passwordInput.value;
    if (!username || !password) {
      errorBanner.textContent = 'Enter both your operator username and password.';
      errorBanner.classList.remove('hidden');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Verifying credentials...';
    try {
      const res = await api.login(username, password);
      setSessionState(res);
      navigate(nextPath, { replace: true });
    } catch (err) {
      errorBanner.textContent =
        err.status === 401
          ? 'Invalid operator username or password.'
          : err.status === 429
            ? 'Too many authentication attempts. Please wait before trying again.'
            : err.message || 'Unable to authenticate with the local server.';
      errorBanner.classList.remove('hidden');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Sign In';
    }
  });

  const card = el('main', { class: 'login-card card' }, [
    el('div', { class: 'login-card-head' }, [
      el('div', { class: 'kicker', text: 'LOCAL OPERATIONS ACCESS' }),
      el('h1', { class: 'login-title', text: 'Operator Sign In' }),
      el('p', {
        class: 'text-secondary',
        text: 'Authenticate against the on-premises LCI-SFM backend. Sessions are protected by HttpOnly cookies and CSRF tokens.'
      })
    ]),
    form,
    el('div', { class: 'login-footer-meta' }, [
      el('span', { class: 'text-muted', text: 'Gateway: ' }),
      el('code', { class: 'mono', text: window.location.host || 'local-server' })
    ])
  ]);

  page.appendChild(el('div', { class: 'login-center' }, [card]));
  setTimeout(() => usernameInput.focus(), 20);

  return { node: page };
}
