// Saved state (settings and progress), kept in the browser's localStorage.
// Storage can be unavailable (private windows, blocked site data), so every access
// is guarded and the app works without it.

const KEY = 'terminal-trainer:v1';

const defaults = () => ({
  os: /Mac|iPhone|iPad/.test(globalThis.navigator?.platform || '') ? 'mac' : /Linux/.test(globalThis.navigator?.platform || '') ? 'linux' : 'mac',
  mode: 'learn',
  theme: 'system',
  fontSize: 15,
  assist: true,
  coach: true,
  lesson: { mac: null, linux: null },
  done: { mac: {}, linux: {} },
  drills: {},
  tips: {},
  sandbox: { mac: null, linux: null },
});

export function loadState() {
  const base = defaults();
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved && typeof saved === 'object') {
      for (const k of Object.keys(base)) if (saved[k] !== undefined && typeof saved[k] === typeof base[k]) base[k] = saved[k];
    }
  } catch { /* start fresh */ }
  return base;
}

export function saveState(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function clearState() {
  try { localStorage.removeItem(KEY); } catch { /* nothing to clear */ }
}

// Spaced repetition (Leitner boxes): a drill moves up a box when answered
// correctly on the first try and returns to box 1 otherwise. Higher boxes wait longer.
const DAY = 864e5;
const WAIT_DAYS = [0, 0, 1, 3, 7, 14];

export function gradeDrill(state, id, correct) {
  const rec = state.drills[id] || { box: 0, seen: 0 };
  rec.box = correct ? Math.min(5, rec.box + 1) : 1;
  rec.seen = Date.now();
  state.drills[id] = rec;
}

// Choose up to `count` drills: overdue ones first (lowest box first), then new ones.
export function pickDrills(state, drills, count = 8) {
  const now = Date.now();
  const rank = d => {
    const rec = state.drills[d.id];
    if (!rec) return [1, 0];
    const due = now - rec.seen >= WAIT_DAYS[rec.box] * DAY;
    return due ? [0, rec.box] : [2, rec.seen];
  };
  const sorted = drills
    .map(d => ({ d, r: rank(d), tie: Math.random() }))
    .sort((a, b) => a.r[0] - b.r[0] || a.r[1] - b.r[1] || a.tie - b.tie)
    .slice(0, count)
    .map(x => x.d);
  for (let i = sorted.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
  }
  return sorted;
}
