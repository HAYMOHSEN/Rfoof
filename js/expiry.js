// ============================================================
//  Rfoof – expiry dates
//  A document can carry an "Expires on" date (IDs, passports, contracts,
//  certificates, subscriptions). The "Expiring" view lists them nearest
//  first, cards show a chip, and the app reminds once a day about documents
//  that expire within a week. Dates are kept as YYYY-MM-DD strings.
// ============================================================
import { store } from './store.js';
import { t, fmtDate } from './i18n.js';
import { h } from './utils.js';
import { icon } from './icons.js';

export const SOON_DAYS = 30;     // "Expiring" badge in the sidebar
export const REMIND_DAYS = 7;    // start-up reminder

const DAY = 86400000;
function startOfToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
export function todayIso() { const d = startOfToday(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
export function isValidIso(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(dateOf(s).getTime()); }
export function dateOf(iso) { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); }

/** Whole days from today to the date: negative when it has passed. */
export function daysUntil(iso) { return Math.round((dateOf(iso) - startOfToday()) / DAY); }

/** 'expired' | 'today' | 'soon' (within SOON_DAYS) | 'later' | null (no date). */
export function status(f) {
  if (!f?.expiresAt || !isValidIso(f.expiresAt)) return null;
  const d = daysUntil(f.expiresAt);
  return d < 0 ? 'expired' : d === 0 ? 'today' : d <= SOON_DAYS ? 'soon' : 'later';
}

export function label(f) {
  const d = daysUntil(f.expiresAt);
  if (d < -1) return t('expiry.ago', { n: -d });
  if (d === -1) return t('expiry.yesterday');
  if (d === 0) return t('expiry.today');
  if (d === 1) return t('expiry.tomorrow');
  if (d <= 60) return t('expiry.in', { n: d });
  return t('expiry.on', { date: fmtDate(dateOf(f.expiresAt).getTime(), { dateStyle: 'medium' }) });
}

/** Chip for cards, rows and the details panel. */
export function chip(f, size = 12) {
  const s = status(f);
  if (!s) return null;
  return h('span', { class: `chip expiry ${s}`, title: fmtDate(dateOf(f.expiresAt).getTime(), { dateStyle: 'long' }) }, icon(s === 'expired' ? 'alert' : 'calendar', { size }), label(f));
}

/** Files with a date, nearest first. */
export function dated() { return store.liveFiles().filter(f => isValidIso(f.expiresAt)).sort((a, b) => (a.expiresAt < b.expiresAt ? -1 : a.expiresAt > b.expiresAt ? 1 : 0)); }
/** Files expired or expiring within `days`. */
export function due(days = SOON_DAYS) { return dated().filter(f => daysUntil(f.expiresAt) <= days); }
