// ============================================================
//  Rfoof – Microsoft identity platform sign-in (OAuth 2.0
//  authorization code flow with PKCE, no external library)
// ============================================================
import { APP } from './config.js';
import { Emitter } from './utils.js';

export const authEvents = new Emitter();
const KEY = 'rfoof.auth';
const PKCE_KEY = 'rfoof.pkce';

export class AuthError extends Error { constructor(msg, code) { super(msg); this.code = code || 'auth'; } }

function b64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function randomString(len = 64) {
  const a = new Uint8Array(len); crypto.getRandomValues(a);
  return b64url(a).slice(0, len);
}
async function challenge(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return b64url(digest);
}
function decodeJwt(token) {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(decodeURIComponent(atob(payload).split('').map(c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join('')));
  } catch { return {}; }
}

function load() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } }
function save(s) { if (s) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY); }

export const auth = {
  isConfigured() { return !!APP.msClientId; },
  redirectUri() {
    const u = new URL(location.href);
    u.search = ''; u.hash = '';
    let p = u.pathname.replace(/index\.html$/, '');
    if (!p.endsWith('/')) p += '/';
    return u.origin + p;
  },
  account() {
    const s = load();
    return s && s.account ? s.account : null;
  },
  isSignedIn() { const s = load(); return !!(s && s.refreshToken); },

  async signIn() {
    if (!this.isConfigured()) throw new AuthError('Client ID not configured', 'not_configured');
    const verifier = randomString(96);
    const state = randomString(24);
    sessionStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state, returnTo: location.hash }));
    const params = new URLSearchParams({
      client_id: APP.msClientId,
      response_type: 'code',
      redirect_uri: this.redirectUri(),
      response_mode: 'query',
      scope: APP.msScopes.join(' '),
      state,
      code_challenge: await challenge(verifier),
      code_challenge_method: 'S256',
      prompt: 'select_account',
    });
    location.assign(`${APP.msAuthority}/oauth2/v2.0/authorize?${params}`);
  },

  // Call once on startup. Resolves to the account if a sign-in just completed, otherwise null.
  async handleRedirect() {
    const url = new URL(location.href);
    const code = url.searchParams.get('code');
    const err = url.searchParams.get('error');
    const errDesc = url.searchParams.get('error_description');
    const state = url.searchParams.get('state');
    if (!code && !err) return null;
    const pk = JSON.parse(sessionStorage.getItem(PKCE_KEY) || 'null');
    sessionStorage.removeItem(PKCE_KEY);
    // clean the URL first so a reload does not replay the code
    url.search = '';
    history.replaceState(null, '', url.toString() + (pk?.returnTo || ''));
    if (err) throw new AuthError(errDesc || err, err);
    if (!pk || !pk.verifier) throw new AuthError('Sign-in session was lost. Please try again.', 'no_pkce');
    if (pk.state !== state) throw new AuthError('Security check failed (state mismatch). Please try again.', 'state');
    const tokens = await this._token({ grant_type: 'authorization_code', code, redirect_uri: this.redirectUri(), code_verifier: pk.verifier });
    authEvents.emit('signin', tokens.account);
    return tokens.account;
  },

  async _token(params) {
    const body = new URLSearchParams({ client_id: APP.msClientId, scope: APP.msScopes.join(' '), ...params });
    let res;
    try {
      res = await fetch(`${APP.msAuthority}/oauth2/v2.0/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    } catch (e) { throw new AuthError('Network error during sign-in', 'network'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new AuthError(data.error_description || data.error || `HTTP ${res.status}`, data.error || 'token');
    const prev = load() || {};
    const claims = data.id_token ? decodeJwt(data.id_token) : {};
    const account = data.id_token ? {
      name: claims.name || claims.preferred_username || '',
      username: claims.preferred_username || claims.email || '',
      id: claims.oid || claims.sub || '',
      tenant: claims.tid || '',
    } : prev.account;
    const s = {
      accessToken: data.access_token,
      expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
      refreshToken: data.refresh_token || prev.refreshToken,
      account,
    };
    save(s);
    return s;
  },

  async getToken({ force = false } = {}) {
    const s = load();
    if (!s || !s.refreshToken) throw new AuthError('Not signed in', 'signed_out');
    if (!force && s.accessToken && s.expiresAt - 90000 > Date.now()) return s.accessToken;
    try {
      const n = await this._token({ grant_type: 'refresh_token', refresh_token: s.refreshToken });
      return n.accessToken;
    } catch (e) {
      if (e.code === 'invalid_grant' || e.code === 'interaction_required' || e.code === 'invalid_client') {
        save(null); authEvents.emit('expired');
        throw new AuthError('Session expired', 'expired');
      }
      throw e;
    }
  },

  signOut({ everywhere = false } = {}) {
    save(null);
    authEvents.emit('signout');
    if (everywhere) {
      const p = new URLSearchParams({ post_logout_redirect_uri: this.redirectUri() });
      location.assign(`${APP.msAuthority}/oauth2/v2.0/logout?${p}`);
    }
  },
};
