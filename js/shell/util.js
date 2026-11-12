import { errText } from './vfs.js';

// ---- text styling (ANSI escape codes, like a real terminal) ----
export const sgr = (codes, s) => `\x1b[${codes}m${s}\x1b[0m`;
export const stripAnsi = s => s.replace(/\x1b\[[0-9;]*m/g, '');
export const vlen = s => stripAnsi(s).length;

export const MONTHS = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');
export const DAYS = 'Sun Mon Tue Wed Thu Fri Sat'.split(' ');
export const p2 = n => String(n).padStart(2, '0');

export function lsDate(ms) {
  const d = new Date(ms);
  const head = `${MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2)}`;
  if (Math.abs(Date.now() - ms) > 182 * 864e5) return `${head}  ${d.getFullYear()}`;
  return `${head} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}
export function fullDate(ms = Date.now()) {
  const d = new Date(ms);
  return `${DAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2)} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())} ${d.getFullYear()}`;
}

export const bytes = s => new TextEncoder().encode(s).length;

export function human(n, suffixB = true) {
  if (n < 1024) return n + (suffixB ? 'B' : '');
  const units = 'KMGT';
  let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < 3);
  return (n < 10 ? n.toFixed(1) : String(Math.round(n))) + units[i];
}

export const modeStr = n =>
  (n.t === 'd' ? 'd' : n.t === 'l' ? 'l' : '-') +
  [6, 3, 0].map(s => {
    const b = (n.mode >> s) & 7;
    return (b & 4 ? 'r' : '-') + (b & 2 ? 'w' : '-') + (b & 1 ? 'x' : '-');
  }).join('');

export function lev(a, b) {
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  let prevPrev = prev;
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      // transposition counts as one edit (sl -> ls)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) cur[j] = Math.min(cur[j], prevPrev[j - 2] + 1);
    }
    prevPrev = prev;
    prev = cur;
  }
  return prev[n];
}

export function nearest(word, list, max = 2) {
  let best = null;
  let bd = max + 1;
  for (const w of list) {
    if (Math.abs(w.length - word.length) > max) continue;
    const d = lev(word, w);
    if (d < bd) { bd = d; best = w; }
  }
  return best;
}

// Lay items out in columns going down, like ls does.
export function columns(items, width, tabbed = false) {
  if (!items.length) return '';
  const lens = items.map(vlen);
  const maxLen = Math.max(...lens);
  const colw = tabbed ? (Math.floor(maxLen / 8) + 1) * 8 : maxLen + 2;
  const ncol = Math.max(1, Math.floor((width + (tabbed ? 0 : 2)) / colw));
  const nrow = Math.ceil(items.length / ncol);
  let out = '';
  for (let r = 0; r < nrow; r++) {
    let line = '';
    for (let c = 0; c < ncol; c++) {
      const i = c * nrow + r;
      if (i >= items.length) break;
      const last = i + nrow >= items.length;
      line += items[i] + (last ? '' : ' '.repeat(colw - lens[i]));
    }
    out += line + '\n';
  }
  return out;
}

export const quoteArg = s => (/^[\w@%+=:,./~-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

// ---- option parsing ----
// spec: { bool: 'laR', val: 'n', long: { color: 'opt', depth: 'val', all: 'bool' }, permute, numeric }
export function parseOpts(args, { bool = '', val = '', long = {}, permute = true, numeric = false } = {}) {
  const o = {};
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') { rest.push(...args.slice(i + 1)); break; }
    if (a.startsWith('--') && a.length > 2) {
      const eq = a.indexOf('=');
      const k = eq < 0 ? a.slice(2) : a.slice(2, eq);
      const v = eq < 0 ? undefined : a.slice(eq + 1);
      const kind = long[k];
      if (!kind) return { o, rest, bad: a, badLong: true };
      if (kind === 'val') o[k] = v !== undefined ? v : args[++i];
      else o[k] = v !== undefined ? v : true;
      continue;
    }
    if (a.startsWith('-') && a.length > 1) {
      if (numeric && /^-\d+$/.test(a)) { o.n = a.slice(1); continue; }
      for (let j = 1; j < a.length; j++) {
        const ch = a[j];
        if (bool.includes(ch)) o[ch] = true;
        else if (val.includes(ch)) { o[ch] = a.slice(j + 1) || args[++i]; break; }
        else return { o, rest, bad: ch };
      }
      continue;
    }
    if (!permute) { rest.push(...args.slice(i)); break; }
    rest.push(a);
  }
  return { o, rest };
}

// ---- error message formats (GNU tools word errors differently from BSD/macOS) ----
const GNU_VERB = {
  ls: 'cannot access', rm: 'cannot remove', mkdir: 'cannot create directory', rmdir: 'failed to remove',
  cp: 'cannot stat', mv: 'cannot stat', touch: 'cannot touch', head: 'cannot open', tail: 'cannot open',
  chmod: 'cannot access', chown: 'cannot access', du: 'cannot access', stat: 'cannot statx', ln: 'failed to create symbolic link',
};
export function fmtErr(os, cmd, code, target, verb) {
  const t = errText(code);
  if (os === 'linux') {
    const v = verb || GNU_VERB[cmd];
    if (cmd === 'find') return `find: ‘${target}’: ${t}`;
    if (v) return cmd === 'mkdir' ? `${cmd}: ${v} ‘${target}’: ${t}` : `${cmd}: ${v} '${target}'${/^(head|tail)$/.test(cmd) ? ' for reading' : ''}: ${t}`;
  }
  return `${cmd}: ${target}: ${t}`;
}

// ---- regular expressions ----
const POSIX_CLASSES = { digit: '0-9', alpha: 'a-zA-Z', alnum: 'a-zA-Z0-9', upper: 'A-Z', lower: 'a-z', space: '\\s', punct: '!-\\/:-@\\[-`{-~', blank: ' \\t' };
function bre2js(p) {
  let o = '';
  for (let i = 0; i < p.length; i++) {
    const ch = p[i];
    if (ch === '\\' && i + 1 < p.length) {
      const n = p[++i];
      if ('+?|(){}'.includes(n)) o += n;
      else if (n === '<' || n === '>') o += '\\b';
      else o += '\\' + n;
    } else if ('+?|(){}'.includes(ch)) o += '\\' + ch;
    else o += ch;
  }
  return o;
}
export function toRegex(pat, { ere = false, fixed = false, icase = false, word = false, flags = 'g' } = {}) {
  let src = fixed ? pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : ere ? pat : bre2js(pat);
  if (!fixed) src = src.replace(/\[:(\w+):\]/g, (m, k) => POSIX_CLASSES[k] ?? m);
  if (word) src = `\\b(?:${src})\\b`;
  try {
    return new RegExp(src, flags + (icase ? 'i' : ''));
  } catch {
    return null;
  }
}

export function globToRe(glob, icase = false) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === '\\' && i + 1 < glob.length) re += glob[++i].replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    else if (ch === '*') re += '[^/]*';
    else if (ch === '?') re += '[^/]';
    else if (ch === '[') {
      const j = glob.indexOf(']', i + 2);
      if (j < 0) re += '\\[';
      else {
        let body = glob.slice(i + 1, j);
        if (body[0] === '!') body = '^' + body.slice(1);
        re += '[' + body.replace(/\\/g, '\\\\') + ']';
        i = j;
      }
    } else re += ch.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  }
  return new RegExp('^' + re + '$', icase ? 'i' : '');
}

// ---- line diff (used by diff and git) ----
export function diffOps(a, b) {
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ops = [];
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) ops.push({ t: ' ', s: a[i], a: i++, b: j++ });
    else if (j < m && (i >= n || dp[i][j + 1] > dp[i + 1][j])) ops.push({ t: '+', s: b[j], a: i, b: j++ });
    else ops.push({ t: '-', s: a[i], a: i++, b: j });
  }
  return ops;
}

// Returns unified-diff hunk lines (without the ---/+++ header), or [] if equal.
export function unifiedHunks(a, b, ctx = 3) {
  const ops = diffOps(a, b);
  const out = [];
  let k = 0;
  while (k < ops.length) {
    if (ops[k].t === ' ') { k++; continue; }
    const start = Math.max(0, k - ctx);
    let end = k;
    let last = k;
    while (end < ops.length && end - last <= ctx * 2) {
      if (ops[end].t !== ' ') last = end;
      end++;
    }
    end = Math.min(ops.length, last + ctx + 1);
    const chunk = ops.slice(start, end);
    const aCount = chunk.filter(o => o.t !== '+').length;
    const bCount = chunk.filter(o => o.t !== '-').length;
    const aStart = aCount ? chunk[0].a + 1 : chunk[0].a;
    const bStart = bCount ? chunk[0].b + 1 : chunk[0].b;
    out.push(`@@ -${aStart}${aCount === 1 ? '' : ',' + aCount} +${bStart}${bCount === 1 ? '' : ',' + bCount} @@`);
    for (const o of chunk) out.push(o.t + o.s);
    k = end;
  }
  return out;
}

export const splitLines = t => {
  const l = t.split('\n');
  if (l[l.length - 1] === '') l.pop();
  return l;
};

export function unescapeC(s) {
  return s.replace(/\\(n|t|\\|e|a|r|0[0-7]{0,3}|x[0-9a-fA-F]{1,2})/g, (m, k) => {
    if (k === 'n') return '\n';
    if (k === 't') return '\t';
    if (k === '\\') return '\\';
    if (k === 'e') return '\x1b';
    if (k === 'a') return '';
    if (k === 'r') return '\r';
    if (k[0] === 'x') return String.fromCharCode(parseInt(k.slice(1), 16));
    return String.fromCharCode(parseInt(k, 8) || 0);
  });
}

// printf-style formatting shared by printf and awk.
export function sprintf(fmt, args) {
  let i = 0;
  return unescapeC(fmt).replace(/%(-?)(\d*)(?:\.(\d+))?([sdif%])/g, (m, left, width, prec, t) => {
    if (t === '%') return '%';
    let v = args[i++];
    if (t === 's') v = String(v ?? '');
    else if (t === 'f') v = Number(v || 0).toFixed(prec === undefined ? 6 : +prec);
    else v = String(Math.trunc(Number(v) || 0));
    if (t === 's' && prec !== undefined) v = v.slice(0, +prec);
    return left ? v.padEnd(+width || 0) : v.padStart(+width || 0);
  });
}
