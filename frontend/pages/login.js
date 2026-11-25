// LCI-SFM Dedicated Operator Sign-In Page (/login)
// Same-origin HttpOnly cookie authentication with accessible show/hide password toggle and safe redirect.

import { api } from '../api.js';
import { store, setSessionState, toggleTheme } from '../store.js';
import { el, svgIcon, sanitizeRedirectPath } from '../utils.js';

export function renderLoginPage({ navigate, query }) {
  const nextPath = sanitizeRedirectPath(query?.get('next') || '/app/overview');

  const page = el('div', { class: 'login-page' });

  const themeBtn = el(
    'button',
    {
      type: 'button',
      class: 'btn-icon',
      title: 'Toggle Dark / Light theme',
      'aria-label': 'Toggle theme',
      onClick: () => {
        toggleTheme();
        themeBtn.replaceChildren(svgIcon(store.theme === 'dark' ? 'icon-sun' : 'icon-moon', 16));
      }
    },
    [svgIcon(store.theme === 'dark' ? 'icon-sun' : 'icon-moon', 16)]
  );

  page.appendChild(
    el('header', { class: 'login-topbar' }, [
      el(
        'a',
        {
          href: '/',
          class: 'brand-lockup',
          onClick: (e) => {
            e.preventDefault();
            navigate('/');
          }
        },
        [
          el('span', { class: 'brand-mark' }, [svgIcon('icon-brand-emblem', 18)]),
          el('span', { class: 'brand-wordmark', text: 'LCI-SFM' })
        ]
      ),
      el('div', { class: 'row-gap-sm' }, [
        el('span', { class: 'host-origin-label mono', text: window.location.host }),
        themeBtn
      ])
    ])
  );

  const userInput = el('input', {
    id: 'login-username',
    class: 'input',
    type: 'text',
    name: 'username',
    autocomplete: 'username',
    placeholder: 'Enter operator username',
    required: true
  });

  const passInput = el('input', {
    id: 'login-password',
    class: 'input',
    type: 'password',
    name: 'password',
    autocomplete: 'current-password',
    placeholder: 'Enter operator password',
    required: true
  });

  let passwordVisible = false;
  const togglePassBtn = el(
    'button',
    {
      type: 'button',
      class: 'input-action-btn',
      'aria-label': 'Show password',
      'aria-pressed': 'false',
      onClick: () => {
        passwordVisible = !passwordVisible;
        passInput.type = passwordVisible ? 'text' : 'password';
        togglePassBtn.setAttribute('aria-label', passwordVisible ? 'Hide password' : 'Show password');
        togglePassBtn.setAttribute('aria-pressed', passwordVisible ? 'true' : 'false');
        togglePassBtn.replaceChildren(svgIcon(passwordVisible ? 'icon-eye-off' : 'icon-eye', 16));
      }
    },
    [svgIcon('icon-eye', 16)]
  );

  const errBox = el('div', { class: 'form-error', role: 'alert', hidden: true });
  const submitBtn = el('button', {
    id: 'login-submit-btn',
    type: 'submit',
    class: 'btn btn-primary btn-block btn-lg',
    text: 'Sign In to Console'
  });

  const form = el('form', { class: 'stack-md', novalidate: true }, [
    errBox,
    el('div', { class: 'form-field' }, [
      el('label', { class: 'form-label', for: 'login-username', text: 'Operator Username' }),
      userInput
    ]),
    el('div', { class: 'form-field' }, [
      el('label', { class: 'form-label', for: 'login-password', text: 'Password' }),
      el('div', { class: 'input-with-action' }, [passInput, togglePassBtn])
    ]),
    submitBtn
  ]);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errBox.hidden = true;
    const username = userInput.value.trim();
    const password = passInput.value;
    if (!username || !password) {
      errBox.textContent = 'Enter both your operator username and password.';
      errBox.hidden = false;
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Verifying session...';
    try {
      const res = await api.login(username, password);
      setSessionState({
        authenticated: true,
        user: {
          id: res.user?.id ?? res.id ?? null,
          username: res.user?.username ?? res.username ?? username,
          role: res.user?.role ?? res.role ?? 'Viewer'
        },
        csrfToken: res.csrfToken
      });
      navigate(nextPath, { replace: true });
    } catch (err) {
      errBox.textContent = err.message || 'Authentication failed. Check your credentials.';
      errBox.hidden = false;
      submitBtn.disabled = false;
      submitBtn.textContent = 'Sign In to Console';
    }
  });

  const card = el('div', { class: 'card login-card stack-md' }, [
    el('div', { class: 'stack-xs' }, [
      el('div', { class: 'kicker', text: 'LOCAL APPLIANCE AUTHENTICATION' }),
      el('h1', { class: 'login-title', text: 'Sign In to LCI-SFM' }),
      el('p', {
        class: 'text-sm text-secondary',
        text: 'Authenticate with your local server-verified Admin or Viewer account.'
      })
    ]),
    form,
    el('div', { class: 'text-xs text-muted' }, [
      'Protected by HttpOnly SameSite=Strict session cookies, CSRF validation, and server-side RBAC on ',
      el('span', { class: 'mono', text: window.location.host }),
      '.'
    ])
  ]);

  page.appendChild(el('main', { class: 'login-center' }, [card]));
  requestAnimationFrame(() => userInput.focus());

  return { node: page };
}
