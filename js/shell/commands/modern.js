// Modern command-line tools that people install with brew or apt:
// rg (ripgrep), fd, bat, eza, fzf, jq, tldr, zoxide. And cowsay, for fun.

import { def } from '../registry.js';
import { sgr, columns, modeStr, human, bytes, globToRe, splitLines, MONTHS, p2 } from '../util.js';
import { REFMAP, noteFor } from '../../data/reference.js';

const TYPES = { py: /\.py$/, js: /\.(js|mjs|cjs)$/, md: /\.(md|markdown)$/, txt: /\.txt$/, html: /\.html?$/, css: /\.css$/, sh: /\.(sh|bash|zsh)$/, json: /\.json$/, log: /\.log$/, csv: /\.csv$/ };

// Walk a folder: fn(displayPath, node, depth). Skips hidden entries unless asked.
function walk(c, label, hidden, fn, maxDepth = Infinity) {
  const root = c.fs.get(c.abs(label || '.'), { user: c.user });
  if (!root) return false;
  const go = (lab, n, depth) => {
    if (n.t !== 'd' || depth >= maxDepth || !c.fs.can(n, c.user, 4)) return;
    for (const [k, v] of [...n.kids].sort((a, b) => a[0].toLowerCase().localeCompare(b[0].toLowerCase()))) {
      if ((k.startsWith('.') && !hidden) || k === '.git') continue;
      const l = lab === '' ? k : lab.replace(/\/*$/, '/') + k;
      fn(l, v, depth + 1);
      go(l, v, depth + 1);
    }
  };
  if (root.t !== 'd') fn(label, root, 0);
  else go(label === '.' ? '' : label || '', root, 0);
  return true;
}

def('rg', async c => {
  const p = c.opts({
    bool: 'inlcwvFSsHNu', val: 'tgeABCm', permute: true,
    long: { hidden: 'bool', 'ignore-case': 'bool', files: 'bool', 'no-heading': 'bool', 'line-number': 'bool', version: 'bool', 'files-with-matches': 'bool', count: 'bool', 'smart-case': 'bool', 'fixed-strings': 'bool' },
  });
  if (!p) return 2;
  const o = p.o;
  if (o.version) { c.println('ripgrep 14.1.1'); return 0; }
  const rest = p.rest.slice();
  const hidden = o.hidden || o.u;
  const typeRe = o.t ? TYPES[o.t] : null;
  if (o.t && !typeRe) { c.err(`rg: unrecognized file type: ${o.t}\n`); return 2; }
  const globRe = o.g ? globToRe(o.g) : null;
  const want = name => (!typeRe || typeRe.test(name)) && (!globRe || globRe.test(name.split('/').pop()));
  if (o.files) {
    for (const t of rest.length ? rest : ['.']) walk(c, t, hidden, (l, n) => { if (n.t === 'f' && want(l)) c.println(l); });
    return 0;
  }
  const pat = o.e ?? rest.shift();
  if (pat === undefined) {
    c.err("error: the following required arguments were not provided:\n  <PATTERN>\n\nUsage: rg [OPTIONS] PATTERN [PATH ...]\n\nFor more information, try '--help'.\n");
    c.sh.lastErr = { cmd: 'rg', code: 'USAGE' };
    return 2;
  }
  const icase = o.i || o['ignore-case'] || ((o.S || o['smart-case']) && !/[A-Z]/.test(pat));
  let re;
  try {
    let src = o.F || o['fixed-strings'] ? pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : pat;
    if (o.w) src = `\\b(?:${src})\\b`;
    re = new RegExp(src, icase ? 'gi' : 'g');
  } catch {
    c.err(`rg: regex parse error:\n    ${pat}\n    ^\nerror: unclosed group or character class\n`);
    c.sh.lastErr = { cmd: 'rg', code: 'RG_REGEX', target: pat };
    return 2;
  }
  const files = [];
  let single = false;
  if (!rest.length && c.stdin !== null && c.stdin !== undefined) { files.push({ name: null, text: c.stdin }); single = true; }
  else {
    for (const t of rest.length ? rest : ['.']) {
      const n = c.node(t);
      if (!n) continue;
      if (n.t === 'f') { files.push({ name: t, text: n.data }); single = rest.length === 1; }
      else walk(c, t, hidden, (l, node) => { if (node.t === 'f' && !node.bin && want(l) && !node.data.startsWith('\x1f')) files.push({ name: l, text: node.data }); });
    }
  }
  const heading = c.tty && !o['no-heading'];
  const lineNo = (c.tty || o.n || o['line-number']) && !o.N;
  let any = false;
  let first = true;
  for (const f of files) {
    const ls = splitLines(f.text);
    const hits = [];
    ls.forEach((l, i) => { re.lastIndex = 0; if (re.test(l) !== !!o.v) hits.push(i); });
    if (!hits.length) continue;
    any = true;
    const name = c.tty ? sgr('35', f.name ?? '') : f.name ?? '';
    if (o.l || o['files-with-matches']) { c.println(name); continue; }
    if (o.c || o.count) { c.println(single ? String(hits.length) : `${name}:${hits.length}`); continue; }
    if (heading && !single) { if (!first) c.println(''); c.println(name); }
    first = false;
    for (const i of hits) {
      re.lastIndex = 0;
      const text = c.tty && !o.v ? ls[i].replace(re, m => (m ? sgr('1;31', m) : m)) : ls[i];
      const num = lineNo ? (c.tty ? sgr('32', String(i + 1)) : String(i + 1)) + ':' : '';
      c.println((heading || single ? '' : name + ':') + num + text);
    }
  }
  return any ? 0 : 1;
}, { pkg: 'ripgrep' });

def('fd', c => {
  const p = c.opts({ bool: 'HIaslFig1', val: 'etdxE', permute: true, long: { hidden: 'bool', type: 'val', extension: 'val', 'max-depth': 'val', glob: 'bool', version: 'bool' } });
  if (!p) return 1;
  const o = p.o;
  if (o.version) { c.println('fd 10.2.0'); return 0; }
  const [pattern, ...paths] = p.rest;
  let re = null;
  if (pattern) {
    try {
      re = o.g || o.glob ? globToRe(pattern, true) : new RegExp(o.F ? pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : pattern, /[A-Z]/.test(pattern) && !o.i ? '' : 'i');
    } catch {
      c.err(`[fd error]: regex parse error:\n    ${pattern}\n`);
      return 1;
    }
  }
  const type = o.t ?? o.type;
  const ext = (o.e ?? o.extension)?.replace(/^\./, '');
  const depth = +(o.d ?? o['max-depth'] ?? Infinity);
  let st = 0;
  for (const t of paths.length ? paths : ['.']) {
    const ok = walk(c, t, o.H || o.hidden, (l, n) => {
      const name = l.split('/').pop();
      if (re && !re.test(name)) return;
      if (type && ((type[0] === 'f' && n.t !== 'f') || (type[0] === 'd' && n.t !== 'd'))) return;
      if (ext && (n.t !== 'f' || !name.toLowerCase().endsWith('.' + ext.toLowerCase()))) return;
      if (n.t === 'd') c.println(c.tty ? sgr('1;34', l + '/') : l + '/');
      else if (c.tty && l.includes('/')) c.println(sgr('1;34', l.slice(0, l.lastIndexOf('/') + 1)) + name);
      else c.println(l);
    }, depth);
    if (!ok) {
      c.err(`[fd error]: Search path '${t}' is not a directory.\n`);
      c.sh.lastErr = { cmd: 'fd', code: 'ENOENT', target: t, coach: 'FD_PATH', pattern };
      st = 1;
    }
  }
  return st;
}, { pkg: 'fd' });

def('bat', async c => {
  const p = c.opts({ bool: 'pnAP', val: 'lr', permute: true, long: { plain: 'bool', number: 'bool', paging: 'val', style: 'val', version: 'bool' } });
  if (!p) return 1;
  if (p.o.version) { c.println('bat 0.25.0'); return 0; }
  let st = 0;
  const files = p.rest.length ? p.rest : ['-'];
  for (const f of files) {
    let text;
    if (f === '-') text = await c.input();
    else {
      const n = c.fs.get(c.abs(f), { user: c.user });
      if (!n) { c.err(`${c.tty ? sgr('31', '[bat error]') : '[bat error]'}: '${f}': No such file or directory (os error 2)\n`); c.sh.lastErr = { cmd: 'bat', code: 'ENOENT', target: f }; st = 1; continue; }
      if (n.t === 'd') { c.err(`${c.tty ? sgr('31', '[bat error]') : '[bat error]'}: '${f}' is a directory.\n`); c.sh.lastErr = { cmd: 'bat', code: 'EISDIR', target: f }; st = 1; continue; }
      text = c.read(f);
      if (text === null) { st = 1; continue; }
    }
    if (!c.tty || p.o.p || p.o.plain) { c.out(text); continue; }
    const w = Math.max(20, c.cols);
    const dim = s => sgr('90', s);
    c.println(dim('─'.repeat(7) + '┬' + '─'.repeat(w - 8)));
    c.println(dim('       │ ') + 'File: ' + sgr('1', f === '-' ? 'STDIN' : f));
    c.println(dim('─'.repeat(7) + '┼' + '─'.repeat(w - 8)));
    splitLines(text).forEach((l, i) => c.println(dim(String(i + 1).padStart(4) + '   │ ') + l));
    c.println(dim('─'.repeat(7) + '┴' + '─'.repeat(w - 8)));
  }
  return st;
}, { pkg: 'bat' });

def('eza', c => {
  const p = c.opts({ bool: 'laT1FdrRhgGD', val: 'Ls', long: { tree: 'bool', all: 'bool', long: 'bool', level: 'val', icons: 'opt', git: 'bool', 'group-directories-first': 'bool', header: 'bool', oneline: 'bool', color: 'opt', version: 'bool' } });
  if (!p) return 3;
  const o = p.o;
  if (o.version) { c.println('eza - A modern, maintained replacement for ls\nv0.20.14 [+git]'); return 0; }
  const all = o.a || o.all, long = o.l || o.long, tree = o.T || o.tree;
  const depth = +(o.L ?? o.level ?? Infinity);
  const paint = (name, n) => {
    const s = name + (o.F && n.t === 'd' ? '/' : '');
    if (!c.tty) return s;
    return n.t === 'd' ? sgr('1;34', s) : n.t === 'l' ? sgr('36', s) : n.mode & 0o111 ? sgr('1;32', s) : s;
  };
  const sorted = n => {
    const ents = [...n.kids].filter(([k, v]) => (all || !k.startsWith('.')) && (!o.D || v.t === 'd')).sort((a, b) => a[0].toLowerCase().localeCompare(b[0].toLowerCase()));
    if (o['group-directories-first']) ents.sort((a, b) => (b[1].t === 'd') - (a[1].t === 'd'));
    if (o.r) ents.reverse();
    return ents;
  };
  const row = (name, n, prefix = '') => {
    if (!long) return prefix + paint(name, n);
    const d = new Date(n.mtime);
    const size = n.t === 'f' ? (o.h === false ? String(bytes(n.data)) : human(bytes(n.data), false)) : '-';
    const perms = (n.t === 'f' ? '.' : modeStr(n)[0]) + modeStr(n).slice(1);
    const cols = [perms, size.padStart(5), n.owner, `${String(d.getDate()).padStart(2)} ${MONTHS[d.getMonth()]} ${p2(d.getHours())}:${p2(d.getMinutes())}`];
    if (c.tty) { cols[1] = sgr('32', cols[1]); cols[2] = sgr('1;33', cols[2]); cols[3] = sgr('34', cols[3]); }
    return cols.join(' ') + ' ' + prefix + paint(name, n) + (n.t === 'l' ? ' -> ' + n.to : '');
  };
  let st = 0;
  const targets = p.rest.length ? p.rest : ['.'];
  targets.forEach((t, ti) => {
    const n = c.fs.get(c.abs(t), { user: c.user });
    if (!n) { c.err(`"${t}": No such file or directory (os error 2)\n`); c.sh.lastErr = { cmd: 'eza', code: 'ENOENT', target: t }; st = 2; return; }
    if (n.t !== 'd' || o.d) { c.println(row(t, n)); return; }
    if (targets.length > 1) c.println(`${ti ? '\n' : ''}${t}:`);
    if (tree) {
      c.println(row(t, n));
      const go = (node, pre, level) => {
        const ents = sorted(node);
        ents.forEach(([k, v], i) => {
          const last = i === ents.length - 1;
          c.println(row(k, v, pre + (last ? '└── ' : '├── ')));
          if (v.t === 'd' && level < depth) go(v, pre + (last ? '    ' : '│   '), level + 1);
        });
      };
      go(n, '', 1);
    } else if (long || o['1'] || o.oneline || !c.tty) sorted(n).forEach(([k, v]) => c.println(row(k, v)));
    else c.out(columns(sorted(n).map(([k, v]) => paint(k, v)), c.cols));
  });
  return st;
}, { pkg: 'eza' });

// ---------- fzf ----------
function fuzzy(s, q) {
  const low = s.toLowerCase();
  const pos = [];
  let from = 0;
  for (const ch of q) {
    const i = low.indexOf(ch, from);
    if (i < 0) return null;
    pos.push(i);
    from = i + 1;
  }
  return { s, pos, score: pos.length ? pos[pos.length - 1] - pos[0] + pos[0] * 0.01 + s.length * 0.001 : 0 };
}

class Fzf {
  constructor(items) {
    this.all = items;
    this.q = '';
    this.sel = 0;
    this.rows = 24;
    this.cols = 80;
    this.done = false;
    this.result = null;
    this.filter();
  }
  resize(rows, cols) { this.rows = rows; this.cols = cols; }
  filter() {
    const q = this.q.toLowerCase().replace(/\s+/g, '');
    this.list = this.all.map(s => fuzzy(s, q)).filter(Boolean);
    if (q) this.list.sort((a, b) => a.score - b.score);
    this.sel = Math.max(0, Math.min(this.sel, this.list.length - 1));
  }
  key(k) {
    if (k === 'Enter') { this.result = this.list[this.sel]?.s ?? null; this.done = true; }
    else if (k === 'Escape' || k === 'C-c' || k === 'C-g' || k === 'C-d') this.done = true;
    else if (k === 'ArrowUp' || k === 'C-k' || k === 'C-p') this.sel = Math.min(this.list.length - 1, this.sel + 1);
    else if (k === 'ArrowDown' || k === 'C-j' || k === 'C-n') this.sel = Math.max(0, this.sel - 1);
    else if (k === 'Backspace') { this.q = this.q.slice(0, -1); this.sel = 0; this.filter(); }
    else if (k === 'C-u') { this.q = ''; this.sel = 0; this.filter(); }
    else if (k.length === 1) { this.q += k; this.sel = 0; this.filter(); }
  }
  render() {
    const rows = this.rows;
    const lines = Array.from({ length: rows }, () => ({ text: '', spans: [] }));
    const space = rows - 2;
    const top = Math.max(0, this.sel - space + 1);
    for (let i = 0; i < space; i++) {
      const it = this.list[top + i];
      if (!it) continue;
      const cur = top + i === this.sel;
      const text = (cur ? '> ' : '  ') + it.s;
      const spans = [];
      if (cur) spans.push({ a: 0, b: 1, cls: 'c1' });
      let last = 2;
      for (const x of it.pos) { if (cur && x + 2 > last) spans.push({ a: last, b: x + 2, cls: 'bold' }); spans.push({ a: x + 2, b: x + 3, cls: 'c2' }); last = x + 3; }
      if (cur && last < text.length) spans.push({ a: last, b: text.length, cls: 'bold' });
      lines[rows - 3 - i] = { text: text.slice(0, this.cols), spans: spans.filter(sp => sp.b <= this.cols) };
    }
    const count = `  ${this.list.length}/${this.all.length} `;
    lines[rows - 2] = { text: (count + '─'.repeat(Math.max(0, this.cols - count.length))).slice(0, this.cols), spans: [{ a: 0, b: count.length, cls: 'c3' }, { a: count.length, b: this.cols, cls: 'dim' }] };
    lines[rows - 1] = { text: '> ' + this.q, spans: [{ a: 0, b: 1, cls: 'c4' }] };
    return { lines, cursor: { r: rows - 1, c: 2 + this.q.length } };
  }
  help() {
    return { mode: 'fzf', hint: 'Type a few letters of what you are looking for.', keys: [['↑ ↓', 'move'], ['Enter', 'choose'], ['Esc', 'cancel']] };
  }
}

def('fzf', async c => {
  let items;
  if (c.stdin !== null && c.stdin !== undefined) items = splitLines(c.stdin);
  else {
    items = [];
    walk(c, '.', false, (l, n) => { if (n.t === 'f') items.push(l); });
  }
  const fi = c.args.findIndex(a => a === '-f' || a === '--filter');
  if (fi >= 0) {
    const hits = items.map(s => fuzzy(s, (c.args[fi + 1] || '').toLowerCase())).filter(Boolean).sort((a, b) => a.score - b.score);
    hits.forEach(h => c.println(h.s));
    return hits.length ? 0 : 1;
  }
  if (!c.io.fullscreen) { c.err('fzf: interactive mode needs a terminal\n'); return 2; }
  const app = new Fzf(items);
  await c.io.fullscreen(app);
  if (app.result === null) return 130;
  c.println(app.result);
}, { pkg: 'fzf' });

// ---------- jq ----------
class JqError extends Error {}
const jtype = v => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
const jshow = v => { const s = JSON.stringify(v); return s.length > 14 ? s.slice(0, 11) + '...' : s; };

function jqCompile(src) {
  let i = 0;
  const ws = () => { while (/\s/.test(src[i] || '')) i++; };
  const peek = s => { ws(); return src.startsWith(s, i); };
  const eat = s => (peek(s) ? ((i += s.length), true) : false);
  const need = s => { if (!eat(s)) throw new SyntaxError(`unexpected ${src[i] === undefined ? 'end of filter' : `'${src[i]}'`}, expected '${s}'`); };
  const word = () => { ws(); const m = src.slice(i).match(/^[A-Za-z_]\w*/); return m ? m[0] : null; };
  const str = () => {
    ws();
    const m = src.slice(i).match(/^"((?:[^"\\]|\\.)*)"/);
    if (!m) return null;
    i += m[0].length;
    return JSON.parse(m[0]);
  };
  const index = (v, k) => {
    if (v === null) return null;
    if (typeof k === 'number') { if (!Array.isArray(v)) throw new JqError(`Cannot index ${jtype(v)} with number`); return v[k < 0 ? v.length + k : k] ?? null; }
    if (jtype(v) !== 'object') throw new JqError(`Cannot index ${jtype(v)} with "${k}"`);
    return v[k] ?? null;
  };
  const iter = v => {
    if (Array.isArray(v)) return v;
    if (jtype(v) === 'object') return Object.values(v);
    throw new JqError(`Cannot iterate over ${jtype(v)}${v === null ? '' : ` (${jshow(v)})`}`);
  };
  const cmp = (a, b) => (a === b ? 0 : typeof a === typeof b && a !== null && typeof a !== 'object' ? (a < b ? -1 : 1) : JSON.stringify(a) < JSON.stringify(b) ? -1 : 1);
  const truthy = v => v !== null && v !== false;
  const FN0 = {
    length: v => (v === null ? 0 : typeof v === 'number' ? Math.abs(v) : jtype(v) === 'object' ? Object.keys(v).length : v.length),
    keys: v => { if (v === null || typeof v !== 'object') throw new JqError(`${jtype(v)} (${jshow(v)}) has no keys`); return Array.isArray(v) ? v.map((_, k) => k) : Object.keys(v).sort(); },
    values: v => v, type: jtype, not: v => !truthy(v),
    sort: v => [...iter(v)].sort(cmp), reverse: v => [...iter(v)].reverse(), unique: v => [...iter(v)].sort(cmp).filter((x, k, a) => !k || cmp(x, a[k - 1])),
    first: v => iter(v)[0] ?? null, last: v => iter(v).at(-1) ?? null,
    add: v => iter(v).reduce((a, b) => (a === null ? b : typeof a === 'object' && !Array.isArray(a) ? { ...a, ...b } : Array.isArray(a) ? a.concat(b) : a + b), null),
    min: v => [...iter(v)].sort(cmp)[0] ?? null, max: v => [...iter(v)].sort(cmp).at(-1) ?? null,
    tostring: v => (typeof v === 'string' ? v : JSON.stringify(v)), tonumber: v => Number(v),
    ascii_downcase: v => String(v).toLowerCase(), ascii_upcase: v => String(v).toUpperCase(),
    to_entries: v => Object.entries(v).map(([key, value]) => ({ key, value })),
  };

  function primary() {
    ws();
    let s;
    if (eat('(')) { const f = pipe(); need(')'); return f; }
    if (eat('[')) { if (eat(']')) return () => [[]]; const f = pipe(); need(']'); return v => [f(v)]; }
    if (eat('{')) {
      const pairs = [];
      if (!peek('}')) {
        do {
          const k = str() ?? word();
          if (!k) throw new SyntaxError('object key expected');
          if (typeof k === 'string' && src[i - 1] !== '"') i += k.length;
          let val;
          if (eat(':')) val = alt(); else val = v => [index(v, k)];
          pairs.push([k, val]);
        } while (eat(','));
      }
      need('}');
      return v => pairs.reduce((acc, [k, f]) => acc.flatMap(o => f(v).map(x => ({ ...o, [k]: x }))), [{}]);
    }
    if ((s = str()) !== null) return () => [s];
    const num = src.slice(i).match(/^-?\d+(\.\d+)?/);
    if (num) { i += num[0].length; return () => [parseFloat(num[0])]; }
    if (peek('.')) {
      i++;
      if (src[i] === '"') { const k = str(); return v => [index(v, k)]; }
      const m = src.slice(i).match(/^[A-Za-z_]\w*/);
      if (m) { i += m[0].length; return v => [index(v, m[0])]; }
      return v => [v];
    }
    const w = word();
    if (!w) throw new SyntaxError(`unexpected ${src[i] === undefined ? 'end of filter' : `'${src[i]}'`}`);
    i += w.length;
    if (w === 'true') return () => [true];
    if (w === 'false') return () => [false];
    if (w === 'null') return () => [null];
    if (w === 'empty') return () => [];
    if (eat('(')) {
      const f = pipe();
      need(')');
      switch (w) {
        case 'map': return v => [iter(v).flatMap(x => f(x))];
        case 'select': return v => (f(v).some(truthy) ? [v] : []);
        case 'sort_by': return v => [[...iter(v)].sort((a, b) => cmp(f(a)[0], f(b)[0]))];
        case 'group_by': return v => { const g = {}; for (const x of iter(v)) (g[JSON.stringify(f(x)[0])] ??= []).push(x); return [Object.keys(g).sort().map(k => g[k])]; };
        case 'has': return v => f(v).map(k => (Array.isArray(v) ? k < v.length : Object.hasOwn(v ?? {}, k)));
        case 'join': return v => f(v).map(sep => iter(v).map(x => (x === null ? '' : String(x))).join(sep));
        case 'startswith': return v => f(v).map(x => String(v).startsWith(x));
        case 'endswith': return v => f(v).map(x => String(v).endsWith(x));
        case 'contains': return v => f(v).map(x => (typeof v === 'string' ? v.includes(x) : JSON.stringify(v).includes(JSON.stringify(x).slice(1, -1))));
        case 'test': return v => f(v).map(x => new RegExp(x).test(String(v)));
        case 'split': return v => f(v).map(x => String(v).split(x));
        case 'any': return v => [iter(v).some(x => f(x).some(truthy))];
        case 'all': return v => [iter(v).every(x => f(x).some(truthy))];
        default: throw new SyntaxError(`${w}/1 is not defined`);
      }
    }
    if (!FN0[w]) throw new SyntaxError(`${w}/0 is not defined`);
    return v => [FN0[w](v)];
  }
  function postfix() {
    let f = primary();
    for (;;) {
      const g = f;
      if (src[i] === '.' && /["A-Za-z_]/.test(src[i + 1] || '')) {
        i++;
        const k = src[i] === '"' ? str() : word();
        if (src[i - 1] !== '"') i += k.length;
        f = v => g(v).map(x => index(x, k));
      } else if (src[i] === '[') {
        i++;
        if (eat(']')) f = v => g(v).flatMap(iter);
        else {
          const sl = src.slice(i).match(/^\s*(-?\d*)\s*:\s*(-?\d*)\s*\]/);
          if (sl) { i += sl[0].length; f = v => g(v).map(x => (x === null ? null : x.slice(sl[1] === '' ? 0 : +sl[1], sl[2] === '' ? undefined : +sl[2]))); }
          else { const k = str() ?? (() => { const m = src.slice(i).match(/^\s*-?\d+/); if (!m) throw new SyntaxError('index expected'); i += m[0].length; return +m[0]; })(); need(']'); f = v => g(v).map(x => index(x, k)); }
        }
      } else if (src[i] === '?') { i++; f = v => { try { return g(v); } catch (e) { if (e instanceof JqError) return []; throw e; } }; }
      else return f;
    }
  }
  function arith() {
    let l = postfix();
    for (;;) {
      ws();
      const m = src.slice(i).match(/^(\+|-(?!\d)|\*|\/(?!\/))/);
      if (!m) return l;
      i += m[0].length;
      const a = l, b = postfix(), op = m[0];
      l = v => a(v).flatMap(x => b(v).map(y => (op === '+' ? (x === null ? y : y === null ? x : Array.isArray(x) ? x.concat(y) : typeof x === 'object' ? { ...x, ...y } : x + y) : op === '-' ? x - y : op === '*' ? x * y : x / y)));
    }
  }
  function compare() {
    const l = arith();
    ws();
    const m = src.slice(i).match(/^(==|!=|<=|>=|<|>)/);
    if (!m) return l;
    i += m[0].length;
    const r = arith();
    const t = { '==': d => d === 0, '!=': d => d !== 0, '<': d => d < 0, '<=': d => d <= 0, '>': d => d > 0, '>=': d => d >= 0 }[m[0]];
    return v => l(v).flatMap(a => r(v).map(b => t(cmp(a, b))));
  }
  function logic() {
    let l = compare();
    for (;;) {
      const w = word();
      if (w !== 'and' && w !== 'or') return l;
      i += w.length;
      const a = l, b = compare();
      l = v => a(v).flatMap(x => b(v).map(y => (w === 'and' ? truthy(x) && truthy(y) : truthy(x) || truthy(y))));
    }
  }
  function alt() {
    const l = logic();
    if (!eat('//')) return l;
    const r = alt();
    return v => { const xs = l(v).filter(truthy); return xs.length ? xs : r(v); };
  }
  function comma() {
    const fs = [alt()];
    while (eat(',')) fs.push(alt());
    return fs.length === 1 ? fs[0] : v => fs.flatMap(f => f(v));
  }
  function pipe() {
    let l = comma();
    while (eat('|')) { const a = l, b = comma(); l = v => a(v).flatMap(b); }
    return l;
  }
  const f = pipe();
  ws();
  if (i < src.length) throw new SyntaxError(`unexpected '${src[i]}'`);
  return f;
}

function jqPrint(v, color, compact) {
  const K = s => (color ? sgr('1;34', s) : s), S = s => (color ? sgr('32', s) : s), N = s => (color ? sgr('90', s) : s);
  const go = (x, ind) => {
    if (x === null) return N('null');
    if (typeof x === 'string') return S(JSON.stringify(x));
    if (typeof x !== 'object') return String(x);
    const arr = Array.isArray(x);
    const items = arr ? x.map(e => go(e, ind + '  ')) : Object.entries(x).map(([k, e]) => K(JSON.stringify(k)) + (compact ? ':' : ': ') + go(e, ind + '  '));
    if (!items.length) return arr ? '[]' : '{}';
    if (compact) return (arr ? '[' : '{') + items.join(',') + (arr ? ']' : '}');
    return (arr ? '[' : '{') + '\n' + items.map(s => ind + '  ' + s).join(',\n') + '\n' + ind + (arr ? ']' : '}');
  };
  return go(v, '');
}

def('jq', async c => {
  const p = c.opts({ bool: 'rcsnMCeS', permute: true, long: { 'raw-output': 'bool', 'compact-output': 'bool', version: 'bool', slurp: 'bool' } });
  if (!p) return 2;
  const o = p.o;
  if (o.version) { c.println('jq-1.7.1'); return 0; }
  if (!p.rest.length) {
    c.err("Usage:\tjq [OPTIONS] FILTER [FILES...]\n\nUse jq --help for help with command-line options,\nor see the jq manpage, or online docs  at https://jqlang.github.io/jq\n");
    c.sh.lastErr = { cmd: 'jq', code: 'USAGE' };
    return 2;
  }
  const [filter, ...files] = p.rest;
  let f;
  try { f = jqCompile(filter); } catch (e) {
    if (!(e instanceof SyntaxError)) throw e;
    c.err(`jq: error: syntax error, ${e.message} (Unix shell quoting issues?) at <top-level>, line 1:\n${filter}\njq: 1 compile error\n`);
    c.sh.lastErr = { cmd: 'jq', code: 'JQ_SYNTAX', target: filter };
    return 3;
  }
  let text = '';
  if (files.length) { for (const file of files) { const t = c.read(file); if (t === null) return 2; text += t; } }
  else if (!o.n) text = await c.input();
  let docs;
  try { docs = o.n ? [null] : [JSON.parse(text)]; } catch {
    try { docs = splitLines(text).filter(l => l.trim()).map(l => JSON.parse(l)); } catch (e) {
      const m = /position (\d+)/.exec(e.message);
      const pos = m ? +m[1] : 0;
      const line = text.slice(0, pos).split('\n').length;
      c.err(`jq: error (at ${files[0] || '<stdin>'}:${line}): Invalid JSON text: ${text.trim().slice(0, 20) || 'empty input'}\n`);
      c.sh.lastErr = { cmd: 'jq', code: 'JQ_INPUT' };
      return 2;
    }
  }
  if (o.s || o.slurp) docs = [docs];
  const color = (c.tty || o.C) && !o.M;
  try {
    for (const d of docs) for (const v of f(d)) c.println((o.r || o['raw-output']) && typeof v === 'string' ? v : jqPrint(v, color, o.c || o['compact-output']));
  } catch (e) {
    if (!(e instanceof JqError)) throw e;
    c.err(`jq: error (at ${files[0] || '<stdin>'}:0): ${e.message}\n`);
    c.sh.lastErr = { cmd: 'jq', code: 'JQ_RUNTIME', target: e.message };
    return 5;
  }
}, { pkg: 'jq' });

def('tldr', c => {
  const name = c.args.find(a => !a.startsWith('-'));
  if (!name) { c.err('error: the following required arguments were not provided:\n  <PAGE>...\n\nUsage: tldr <PAGE>...\n'); c.sh.lastErr = { cmd: 'tldr', code: 'USAGE' }; return 2; }
  const r = REFMAP[name];
  if (!r || (r.os && r.os !== c.os)) { c.err(`error: page '${name}' not found.\n`); c.sh.lastErr = { cmd: 'tldr', code: 'NOMAN', target: name }; return 1; }
  const B = s => (c.tty ? sgr('1', s) : s), G = s => (c.tty ? sgr('32', s) : s), Y = s => (c.tty ? sgr('36', s) : s);
  c.println(`\n  ${B(name)}\n\n  ${r.sum}.`);
  const note = noteFor(r, c.os);
  if (note) c.println(`  ${note.replace(/`/g, '')}`);
  for (const [cmd, desc] of r.ex) c.println(`\n  ${G('- ' + desc[0].toUpperCase() + desc.slice(1) + ':')}\n    ${Y(cmd)}`);
  c.println('');
}, { pkg: 'tldr' });

// ---------- zoxide ----------
def('zoxide', c => {
  const sh = c.sh;
  const [sub, ...a] = c.args;
  if (sub === '--version' || sub === '-V') { c.println('zoxide 0.9.6'); return 0; }
  if (sub === 'init') {
    if (!a[0]) { c.err("error: the following required arguments were not provided:\n  <SHELL>\n\nUsage: zoxide init <SHELL>\n"); return 2; }
    c.println("# zoxide shell integration (simplified by the trainer)\nalias z='__zoxide_z'");
    return 0;
  }
  if (sub === 'query') {
    const kw = a.filter(x => !x.startsWith('-'));
    const hits = Object.entries(sh.visits).filter(([d]) => kw.every(k => d.toLowerCase().includes(k.toLowerCase()))).sort((x, y) => y[1] - x[1]);
    if (!hits.length) { c.err('zoxide: no match found\n'); return 1; }
    (a.includes('-l') || a.includes('--list') ? hits : hits.slice(0, 1)).forEach(([d]) => c.println(d));
    return 0;
  }
  if (sub === 'add') { for (const d of a) sh.visit(c.abs(d)); return 0; }
  c.println('zoxide 0.9.6\nA smarter cd command for your terminal\n\nUsage:\n  zoxide <COMMAND>\n\nCommands:\n  add     Add a new directory or increment its rank\n  init    Generate shell configuration\n  query   Search for a directory in the database');
  return sub ? 2 : 0;
}, { pkg: 'zoxide' });

def('__zoxide_z', c => {
  const sh = c.sh;
  const kw = c.args;
  const cd = d => sh.exec(['cd', d], c.sio, { alias: false });
  if (!kw.length) return cd(sh.home);
  if (kw.length === 1) {
    if (kw[0] === '-') return cd('-');
    const n = c.fs.get(c.abs(kw[0]));
    if (n && n.t === 'd') return cd(kw[0]);
  }
  const low = kw.map(k => k.toLowerCase());
  const hits = Object.entries(sh.visits)
    .filter(([d]) => {
      const l = d.toLowerCase();
      let from = 0;
      for (const k of low) { const i = l.indexOf(k, from); if (i < 0) return false; from = i + k.length; }
      return l.split('/').pop().includes(low.at(-1)) && d !== sh.cwd && c.fs.get(d)?.t === 'd';
    })
    .sort((a, b) => b[1] - a[1]);
  if (!hits.length) { c.err('zoxide: no match found\n'); sh.lastErr = { cmd: 'z', code: 'Z_NOMATCH', target: kw.join(' ') }; return 1; }
  return cd(hits[0][0]);
}, { builtin: true, hidden: true });

def('cowsay', async c => {
  const text = (c.args.length ? c.args.join(' ') : (await c.input()).trim()) || 'Moo';
  const w = Math.min(40, text.length);
  const lines = [];
  for (let i = 0; i < text.length; i += 40) lines.push(text.slice(i, i + 40));
  c.println(' ' + '_'.repeat(w + 2));
  lines.forEach((l, i) => {
    const [a, b] = lines.length === 1 ? ['<', '>'] : i === 0 ? ['/', '\\'] : i === lines.length - 1 ? ['\\', '/'] : ['|', '|'];
    c.println(`${a} ${l.padEnd(w)} ${b}`);
  });
  c.println(' ' + '-'.repeat(w + 2));
  c.println('        \\   ^__^\n         \\  (oo)\\_______\n            (__)\\       )\\/\\\n                ||----w |\n                ||     ||');
}, { pkg: 'cowsay' });
