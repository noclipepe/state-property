const KEY='state-property:fisherman-skin';
const DEFAULT_SKIN='original';
const PREFERENCE_VERSION=2;
export function getFishermanSkin() {
  const query=new URLSearchParams(location.search).get('skin');
  if(query==='gru'||query==='original') return query;
  try {
    // Reset legacy choices once; subsequent explicit selections remain persistent.
    const saved=JSON.parse(localStorage.getItem(KEY));
    if(saved?.version===PREFERENCE_VERSION&&(saved.skin==='gru'||saved.skin==='original')) return saved.skin;
  } catch { /* Missing, legacy or blocked storage uses the default. */ }
  return DEFAULT_SKIN;
}
export function saveFishermanSkin(skin) {
  try { localStorage.setItem(KEY,JSON.stringify({version:PREFERENCE_VERSION,skin:skin==='gru'?'gru':DEFAULT_SKIN})); } catch { /* Selection still works for this visit. */ }
}
