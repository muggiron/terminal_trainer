// A modal vi/vim editor model: Normal, Insert, Replace, Visual and command-line modes.
// It is pure logic (no DOM), so it can be tested on its own. The terminal draws
// whatever render() returns.

import { toRegex } from '../shell/util.js';

const cls = ch => (ch === undefined || ch === '' || /\s/.test(ch) ? 0 : /\w/.test(ch) ? 1 : 2);
const fnb = line => { const m = line.search(/\S/); return m < 0 ? 0 : m; };
const isChar = k => k.length === 1 || (k.length === 2 && k.codePointAt(0) > 0xffff);
const byteLen = s => new TextEncoder().encode(s).length;

export function expand(line) {
  let text = '';
  const map = [];
  for (let i = 0; i < line.length; i++) {
    map.push(text.length);
    text += line[i] === '\t' ? ' '.repeat(8 - (text.length % 8)) : line[i];
  }
  map.push(text.length);
  return { text, map };
}

const PAIRS = { '(': '()', ')': '()', b: '()', '[': '[]', ']': '[]', '{': '{}', '}': '{}', B: '{}', '<': '<>', '>': '<>' };

export class Vi {
  // write(name, text) must return null on success or an error code such as 'EACCES'.
  constructor({ text = '', name = '', isNew = false, readonly = false, denied = false, write = null, emit = null } = {}) {
    this.name = name;
    this.write = write || (() => null);
    this.emit = emit || (() => {});
    this.lines = text.split('\n');
    if (text.endsWith('\n')) this.lines.pop();
    if (!this.lines.length) this.lines = [''];
    this.saved = this.lines.join('\n');
    this.cx = 0; this.cy = 0; this.top = 0; this.left = 0; this.want = 0;
    this.mode = 'normal';
    this.rows = 24; this.cols = 80;
    this.count = ''; this.op = null; this.opCount = ''; this.wait = null;
    this.reg = { text: '', line: false };
    this.undo = []; this.redo = [];
    this.cmd = '';
    this.opt = { number: false, relativenumber: false, hlsearch: false, ignorecase: false };
    this.search = null; this.searchText = ''; this.searchDir = 1; this.hl = false;
    this.anchor = null; this.lastVis = null; this.lastFind = null;
    this.keys = []; this.last = null; this.replaying = false; this.changed = false;
    this.done = false;
    this.isNew = isNew;
    this.readonly = readonly;
    this.pristine = !name && !text;
    this.err = false;
    const info = `${this.lines.length}L, ${byteLen(text)}B`;
    this.msg = !name ? '' : denied ? `"${name}" [Permission Denied]` : isNew ? `"${name}" [New]` : readonly ? `"${name}" [readonly] ${info}` : `"${name}" ${info}`;
  }

  get dirty() { return this.lines.join('\n') !== this.saved; }
  get text() { return this.lines.join('\n'); }

  resize(rows, cols) { this.rows = rows; this.cols = cols; }

  // ---------- key input ----------
  key(k) {
    if (k === 'C-[') k = 'Escape';
    this.pristine = false;
    const idle = () => this.mode === 'normal' && !this.op && !this.wait && !this.count;
    if (!this.replaying) {
      if (idle()) this.keys = [];
      this.keys.push(k);
    }
    const before = this.mode;
    if (this.mode === 'insert' || this.mode === 'replace') this.kInsert(k);
    else if (this.mode === 'cmd' || this.mode === 'search') this.kLine(k);
    else this.kNormal(k);
    this.clamp();
    if (!this.replaying && this.changed && idle()) { this.last = this.keys.slice(); this.changed = false; }
    if (this.mode !== before) this.emit('mode', { mode: this.mode, from: before });
    if (!this.replaying) this.emit('key', { key: k, keys: this.keys.join('') });
  }

  clamp() {
    const L = this.lines;
    this.cy = Math.max(0, Math.min(L.length - 1, this.cy));
    const max = this.mode === 'insert' || this.mode === 'replace' ? L[this.cy].length : Math.max(0, L[this.cy].length - 1);
    this.cx = Math.max(0, Math.min(max, this.cx));
  }

  reset() { this.op = null; this.opCount = ''; this.count = ''; this.wait = null; }
  fail(msg) { this.msg = msg; this.err = true; this.emit('error', { code: msg.split(':')[0], msg }); return false; }
  snap() { this.undo.push({ lines: this.lines.slice(), cx: this.cx, cy: this.cy }); this.redo = []; }
  enterInsert(snap = true, mode = 'insert') { if (snap) this.snap(); this.mode = mode; this.changed = true; }

  kInsert(k) {
    const L = this.lines;
    const l = L[this.cy];
    this.msg = '';
    if (k === 'Escape' || k === 'C-c') { this.mode = 'normal'; this.cx = Math.max(0, this.cx - 1); this.want = this.cx; return; }
    if (k === 'Enter') { L.splice(this.cy, 1, l.slice(0, this.cx), l.slice(this.cx)); this.cy++; this.cx = 0; return; }
    if (k === 'Backspace') {
      if (this.cx > 0) { L[this.cy] = l.slice(0, this.cx - 1) + l.slice(this.cx); this.cx--; }
      else if (this.cy > 0) { this.cx = L[this.cy - 1].length; L.splice(this.cy - 1, 2, L[this.cy - 1] + l); this.cy--; }
      return;
    }
    if (k === 'Delete') {
      if (this.cx < l.length) L[this.cy] = l.slice(0, this.cx) + l.slice(this.cx + 1);
      else if (this.cy < L.length - 1) L.splice(this.cy, 2, l + L[this.cy + 1]);
      return;
    }
    if (k === 'ArrowLeft') { this.cx--; return; }
    if (k === 'ArrowRight') { this.cx++; return; }
    if (k === 'ArrowUp') { this.cy--; return; }
    if (k === 'ArrowDown') { this.cy++; return; }
    if (k === 'Home') { this.cx = 0; return; }
    if (k === 'End') { this.cx = l.length; return; }
    if (k === 'C-w') { const m = l.slice(0, this.cx).match(/(\w+|[^\w\s]+)?\s*$/); const n = m ? m[0].length : 0; L[this.cy] = l.slice(0, this.cx - n) + l.slice(this.cx); this.cx -= n; return; }
    if (k === 'C-u') { L[this.cy] = l.slice(this.cx); this.cx = 0; return; }
    if (k === 'Tab') k = '\t';
    if (!isChar(k)) return;
    if (this.mode === 'replace' && this.cx < l.length) L[this.cy] = l.slice(0, this.cx) + k + l.slice(this.cx + 1);
    else L[this.cy] = l.slice(0, this.cx) + k + l.slice(this.cx);
    this.cx += k.length;
  }

  kLine(k) {
    if (k === 'Escape' || k === 'C-c') { this.mode = 'normal'; return; }
    if (k === 'Enter') {
      const text = this.cmd;
      const mode = this.mode;
      this.mode = 'normal';
      this.msg = '';
      this.err = false;
      if (mode === 'cmd') this.ex(text);
      else this.doSearch(text);
      return;
    }
    if (k === 'Backspace') { if (!this.cmd) this.mode = 'normal'; else this.cmd = this.cmd.slice(0, -1); return; }
    if (isChar(k)) this.cmd += k;
  }

  kNormal(k) {
    const vis = this.mode === 'visual' || this.mode === 'vline';
    const L = this.lines;
    this.msg = '';
    this.err = false;
    if (this.wait) { const w = this.wait; this.wait = null; return this.waited(w, k); }
    if (/^[1-9]$/.test(k) || (k === '0' && this.count)) { this.count += k; return; }
    const total = this.count || this.opCount ? (parseInt(this.count, 10) || 1) * (parseInt(this.opCount, 10) || 1) : null;
    const N = total ?? 1;

    if (k.length === 1 && 'dcy<>'.includes(k)) {
      if (vis) return this.visOp(k);
      if (this.op === k) {
        const y2 = Math.min(L.length - 1, this.cy + N - 1);
        this.operate(k, { line: true, y1: this.cy, y2 });
        return this.reset();
      }
      if (this.op) return this.reset();
      this.op = k;
      this.opCount = this.count;
      this.count = '';
      return;
    }
    if ((this.op || vis) && (k === 'i' || k === 'a')) { this.wait = { type: 'obj', kind: k }; return; }

    const m = this.motion(k, total);
    if (m === 'wait') return;
    if (m) return this.doMotion(m);
    if (this.op) return this.reset();

    const l = L[this.cy];
    switch (k) {
      case 'i': if (vis) break; this.enterInsert(); break;
      case 'a': this.enterInsert(); this.cx = Math.min(l.length, this.cx + 1); break;
      case 'I': this.enterInsert(); this.cx = fnb(l); break;
      case 'A': if (vis) break; this.enterInsert(); this.cx = l.length; break;
      case 'o':
        if (vis) { const a = this.anchor; this.anchor = { x: this.cx, y: this.cy }; this.cx = a.x; this.cy = a.y; break; }
        this.enterInsert(); L.splice(this.cy + 1, 0, ''); this.cy++; this.cx = 0; break;
      case 'O': this.enterInsert(); L.splice(this.cy, 0, ''); this.cx = 0; break;
      case 'x': case 'Delete':
        if (vis) return this.visOp('d');
        if (l.length) this.operate('d', { y1: this.cy, x1: this.cx, y2: this.cy, x2: Math.min(l.length, this.cx + N) });
        break;
      case 'X': if (this.cx > 0) this.operate('d', { y1: this.cy, x1: Math.max(0, this.cx - N), y2: this.cy, x2: this.cx }); break;
      case 's':
        if (vis) return this.visOp('c');
        this.operate('c', { y1: this.cy, x1: this.cx, y2: this.cy, x2: Math.min(l.length, this.cx + N) });
        break;
      case 'S': this.operate('c', { line: true, y1: this.cy, y2: Math.min(L.length - 1, this.cy + N - 1) }); break;
      case 'D': this.operate('d', { y1: this.cy, x1: this.cx, y2: this.cy, x2: l.length }); break;
      case 'C': this.operate('c', { y1: this.cy, x1: this.cx, y2: this.cy, x2: l.length }); break;
      case 'Y': this.operate('y', { line: true, y1: this.cy, y2: Math.min(L.length - 1, this.cy + N - 1) }); break;
      case 'p': this.paste(true, N); break;
      case 'P': this.paste(false, N); break;
      case 'u': if (vis) break; this.doUndo(); break;
      case 'C-r': this.doRedo(); break;
      case '.':
        if (this.last) {
          this.replaying = true;
          for (const key of this.last) this.key(key);
          this.replaying = false;
          this.changed = false;
        }
        break;
      case 'J': {
        if (vis) return this.visOp('J');
        const n = Math.max(2, N);
        this.snap();
        for (let i = 1; i < n && this.cy < L.length - 1; i++) {
          const a = L[this.cy].replace(/\s+$/, '');
          const b = L[this.cy + 1].replace(/^\s+/, '');
          this.cx = a.length;
          L.splice(this.cy, 2, a + (a && b ? ' ' : '') + b);
        }
        this.changed = true;
        break;
      }
      case '~': {
        if (vis) return this.visOp('~');
        if (!l.length) break;
        this.snap();
        const end = Math.min(l.length, this.cx + N);
        L[this.cy] = l.slice(0, this.cx) + [...l.slice(this.cx, end)].map(ch => (ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase())).join('') + l.slice(end);
        this.cx = end;
        this.changed = true;
        break;
      }
      case 'r': this.wait = { type: 'r', n: N }; return;
      case 'R': this.enterInsert(true, 'replace'); break;
      case 'v': case 'V': {
        const want = k === 'v' ? 'visual' : 'vline';
        if (this.mode === want) this.endVisual();
        else { if (!vis) this.anchor = { x: this.cx, y: this.cy }; this.mode = want; }
        break;
      }
      case ':':
        this.cmd = vis ? "'<,'>" : '';
        if (vis) this.endVisual();
        this.mode = 'cmd';
        break;
      case '/': case '?': this.searchDir = k === '/' ? 1 : -1; this.cmd = ''; if (vis) this.endVisual(); this.mode = 'search'; break;
      case 'Z': this.wait = { type: 'Z' }; return;
      case 'z': this.wait = { type: 'z' }; return;
      case 'Escape': if (vis) this.endVisual(); break;
      case 'C-c':
        if (vis) this.endVisual();
        else this.msg = 'Type  :qa  and press <Enter> to exit Vim';
        break;
      case 'C-g': this.msg = `"${this.name || '[No Name]'}"${this.dirty ? ' [Modified]' : ''} ${L.length} lines --${Math.round(((this.cy + 1) / L.length) * 100)}%--`; break;
      default:
    }
    this.count = '';
    this.opCount = '';
  }

  endVisual() {
    this.lastVis = this.selection();
    this.mode = 'normal';
    this.anchor = null;
  }

  // Current visual selection, normalised.
  selection() {
    if (!this.anchor || (this.mode !== 'visual' && this.mode !== 'vline')) return null;
    const a = this.anchor, b = { x: this.cx, y: this.cy };
    const [s, e] = a.y < b.y || (a.y === b.y && a.x <= b.x) ? [a, b] : [b, a];
    return { line: this.mode === 'vline', y1: s.y, x1: s.x, y2: e.y, x2: e.x };
  }

  visOp(k) {
    const s = this.selection();
    const L = this.lines;
    this.endVisual();
    if (k === 'J') { this.cy = s.y1; this.count = String(Math.max(2, s.y2 - s.y1 + 1)); return this.kNormal('J'); }
    if (k === '~') {
      this.snap();
      for (let y = s.y1; y <= s.y2; y++) {
        const a = s.line || y > s.y1 ? 0 : s.x1;
        const b = s.line || y < s.y2 ? L[y].length : s.x2 + 1;
        L[y] = L[y].slice(0, a) + [...L[y].slice(a, b)].map(ch => (ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase())).join('') + L[y].slice(b);
      }
      this.cy = s.y1; this.cx = s.line ? 0 : s.x1;
      this.changed = true;
      return;
    }
    if (s.line || k === '<' || k === '>') this.operate(k, { line: true, y1: s.y1, y2: s.y2 });
    else this.operate(k, { y1: s.y1, x1: s.x1, y2: s.y2, x2: Math.min(L[s.y2].length, s.x2 + 1) });
    this.reset();
  }

  // ---------- motions ----------
  motion(k, n) {
    const L = this.lines;
    const { cx: x, cy: y } = this;
    const N = n ?? 1;
    const last = L.length - 1;
    const page = Math.max(1, this.rows - 2);
    const lineTo = ny => ({ x: this.want, y: Math.max(0, Math.min(last, ny)), line: true, keepWant: true });
    const none = () => { this.reset(); return 'wait'; }; // nothing to move to: cancel any pending operator
    switch (k) {
      case 'h': case 'ArrowLeft': case 'Backspace': return { x: Math.max(0, x - N), y };
      case 'l': case 'ArrowRight': case ' ': return { x: Math.min(x + N, this.op ? L[y].length : Math.max(0, L[y].length - 1)), y };
      case 'j': case 'ArrowDown': case 'C-n': case 'C-j': return lineTo(y + N);
      case 'k': case 'ArrowUp': case 'C-p': return lineTo(y - N);
      case 'Enter': case '+': { const ny = Math.min(last, y + N); return { x: fnb(L[ny]), y: ny, line: true }; }
      case '-': { const ny = Math.max(0, y - N); return { x: fnb(L[ny]), y: ny, line: true }; }
      case '0': case 'Home': return { x: 0, y };
      case '^': return { x: fnb(L[y]), y };
      case '$': case 'End': {
        const ny = Math.min(last, y + N - 1);
        return { x: this.op ? L[ny].length : Math.max(0, L[ny].length - 1), y: ny, toEnd: true };
      }
      case 'w': case 'W': {
        if (this.op === 'c' && cls(L[y][x])) {
          let p = { x, y };
          const big = k === 'W';
          const c0 = big ? 1 : cls(L[y][x]);
          while (p.x + 1 < L[y].length && (big ? cls(L[y][p.x + 1]) > 0 : cls(L[y][p.x + 1]) === c0)) p.x++;
          for (let i = 1; i < N; i++) p = this.endWord(p, big);
          return { ...p, incl: true };
        }
        let p = { x, y };
        for (let i = 0; i < N; i++) p = this.fwdWord(p, k === 'W');
        if (this.op && p.y > y && N === 1) p = { x: L[y].length, y };
        return p;
      }
      case 'b': case 'B': { let p = { x, y }; for (let i = 0; i < N; i++) p = this.backWord(p, k === 'B'); return p; }
      case 'e': case 'E': { let p = { x, y }; for (let i = 0; i < N; i++) p = this.endWord(p, k === 'E'); return { ...p, incl: true }; }
      case 'G': { const ny = n ? Math.min(last, n - 1) : last; return { x: fnb(L[ny]), y: ny, line: true }; }
      case 'g': this.wait = { type: 'g', n }; return 'wait';
      case 'f': case 'F': case 't': case 'T': this.wait = { type: 'find', k, n: N }; return 'wait';
      case ';': return (this.lastFind && this.findChar(this.lastFind.k, this.lastFind.ch, N)) || none();
      case '%': {
        const m = this.matchBracket();
        return m ? { ...m, incl: true } : none();
      }
      case '}': { let ny = y + 1; while (ny < last && L[ny].trim()) ny++; return { x: 0, y: Math.min(last, ny) }; }
      case '{': { let ny = y - 1; while (ny > 0 && L[ny].trim()) ny--; return { x: 0, y: Math.max(0, ny) }; }
      case 'H': return { x: fnb(L[this.top]), y: this.top, line: true };
      case 'L': { const ny = Math.min(last, this.top + this.rows - 2); return { x: fnb(L[ny]), y: ny, line: true }; }
      case 'M': { const ny = Math.min(last, this.top + Math.floor((Math.min(last - this.top, this.rows - 2)) / 2)); return { x: fnb(L[ny]), y: ny, line: true }; }
      case 'n': case 'N': {
        if (!this.search) { this.fail('E35: No previous regular expression'); return none(); }
        const p = this.findNext(k === 'n' ? this.searchDir : -this.searchDir);
        if (!p) { this.fail(`E486: Pattern not found: ${this.searchText}`); return none(); }
        this.hl = true;
        return p;
      }
      case '*': case '#': {
        const o = this.textObject('i', 'w');
        if (!o || !cls(L[y][x])) return none();
        this.setSearch('\\<' + L[y].slice(o.x1, o.x2).replace(/[.*[\]\\^$~/]/g, '\\$&') + '\\>');
        this.searchDir = k === '*' ? 1 : -1;
        this.cx = o.x1;
        return this.findNext(this.searchDir) || none();
      }
      case 'C-f': case 'PageDown': return lineTo(y + page * N);
      case 'C-b': case 'PageUp': return lineTo(y - page * N);
      case 'C-d': return lineTo(y + Math.ceil(page / 2));
      case 'C-u': return lineTo(y - Math.ceil(page / 2));
      default: return null;
    }
  }

  doMotion(m) {
    if (this.op) {
      const a = { x: this.cx, y: this.cy };
      const [s, e] = a.y < m.y || (a.y === m.y && a.x <= m.x) ? [a, m] : [m, a];
      if (m.line) this.operate(this.op, { line: true, y1: s.y, y2: e.y });
      else this.operate(this.op, { y1: s.y, x1: s.x, y2: e.y, x2: e.x + (m.incl ? 1 : 0) });
    } else {
      this.cy = m.y;
      this.cx = m.x;
      if (m.toEnd) this.want = 1e9;
      else if (!m.keepWant) this.want = m.x;
    }
    this.reset();
  }

  waited(w, k) {
    const L = this.lines;
    if (k === 'Escape' || k === 'C-c') return this.reset();
    if (w.type === 'g') {
      if (k === 'g') { const ny = w.n ? Math.min(L.length - 1, w.n - 1) : 0; return this.doMotion({ x: fnb(L[ny]), y: ny, line: true }); }
      if (k === 'e') { const p = this.backWord({ x: this.cx, y: this.cy }, false); return this.doMotion({ ...this.endWord({ x: Math.max(0, p.x - 1), y: p.y }, false), incl: true }); }
      return this.reset();
    }
    if (w.type === 'find') {
      if (!isChar(k)) return this.reset();
      this.lastFind = { k: w.k, ch: k };
      const m = this.findChar(w.k, k, w.n);
      return m ? this.doMotion(m) : this.reset();
    }
    if (w.type === 'r') {
      const l = L[this.cy];
      if (!isChar(k) || this.cx + w.n > l.length) return this.reset();
      this.snap();
      L[this.cy] = l.slice(0, this.cx) + k.repeat(w.n) + l.slice(this.cx + w.n);
      this.cx += w.n - 1;
      this.changed = true;
      return this.reset();
    }
    if (w.type === 'obj') {
      const o = this.textObject(w.kind, k);
      if (!o) return this.reset();
      if (this.op) { this.operate(this.op, { y1: this.cy, x1: o.x1, y2: this.cy, x2: o.x2 }); return this.reset(); }
      this.anchor = { x: o.x1, y: this.cy };
      this.cx = Math.max(o.x1, o.x2 - 1);
      return;
    }
    if (w.type === 'Z') {
      if (k === 'Z') this.ex('x');
      else if (k === 'Q') this.ex('q!');
      return this.reset();
    }
    this.reset();
  }

  findChar(kind, ch, n) {
    const l = this.lines[this.cy];
    let i = this.cx;
    const fwd = kind === 'f' || kind === 't';
    for (let c = 0; c < n; c++) {
      i = fwd ? l.indexOf(ch, i + 1) : l.lastIndexOf(ch, i - 1);
      if (i < 0 || (!fwd && this.cx === 0)) return null;
    }
    if (kind === 't') i--;
    if (kind === 'T') i++;
    return { x: i, y: this.cy, incl: fwd };
  }

  matchBracket() {
    const L = this.lines;
    const l = L[this.cy];
    let x = this.cx;
    while (x < l.length && !'()[]{}'.includes(l[x])) x++;
    if (x >= l.length) return null;
    const ch = l[x];
    const pair = PAIRS[ch];
    const dir = ch === pair[0] ? 1 : -1;
    let depth = 0;
    let y = this.cy;
    for (;;) {
      const c = L[y][x];
      if (c === pair[0]) depth += 1;
      else if (c === pair[1]) depth -= 1;
      if (depth === 0) return { x, y };
      x += dir;
      while (x < 0 || x >= L[y].length) {
        y += dir;
        if (y < 0 || y >= L.length) return null;
        x = dir > 0 ? 0 : L[y].length - 1;
        if (!L[y].length) x = dir > 0 ? L[y].length : -1;
      }
    }
  }

  textObject(kind, k) {
    const l = this.lines[this.cy];
    const x = Math.min(this.cx, Math.max(0, l.length - 1));
    if (k === 'w' || k === 'W') {
      if (!l.length) return null;
      const big = k === 'W';
      const c = i => (big && cls(l[i]) ? 1 : cls(l[i]));
      let a = x, b = x + 1;
      while (a > 0 && c(a - 1) === c(x)) a--;
      while (b < l.length && c(b) === c(x)) b++;
      if (kind === 'a') {
        const b0 = b;
        while (b < l.length && cls(l[b]) === 0) b++;
        if (b === b0) while (a > 0 && cls(l[a - 1]) === 0) a--;
      }
      return { x1: a, x2: b };
    }
    if (k === '"' || k === "'" || k === '`') {
      let a = l.lastIndexOf(k, x);
      let b = a >= 0 ? l.indexOf(k, a === x ? x + 1 : Math.max(x, a + 1)) : -1;
      if (a < 0 || b < 0) { a = l.indexOf(k, x); b = a >= 0 ? l.indexOf(k, a + 1) : -1; }
      if (a < 0 || b < 0) return null;
      return kind === 'i' ? { x1: a + 1, x2: b } : { x1: a, x2: b + 1 };
    }
    const pair = PAIRS[k];
    if (!pair) return null;
    let depth = 0, a = -1;
    for (let i = x; i >= 0; i--) {
      if (l[i] === pair[1] && i !== x) depth++;
      else if (l[i] === pair[0]) { if (depth === 0) { a = i; break; } depth--; }
    }
    if (a < 0) return null;
    depth = 0;
    for (let i = a; i < l.length; i++) {
      if (l[i] === pair[0]) depth++;
      else if (l[i] === pair[1] && --depth === 0) return kind === 'i' ? { x1: a + 1, x2: i } : { x1: a, x2: i + 1 };
    }
    return null;
  }

  fwdWord(p, big) {
    const L = this.lines;
    let { x, y } = p;
    const c = () => (big && cls(L[y][x]) ? 1 : cls(L[y][x]));
    const start = c();
    if (start) while (x < L[y].length && c() === start) x++;
    for (;;) {
      while (x < L[y].length && !c()) x++;
      if (x < L[y].length) return { x, y };
      if (y >= L.length - 1) return { x: L[y].length, y };
      y++;
      x = 0;
      if (!L[y].length) return { x, y };
    }
  }

  endWord(p, big) {
    const L = this.lines;
    let { x, y } = p;
    const c = i => (big && cls(L[y][i]) ? 1 : cls(L[y][i]));
    x++;
    for (;;) {
      while (x < L[y].length && !c(x)) x++;
      if (x < L[y].length) break;
      if (y >= L.length - 1) return { x: Math.max(0, L[y].length - 1), y };
      y++;
      x = 0;
    }
    const k = c(x);
    while (x + 1 < L[y].length && c(x + 1) === k) x++;
    return { x, y };
  }

  backWord(p, big) {
    const L = this.lines;
    let { x, y } = p;
    const c = i => (big && cls(L[y][i]) ? 1 : cls(L[y][i]));
    x--;
    for (;;) {
      while (x >= 0 && !c(x)) x--;
      if (x >= 0) break;
      if (y === 0) return { x: 0, y: 0 };
      y--;
      x = L[y].length - 1;
      if (!L[y].length) return { x: 0, y };
    }
    const k = c(x);
    while (x > 0 && c(x - 1) === k) x--;
    return { x, y };
  }

  // ---------- editing ----------
  operate(op, r) {
    const L = this.lines;
    if (r.line || op === '<' || op === '>') {
      const n = r.y2 - r.y1 + 1;
      const text = L.slice(r.y1, r.y2 + 1);
      if (op === 'y') {
        this.reg = { text: text.join('\n'), line: true };
        this.cy = r.y1;
        if (n > 2) this.msg = `${n} lines yanked`;
      } else if (op === 'd') {
        this.snap();
        this.reg = { text: text.join('\n'), line: true };
        L.splice(r.y1, n);
        if (!L.length) L.push('');
        this.cy = Math.min(r.y1, L.length - 1);
        this.cx = fnb(L[this.cy]);
        this.changed = true;
        if (n > 2) this.msg = `${n} fewer lines`;
      } else if (op === 'c') {
        this.snap();
        this.reg = { text: text.join('\n'), line: true };
        L.splice(r.y1, n, '');
        this.cy = r.y1;
        this.cx = 0;
        this.enterInsert(false);
      } else {
        this.snap();
        for (let y = r.y1; y <= r.y2; y++) L[y] = op === '>' ? (L[y] ? '\t' + L[y] : L[y]) : L[y].replace(/^(\t| {1,8})/, '');
        this.cy = r.y1;
        this.cx = fnb(L[r.y1]);
        this.changed = true;
        if (n > 2) this.msg = `${n} lines ${op}ed 1 time`;
      }
    } else {
      const text = r.y1 === r.y2 ? L[r.y1].slice(r.x1, r.x2) : [L[r.y1].slice(r.x1), ...L.slice(r.y1 + 1, r.y2), L[r.y2].slice(0, r.x2)].join('\n');
      if (op === 'y') {
        this.reg = { text, line: false };
        this.cy = r.y1;
        this.cx = r.x1;
      } else {
        if (!text && op === 'd') { this.op = null; return; }
        this.snap();
        this.reg = { text, line: false };
        L.splice(r.y1, r.y2 - r.y1 + 1, L[r.y1].slice(0, r.x1) + L[r.y2].slice(r.x2));
        this.cy = r.y1;
        this.cx = r.x1;
        this.changed = true;
        if (op === 'c') this.enterInsert(false);
      }
    }
    this.want = this.cx;
    this.op = null;
    this.opCount = '';
  }

  paste(after, N) {
    const { text, line } = this.reg;
    if (!text && !line) return;
    this.snap();
    const L = this.lines;
    if (line) {
      const ins = [];
      for (let i = 0; i < N; i++) ins.push(...text.split('\n'));
      const at = after ? this.cy + 1 : this.cy;
      L.splice(at, 0, ...ins);
      this.cy = at;
      this.cx = fnb(L[at]);
      if (ins.length > 2) this.msg = `${ins.length} more lines`;
    } else {
      const t = text.repeat(N);
      const l = L[this.cy];
      const at = after && l.length ? this.cx + 1 : this.cx;
      const parts = (l.slice(0, at) + t + l.slice(at)).split('\n');
      L.splice(this.cy, 1, ...parts);
      this.cx = parts.length === 1 ? at + t.length - 1 : at;
    }
    this.changed = true;
  }

  doUndo() {
    const s = this.undo.pop();
    if (!s) { this.msg = 'Already at oldest change'; return; }
    this.redo.push({ lines: this.lines.slice(), cx: this.cx, cy: this.cy });
    this.lines = s.lines;
    this.cx = s.cx;
    this.cy = s.cy;
    this.msg = `1 change; before #${this.undo.length + 1}`;
  }

  doRedo() {
    const s = this.redo.pop();
    if (!s) { this.msg = 'Already at newest change'; return; }
    this.undo.push({ lines: this.lines.slice(), cx: this.cx, cy: this.cy });
    this.lines = s.lines;
    this.cx = s.cx;
    this.cy = s.cy;
    this.msg = `1 change; after #${this.undo.length}`;
  }

  // ---------- search ----------
  setSearch(pat) {
    this.searchText = pat;
    this.search = toRegex(pat, { icase: this.opt.ignorecase, flags: 'g' }) || toRegex(pat, { fixed: true, icase: this.opt.ignorecase, flags: 'g' });
  }

  doSearch(text) {
    if (text) this.setSearch(text);
    if (!this.search) return this.fail('E35: No previous regular expression');
    this.emit('search', { pat: this.searchText });
    const p = this.findNext(this.searchDir);
    if (!p) return this.fail(`E486: Pattern not found: ${this.searchText}`);
    this.hl = true;
    this.cy = p.y;
    this.cx = p.x;
    this.want = p.x;
  }

  findNext(dir) {
    const L = this.lines;
    const n = L.length;
    const matches = y => { this.search.lastIndex = 0; return [...L[y].matchAll(this.search)].filter(m => m[0].length || !L[y].length).map(m => m.index); };
    for (let step = 0; step <= n; step++) {
      const y = (((this.cy + dir * step) % n) + n) % n;
      let xs = matches(y);
      if (step === 0) xs = xs.filter(x => (dir > 0 ? x > this.cx : x < this.cx));
      if (step === n) xs = xs.filter(x => (dir > 0 ? x <= this.cx : x >= this.cx));
      if (!xs.length) continue;
      const wrapped = dir > 0 ? y < this.cy || step === n : y > this.cy || step === n;
      if (wrapped) { this.msg = dir > 0 ? 'search hit BOTTOM, continuing at TOP' : 'search hit TOP, continuing at BOTTOM'; this.err = true; }
      return { x: dir > 0 ? xs[0] : xs[xs.length - 1], y };
    }
    return null;
  }

  // ---------- : commands ----------
  ex(raw) {
    let s = raw.trim();
    this.emit('ex', { cmd: s });
    if (!s) return;
    const L = this.lines;
    const last = L.length - 1;
    let r = null;
    let m;
    if (s.startsWith('%')) { r = [0, last]; s = s.slice(1); }
    else if (s.startsWith("'<,'>")) { r = this.lastVis ? [this.lastVis.y1, Math.min(last, this.lastVis.y2)] : [this.cy, this.cy]; s = s.slice(5); }
    else if ((m = s.match(/^(\d+|\.|\$)(?:,(\d+|\.|\$))?/))) {
      const cv = v => (v === '.' ? this.cy : v === '$' ? last : Math.min(last, Math.max(0, +v - 1)));
      r = [cv(m[1]), cv(m[2] ?? m[1])];
      s = s.slice(m[0].length);
    }
    s = s.trim();
    if (!s) { if (r) { this.cy = r[1]; this.cx = fnb(L[this.cy]); } return; }
    if (/^s[^a-zA-Z0-9\s"|]/.test(s)) return this.subst(s, r || [this.cy, this.cy]);
    m = s.match(/^([a-zA-Z]+)(!?)\s*(.*)$/);
    if (!m) return this.fail(`E492: Not an editor command: ${raw}`);
    const [, name, bang, arg] = m;
    switch (name) {
      case 'w': case 'write': case 'wa': case 'wall': this.save(arg, bang); return;
      case 'q': case 'quit': case 'qa': case 'qall': this.quit(bang); return;
      case 'wq': case 'wqa': case 'wqall': case 'xa': case 'xall': if (this.save(arg, bang)) this.quit('!'); return;
      case 'x': case 'xit': case 'exit': if (!this.dirty && !arg ? true : this.save(arg, bang)) this.quit('!'); return;
      case 'e': case 'edit':
        if (arg) return this.fail('E: opening another file is not part of this trainer; quit and run vi again');
        if (this.dirty && !bang) return this.fail('E37: No write since last change (add ! to override)');
        this.lines = this.saved.split('\n');
        return;
      case 'set': case 'se': this.setOpt(arg); return;
      case 'noh': case 'nohl': case 'nohlsearch': this.hl = false; return;
      case 'd': case 'delete': { const [a, b] = r || [this.cy, this.cy]; this.operate('d', { line: true, y1: a, y2: b }); return; }
      case 'y': case 'yank': { const [a, b] = r || [this.cy, this.cy]; this.operate('y', { line: true, y1: a, y2: b }); return; }
      case 'u': case 'undo': this.doUndo(); return;
      case 'red': case 'redo': this.doRedo(); return;
      case 'h': case 'help': this.msg = 'Help: Esc returns to Normal mode, :q quits. The Reference panel lists the vi keys.'; return;
      case 'syntax': case 'syn': case 'colorscheme': case 'filetype': return;
      case 'sp': case 'split': case 'vs': case 'vsplit': case 'tabnew': case 'tabe': return this.fail('E: windows and tabs are not part of this trainer');
      default: return this.fail(`E492: Not an editor command: ${raw}`);
    }
  }

  save(arg, bang) {
    const name = arg || this.name;
    if (!name) return this.fail('E32: No file name');
    if (this.readonly && !bang && !arg) return this.fail("E45: 'readonly' option is set (add ! to override)");
    const L = this.lines;
    const empty = L.length === 1 && L[0] === '';
    const text = empty ? '' : L.join('\n') + '\n';
    const err = this.write(name, text);
    if (err) return this.fail(err === 'EISDIR' ? `E17: "${name}" is a directory` : err === 'ENOENT' ? `E212: Can't open file for writing` : `E212: Can't open file for writing`);
    const wasNew = this.isNew || name !== this.name;
    if (!this.name) this.name = name;
    if (name === this.name) { this.saved = L.join('\n'); this.isNew = false; }
    this.msg = `"${name}" ${wasNew ? '[New] ' : ''}${empty ? 0 : L.length}L, ${byteLen(text)}B written`;
    this.emit('write', { name });
    return true;
  }

  quit(bang) {
    if (this.dirty && !bang) return this.fail('E37: No write since last change (add ! to override)');
    this.done = true;
    this.emit('quit', { saved: !this.dirty });
    return true;
  }

  setOpt(arg) {
    const ignore = /^(no)?(et|expandtab|ai|autoindent|si|smartindent|wrap|ruler|ru|showcmd|sc|showmode|smd|is|incsearch|scs|smartcase|cul|cursorline|list|paste|compatible|cp|mouse|ts|tabstop|sw|shiftwidth|sts|softtabstop|bg|background|encoding|enc|ff|fileformat|tw|textwidth)(=.*)?$/;
    for (const w of arg.split(/\s+/).filter(Boolean)) {
      const m = w.match(/^(no)?([a-z]+)(!?)$/);
      const key = m && { nu: 'number', number: 'number', rnu: 'relativenumber', relativenumber: 'relativenumber', hls: 'hlsearch', hlsearch: 'hlsearch', ic: 'ignorecase', ignorecase: 'ignorecase' }[m[2]];
      if (key) {
        this.opt[key] = m[3] ? !this.opt[key] : !m[1];
        if (key === 'hlsearch') this.hl = this.opt.hlsearch;
        if (key === 'ignorecase' && this.searchText) this.setSearch(this.searchText);
      } else if (!ignore.test(w)) return this.fail(`E518: Unknown option: ${w}`);
    }
  }

  subst(s, r) {
    const d = s[1];
    const parts = [];
    let cur = '';
    let j = 2;
    for (; j < s.length && parts.length < 2; j++) {
      if (s[j] === '\\' && j + 1 < s.length) { cur += s[j + 1] === d ? d : '\\' + s[j + 1]; j++; }
      else if (s[j] === d) { parts.push(cur); cur = ''; }
      else cur += s[j];
    }
    if (parts.length < 2) { parts.push(cur); cur = ''; }
    if (parts.length < 2) parts.push('');
    const flags = parts.length === 2 && j >= s.length ? cur : s.slice(j);
    const pat = parts[0] || this.searchText;
    if (!pat) return this.fail('E35: No previous regular expression');
    const re = toRegex(pat, { icase: this.opt.ignorecase || flags.includes('i'), flags: flags.includes('g') ? 'g' : '' });
    if (!re) return this.fail(`E486: Pattern not found: ${pat}`);
    const rep = parts[1].replace(/\$/g, '$$$$').replace(/\\([1-9])/g, '$$$1').replace(/(^|[^\\])&/g, '$1$$&').replace(/\\&/g, '&').replace(/\\[rn]/g, '\n');
    this.setSearch(pat);
    const L = this.lines;
    let subs = 0, linesHit = 0, lastY = -1;
    const next = L.slice();
    for (let y = r[0]; y <= r[1]; y++) {
      const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
      const n = (L[y].match(g) || []).length;
      if (!n) continue;
      subs += re.flags.includes('g') ? n : 1;
      linesHit++;
      lastY = y;
      next[y] = L[y].replace(re, rep);
    }
    if (!subs) return this.fail(`E486: Pattern not found: ${pat}`);
    this.snap();
    this.lines = next.flatMap(l => l.split('\n'));
    this.cy = lastY;
    this.cx = fnb(this.lines[Math.min(lastY, this.lines.length - 1)]);
    this.changed = true;
    if (linesHit > 2) this.msg = `${subs} substitution${subs === 1 ? '' : 's'} on ${linesHit} line${linesHit === 1 ? '' : 's'}`;
    this.emit('subst', { subs, lines: linesHit });
  }

  // ---------- drawing ----------
  render() {
    const { rows, cols } = this;
    const textRows = Math.max(1, rows - 1);
    const L = this.lines;
    this.clamp();
    if (this.cy < this.top) this.top = this.cy;
    if (this.cy >= this.top + textRows) this.top = this.cy - textRows + 1;
    const numbered = this.opt.number || this.opt.relativenumber;
    const gut = numbered ? Math.max(4, String(L.length).length + 1) : 0;
    const width = Math.max(1, cols - gut);
    const cur = expand(L[this.cy]);
    const curCol = cur.map[Math.min(this.cx, L[this.cy].length)];
    if (curCol < this.left) this.left = curCol;
    if (curCol >= this.left + width) this.left = curCol - width + 1;
    const sel = this.selection();
    const out = [];
    for (let i = 0; i < textRows; i++) {
      const y = this.top + i;
      if (y >= L.length) { out.push({ text: '~', spans: [{ a: 0, b: 1, cls: 'c4' }] }); continue; }
      const { text, map } = expand(L[y]);
      const col = c => Math.max(gut, Math.min(cols, gut + c - this.left));
      let spans = [];
      if (this.hl && this.opt.hlsearch && this.search) {
        this.search.lastIndex = 0;
        for (const m of L[y].matchAll(this.search)) if (m[0]) spans.push({ a: col(map[m.index]), b: col(map[m.index + m[0].length]), cls: 'hl' });
      }
      if (sel && y >= sel.y1 && y <= sel.y2) {
        const a = sel.line || y > sel.y1 ? 0 : sel.x1;
        const b = sel.line || y < sel.y2 ? L[y].length : Math.min(L[y].length, sel.x2 + 1);
        spans = [{ a: col(map[a]), b: Math.max(col(map[b]), col(map[a]) + 1), cls: 'sel' }];
      }
      let num = '';
      if (gut) {
        const n = this.opt.relativenumber && y !== this.cy ? Math.abs(y - this.cy) : y + 1;
        num = String(n).padStart(gut - 1) + ' ';
        spans.unshift({ a: 0, b: gut, cls: 'c3' });
      }
      out.push({ text: num + text.slice(this.left, this.left + width), spans: spans.filter(sp => sp.b > sp.a) });
    }
    if (this.pristine && rows > 12) {
      const intro = ['VIM - Vi IMproved', '', 'version 9.1', 'by Bram Moolenaar et al.', 'Vim is open source and freely distributable', '', 'type  :q<Enter>               to exit         ', 'type  :help<Enter>  or  <F1>  for on-line help', 'type  :help version9<Enter>   for version info'];
      const start = Math.max(1, Math.floor((textRows - intro.length) / 2));
      intro.forEach((t, i) => {
        const pad = Math.max(1, Math.floor((cols - t.length) / 2));
        if (start + i < textRows) out[start + i] = { text: '~' + ' '.repeat(pad - 1) + t, spans: [{ a: 0, b: 1, cls: 'c4' }] };
      });
    }
    let status;
    let cursor;
    if (this.mode === 'cmd' || this.mode === 'search') {
      const pfx = this.mode === 'cmd' ? ':' : this.searchDir > 0 ? '/' : '?';
      status = { text: pfx + this.cmd, spans: [] };
      cursor = { r: rows - 1, c: 1 + this.cmd.length };
    } else {
      const spans = [];
      let left = this.msg;
      if (!left) {
        left = { insert: '-- INSERT --', replace: '-- REPLACE --', visual: '-- VISUAL --', vline: '-- VISUAL LINE --' }[this.mode] || '';
        if (left) spans.push({ a: 0, b: left.length, cls: 'bold' });
      } else if (this.err) spans.push({ a: 0, b: Math.min(cols, left.length), cls: 'err' });
      let text = left;
      if (cols >= 50) {
        const pend = (this.opCount || '') + (this.op || '') + this.count + (this.wait ? ({ g: 'g', find: this.wait.k, r: 'r', obj: this.wait.kind, Z: 'Z', z: 'z' }[this.wait.type] || '') : '');
        const pos = L.length <= textRows ? 'All' : this.top === 0 ? 'Top' : this.top + textRows >= L.length ? 'Bot' : Math.round((this.top / Math.max(1, L.length - textRows)) * 100) + '%';
        const ruler = `${this.cy + 1},${L[this.cy].length ? this.cx + 1 : '0-1'}`.padEnd(14) + pos;
        const at = cols - 18;
        text = left.slice(0, at - 12).padEnd(at - 11) + pend.padEnd(11) + ruler;
      }
      status = { text: text.slice(0, cols), spans };
      cursor = { r: this.cy - this.top, c: gut + curCol - this.left };
    }
    out.push(status);
    return { lines: out, cursor };
  }

  // What the trainer's helper strip shows for the current mode.
  help() {
    switch (this.mode) {
      case 'insert': return { mode: 'INSERT mode', hint: 'What you type goes into the file.', keys: [['Esc', 'back to Normal mode']] };
      case 'replace': return { mode: 'REPLACE mode', hint: 'What you type overwrites the text.', keys: [['Esc', 'back to Normal mode']] };
      case 'visual': case 'vline': return { mode: 'VISUAL mode', hint: 'Move the cursor to grow the selection.', keys: [['d', 'delete'], ['y', 'copy'], ['c', 'change'], ['>', 'indent'], ['Esc', 'cancel']] };
      case 'cmd': return { mode: 'Command line', hint: 'Type a command, then Enter.', keys: [['w', 'save'], ['q', 'quit'], ['wq', 'save and quit'], ['q!', 'quit without saving'], ['Esc', 'cancel']] };
      case 'search': return { mode: 'Search', hint: 'Type the text to find, then Enter.', keys: [['n', 'next match'], ['N', 'previous'], ['Esc', 'cancel']] };
      default: return { mode: 'NORMAL mode', hint: 'Keys are commands here, not text.', keys: [['i', 'insert text'], ['h j k l', 'move'], ['x', 'delete char'], ['dd', 'delete line'], ['u', 'undo'], [':w', 'save'], [':q', 'quit']] };
    }
  }
}
