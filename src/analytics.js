// One tracking hook for the whole game. Nothing is collected unless SITE.analytics.provider is
// set and that provider's own script is on the page (see README > Analytics). Every call is also
// kept in window.__events (for tests) and dispatched as a 'noclipepe:track' DOM event.
import { SITE } from './site-config.js';

export const EVENTS = ['game_selected', 'play_started', 'game_completed', 'replay_clicked', 'instagram_clicked', 'x_clicked', 'finger_shown'];

const send = {
  plausible: (name, props) => window.plausible?.(name, { props }),
  umami: (name, props) => window.umami?.track?.(name, props),
  gtag: (name, props) => window.gtag?.('event', name, props),
  custom: (name, props) => window.noclipepeTrack?.(name, props),
};

export function track(name, props = {}) {
  (window.__events ||= []).push({ name, props, t: Date.now() });
  try { window.dispatchEvent(new CustomEvent('noclipepe:track', { detail: { name, props } })); } catch { /* old browsers */ }
  const provider = SITE.analytics?.provider;
  if (!provider || !send[provider]) return;
  try { send[provider](name, props); } catch (e) { console.warn('analytics', e); }
}
