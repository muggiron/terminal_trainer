// The terminal emulator: draws output, edits the command line, keeps history,
// completes with Tab, and hands the screen to full-screen programs (vi, less, top).
//
// It implements the shell's `io` interface: write, clear, readLine, fullscreen, cols, rows.

import { Signal, needsMore } from '../shell/index.js';
import { columns } from '../shell/util.js';

const NAMED = new Set(['Enter', 'Escape', 'Backspace', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Delete', 'F6', 'F10']);
const MAX_BLOCKS = 500;

export const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Convert text with ANSI colour codes to HTML.
export function ansiHtml(text) {
  let out = '';
  let cls = [];
  const parts = text.split(/\x1b\[([0-9;]*)m/);
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) {
      if (parts[i]) out += cls.length ? `<span class="${cls.join(' ')}">${esc(parts[i])}</span>` : esc(parts[i]);
      continue;
    }
    for (const c of (parts[i] || '0').split(';').map(Number)) {
      if (c === 0) cls = [];
      else if (c === 1) cls.push('b');
      else if (c === 4) cls.push('u');
      else if (c === 7) cls.push('inv');
      else if ((c >= 30 && c <= 37) || (c >= 90 && c <= 97)) cls = cls.filter(x => x[0] !== 'f').concat('f' + (c >= 90 ? c - 82 : c - 30));
    }
  }
  return out;
}

// Map a keyboard event to a key name, or null when the key produces text.
function keyName(e) {
  const key = e.key;
  if (e.metaKey) return null; // leave Cmd+C, Cmd+V, Cmd+R ... to the browser
  if (e.ctrlKey && !e.altKey) {
    if (e.shiftKey && /^[cv]$/i.test(key)) return null; // Ctrl+Shift+C / V: copy and paste
    if (key.length === 1) return 'C-' + key.toLowerCase();
    return NAMED.has(key) ? key : null;
  }
  if (e.altKey) {
    // Option/Alt combinations type characters on many keyboard layouts (| @ ~ [ ] on a German Mac),
    // so only the classic word-movement keys are treated as shortcuts.
    if (e.code === 'KeyB' || key === 'ArrowLeft') return 'M-b';
    if (e.code === 'KeyF' || key === 'ArrowRight') return 'M-f';
    if (e.code === 'KeyD') return 'M-d';
    if (key === 'Backspace') return 'M-Backspace';
    return null;
  }
  return NAMED.has(key) ? key : null;
}

// One row of a full-screen program: text plus styled spans and the cursor.
function rowHtml(line, cursorCol) {
  const text = typeof line === 'string' ? line : line.text;
  const spans = typeof line === 'string' ? [] : line.spans || [];
  const len = Math.max(text.length, cursorCol + 1);
  if (!spans.length && cursorCol < 0) return esc(text);
  const cls = new Array(len).fill('');
  for (const sp of spans) for (let i = Math.max(0, sp.a); i < Math.min(len, sp.b); i++) cls[i] = cls[i] ? cls[i] + ' ' + sp.cls : sp.cls;
  if (cursorCol >= 0) cls[cursorCol] = cls[cursorCol] ? cls[cursorCol] + ' cursor' : 'cursor';
  const padded = text.padEnd(len);
  let out = '';
  for (let i = 0; i < len;) {
    let j = i + 1;
    while (j < len && cls[j] === cls[i]) j++;
    const chunk = esc(padded.slice(i, j));
    out += cls[i] ? `<span class="${cls[i]}">${chunk}</span>` : chunk;
    i = j;
  }
  return out;
}

export class Terminal {
  constructor(root, { onKey = () => {}, onLine = null, onAssist = () => {}, onPrompt = () => {} } = {}) {
    this.root = root;
    this.body = root.querySelector('.term-body');
    this.scrollEl = root.querySelector('.term-scroll');
    this.fullEl = root.querySelector('.term-full');
    this.ta = root.querySelector('.term-input');
    this.onKey = onKey;
    this.onLine = onLine;
    this.onAssist = onAssist;
    this.onPrompt = onPrompt;
    this.cols = 80;
    this.rows = 24;
    this.mode = 'idle'; // idle | line | busy | read | search | full
    this.buf = '';
    this.pos = 0;
    this.pending = '';
    this.hist = null;
    this.draft = '';
    this.killed = '';
    this.gen = 0;
    this.probe = document.createElement('span');
    this.probe.className = 'term-probe';
    this.probe.textContent = 'MMMMMMMMMM';
    this.body.append(this.probe);
    this.bind();
    this.measure();
  }

  bind() {
    const ta = this.ta;
    ta.addEventListener('keydown', e => {
      if (e.isComposing) return;
      const k = keyName(e);
      if (!k || (k === 'Tab' && e.shiftKey)) return;
      if (this.handleKey(k) !== false) e.preventDefault();
    });
    ta.addEventListener('compositionstart', () => { this.composing = true; });
    ta.addEventListener('compositionend', () => { this.composing = false; this.takeInput(); });
    ta.addEventListener('input', () => this.takeInput());
    ta.addEventListener('beforeinput', e => {
      // touch keyboards do not send reliable keydown events
      if (e.inputType === 'deleteContentBackward' && !ta.value) { e.preventDefault(); this.handleKey('Backspace'); }
      else if (e.inputType === 'insertLineBreak') { e.preventDefault(); this.handleKey('Enter'); }
    });
    ta.addEventListener('focus', () => this.root.classList.add('focused'));
    ta.addEventListener('blur', () => this.root.classList.remove('focused'));
    this.body.addEventListener('click', () => { if (String(getSelection()) === '') this.focus(); });
    this.root.querySelector('.term-keys')?.addEventListener('click', e => {
      const k = e.target.closest('button')?.dataset.key;
      if (k) { this.handleKey(k); this.focus(); }
    });
    new ResizeObserver(() => this.measure()).observe(this.body);
  }

  focus() { this.ta.focus({ preventScroll: true }); }

  measure() {
    const r = this.probe.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const cs = getComputedStyle(this.body);
    const w = this.body.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const h = this.body.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const cols = Math.max(20, Math.floor(w / (r.width / 10)));
    const rows = Math.max(6, Math.floor(h / r.height));
    if (cols === this.cols && rows === this.rows) return;
    this.cols = cols;
    this.rows = rows;
    if (this.app) { this.app.resize(rows, cols); this.draw(); }
    if (this.sh) this.onPrompt(this.sh);
  }

  // ---------- session ----------
  // Drop everything that is running and clear the screen.
  reset() {
    this.gen++;
    if (this.app) { clearInterval(this.appTimer); this.app = null; this.fullEl.hidden = true; this.scrollEl.hidden = false; this.appDone?.(); }
    if (this.readRes) { const r = this.readRes; this.readRes = null; r.reject(new Signal('INT')); }
    this.sh?.signal('INT');
    this.scrollEl.replaceChildren();
    this.out = null;
    this.lineEl = null;
    this.belowEl = null;
    this.pending = '';
    this.lastChar = '';
    this.mode = 'idle';
    this.onAssist(null);
  }

  // Attach a shell and show its first prompt.
  start(sh, banner = '') {
    this.sh = sh;
    sh.io = this;
    if (banner) this.banner(banner);
    this.newPrompt();
  }

  // Swap the shell without clearing the screen (used between review questions).
  swap(sh) {
    this.sh = sh;
    sh.io = this;
  }

  // Replace the current, still empty prompt with a fresh one (after the shell was swapped).
  refreshPrompt() {
    if (this.mode !== 'line') return;
    this.freezeLine();
    this.newPrompt();
  }

  // Let the app finish async work (for example preparing the next question) before the next prompt.
  defer(promise) { this.deferred = promise; }

  // ---------- output ----------
  write(s) {
    if (!s) return;
    if (!this.out) {
      this.out = document.createElement('div');
      this.out.className = 'out';
      this.scrollEl.append(this.out);
      this.trim();
    }
    this.out.insertAdjacentHTML('beforeend', ansiHtml(s));
    this.lastChar = s[s.length - 1];
    this.toBottom();
  }

  clear() {
    this.scrollEl.replaceChildren();
    this.out = null;
    this.lastChar = '';
  }

  banner(text) {
    const el = document.createElement('div');
    el.className = 'banner';
    el.textContent = text;
    this.scrollEl.append(el);
    this.out = null;
  }

  // A message from the trainer (not from the simulated system), shown in the output stream.
  note(kind, tag, html) {
    const el = document.createElement('div');
    el.className = `note note-${kind}`;
    el.setAttribute('role', 'note');
    el.innerHTML = `<span class="note-tag">${esc(tag)}</span>${html}`;
    if (this.lineEl && (this.mode === 'line' || this.mode === 'search')) this.lineEl.before(el);
    else { this.scrollEl.append(el); this.out = null; this.lastChar = ''; }
    this.trim();
    this.toBottom();
  }

  trim() {
    while (this.scrollEl.childElementCount > MAX_BLOCKS) this.scrollEl.firstElementChild.remove();
  }

  toBottom() { this.scrollEl.scrollTop = this.scrollEl.scrollHeight; }

  flash() {
    this.body.classList.remove('flash');
    void this.body.offsetWidth;
    this.body.classList.add('flash');
  }

  // ---------- the command line ----------
  newPrompt() {
    const sh = this.sh;
    const done = sh.reap();
    if (done) this.write(done);
    if (this.lastChar && this.lastChar !== '\n') this.write(sh.zsh ? '\x1b[7m%\x1b[0m\n' : '\n');
    this.beginLine(ansiHtml(this.pending ? sh.prompt2(this.pendKind) : sh.prompt()), 'line');
    this.onPrompt(sh);
  }

  beginLine(promptHtml, mode, { hidden = false } = {}) {
    this.out = null;
    this.lastChar = '';
    this.lineEl = document.createElement('div');
    this.lineEl.className = 'line';
    this.lineEl.innerHTML = `<span class="prompt">${promptHtml}</span><span class="in"></span>`;
    this.promptHtml = promptHtml;
    this.scrollEl.append(this.lineEl);
    this.buf = '';
    this.pos = 0;
    this.hidden = hidden;
    this.mode = mode;
    this.renderLine();
    this.trim();
    this.toBottom();
  }

  renderLine(cursor = true) {
    if (!this.lineEl) return;
    const inEl = this.lineEl.lastElementChild;
    const promptEl = this.lineEl.firstElementChild;
    let text = this.buf;
    let pos = this.pos;
    if (this.mode === 'search') {
      const s = this.search;
      text = s.match ?? s.saved;
      pos = text.length;
      if (this.sh.zsh) this.setBelow(`${s.failed ? 'failing ' : ''}bck-i-search: ${s.q}_`);
      else promptEl.textContent = `(${s.failed ? 'failed ' : ''}reverse-i-search)\`${s.q}': `;
    } else if (promptEl.innerHTML !== this.promptHtml) promptEl.innerHTML = this.promptHtml;
    if (this.hidden) text = '';
    if (!cursor) { inEl.textContent = text; return; }
    const at = this.hidden ? 0 : pos;
    inEl.innerHTML = `${esc(text.slice(0, at))}<span class="cursor">${esc(text[at] ?? ' ')}</span>${esc(text.slice(at + 1))}`;
    this.toBottom();
  }

  freezeLine(suffix = '') {
    if (!this.lineEl) return;
    this.renderLine(false);
    if (suffix) this.lineEl.lastElementChild.append(suffix);
    this.lineEl = null;
    this.clearBelow();
  }

  setBelow(text) {
    if (!this.belowEl || !this.belowEl.isConnected) {
      this.belowEl = document.createElement('div');
      this.belowEl.className = 'below';
      this.lineEl.after(this.belowEl);
    }
    this.belowEl.textContent = text;
    this.toBottom();
  }

  clearBelow() {
    this.belowEl?.remove();
    this.belowEl = null;
  }

  emit(key, extra = {}) {
    this.onKey({ type: 'key', key, sh: this.sh, ...extra });
  }

  insert(text) {
    this.buf = this.buf.slice(0, this.pos) + text + this.buf.slice(this.pos);
    this.pos += text.length;
    this.renderLine();
  }

  takeInput() {
    if (this.composing) return;
    const text = this.ta.value;
    this.ta.value = '';
    if (text) this.type(text);
  }

  // Text typed or pasted by the user.
  type(text) {
    if (this.mode === 'full') {
      for (const ch of text) {
        if (!this.app) break;
        this.appKey(ch === '\n' ? 'Enter' : ch);
      }
      return;
    }
    text = text.replace(/\r?\n$/, '').replace(/\r?\n/g, ' ');
    if (this.mode === 'search') { this.search.q += text; this.runSearch(this.sh.history.length - 1); return; }
    if (this.mode !== 'line' && this.mode !== 'read') return;
    this.clearBelow();
    this.insert(text);
  }

  handleKey(k) {
    switch (this.mode) {
      case 'full':
        if (k === 'F6') return false;
        this.appKey(k);
        return true;
      case 'busy':
        if (k === 'C-c') { this.write('^C\n'); this.sh.signal('INT'); this.emit('ctrl-c', { running: true }); return true; }
        if (k === 'C-z') { this.write('^Z\n'); this.sh.signal('TSTP'); this.emit('ctrl-z'); return true; }
        return !k.startsWith('C-') && k !== 'F6';
      case 'read': return this.readKey(k);
      case 'search': return this.searchKey(k);
      case 'line': return this.lineKey(k);
      default: return false;
    }
  }

  wordLeft(p) { const b = this.buf; while (p > 0 && /\s/.test(b[p - 1])) p--; while (p > 0 && !/\s/.test(b[p - 1])) p--; return p; }
  wordRight(p) { const b = this.buf; while (p < b.length && /\s/.test(b[p])) p++; while (p < b.length && !/\s/.test(b[p])) p++; return p; }
  cut(a, b) { this.killed = this.buf.slice(a, b); this.buf = this.buf.slice(0, a) + this.buf.slice(b); this.pos = a; }

  // Editing keys shared by the command line and by prompts such as passwords.
  editKey(k) {
    const before = this.buf;
    switch (k) {
      case 'Backspace': if (this.pos > 0) { this.buf = this.buf.slice(0, this.pos - 1) + this.buf.slice(this.pos); this.pos--; } break;
      case 'Delete': this.buf = this.buf.slice(0, this.pos) + this.buf.slice(this.pos + 1); break;
      case 'ArrowLeft': case 'C-b': this.pos = Math.max(0, this.pos - 1); break;
      case 'ArrowRight': case 'C-f': this.pos = Math.min(this.buf.length, this.pos + 1); break;
      case 'Home': case 'C-a': this.pos = 0; this.emit('ctrl-a', { line: before }); break;
      case 'End': case 'C-e': this.pos = this.buf.length; this.emit('ctrl-e', { line: before }); break;
      case 'M-b': this.pos = this.wordLeft(this.pos); break;
      case 'M-f': this.pos = this.wordRight(this.pos); break;
      case 'C-u': if (this.sh.zsh) this.cut(0, this.buf.length); else this.cut(0, this.pos); this.emit('ctrl-u', { line: before, after: this.buf }); break;
      case 'C-k': this.cut(this.pos, this.buf.length); this.emit('ctrl-k', { line: before, after: this.buf }); break;
      case 'C-w': case 'M-Backspace': this.cut(this.wordLeft(this.pos), this.pos); this.emit('ctrl-w', { line: before, after: this.buf }); break;
      case 'M-d': this.cut(this.pos, this.wordRight(this.pos)); break;
      case 'C-y': this.insert(this.killed); break;
      default: return false;
    }
    this.renderLine();
    return true;
  }

  lineKey(k) {
    if (k !== 'Tab') { this.clearBelow(); this.lastTab = null; }
    const H = this.sh.history;
    switch (k) {
      case 'Enter': this.enter(); return true;
      case 'C-c':
        this.emit('ctrl-c', { line: this.buf, running: false });
        this.freezeLine(this.sh.zsh ? '' : '^C');
        this.pending = '';
        this.hist = null;
        this.newPrompt();
        return true;
      case 'C-d':
        if (this.buf) return this.editKey('Delete');
        this.emit('ctrl-d');
        this.buf = 'exit';
        this.enter();
        return true;
      case 'C-l': {
        const line = this.lineEl;
        this.scrollEl.replaceChildren(line);
        this.emit('ctrl-l');
        return true;
      }
      case 'ArrowUp': case 'C-p':
        if (!H.length) return true;
        if (this.hist === null) { this.draft = this.buf; this.hist = H.length; }
        this.hist = Math.max(0, this.hist - 1);
        this.buf = H[this.hist];
        this.pos = this.buf.length;
        this.renderLine();
        this.emit('up', { after: this.buf });
        return true;
      case 'ArrowDown': case 'C-n':
        if (this.hist === null) return true;
        this.hist++;
        if (this.hist >= H.length) { this.hist = null; this.buf = this.draft; } else this.buf = H[this.hist];
        this.pos = this.buf.length;
        this.renderLine();
        return true;
      case 'C-r':
        this.search = { q: '', idx: H.length, saved: this.buf, match: null, failed: false };
        this.mode = 'search';
        this.renderLine();
        this.emit('ctrl-r');
        return true;
      case 'Tab': this.tab(); return true;
      case 'Escape': return true;
      default: return this.editKey(k);
    }
  }

  async enter() {
    const text = this.buf;
    this.freezeLine();
    const full = this.pending + text;
    const kind = needsMore(full);
    if (kind) {
      this.pending = full + '\n';
      this.pendKind = kind;
      this.emit('continuation', { kind });
      this.newPrompt();
      return;
    }
    this.pending = '';
    this.hist = null;
    if (!full.trim()) { this.newPrompt(); return; }
    this.mode = 'busy';
    const gen = this.gen;
    try {
      if (!(this.onLine && (await this.onLine(full)))) await this.sh.run(full);
      if (this.deferred) { const p = this.deferred; this.deferred = null; await p; }
    } catch (e) {
      console.error(e);
      if (gen === this.gen) this.write(`trainer: ${e.message}\n`);
    }
    if (gen === this.gen && this.mode === 'busy') this.newPrompt();
  }

  // ---------- Tab completion ----------
  tab() {
    const before = this.buf;
    const r = this.sh.complete(this.buf, this.pos);
    const cands = r.cands;
    const word = this.buf.slice(r.start, this.pos);
    if (!cands.length) { this.flash(); this.emit('tab', { line: before, after: before, none: true }); return; }
    const q = r.quote;
    const escName = s => (q ? s : s.replace(/([\s'"\\$&|;<>()*?[\]#!{}`])/g, '\\$1'));
    let prefix = cands[0].prefix ?? '';
    if (q && !prefix.startsWith(q)) prefix = q + prefix;
    let text;
    let listed = false;
    if (cands.length === 1) {
      const c = cands[0];
      text = prefix + escName(c.v) + (c.dir ? '/' : (q || '') + ' ');
    } else {
      let common = cands[0].v;
      for (const c of cands) while (!c.v.startsWith(common)) common = common.slice(0, -1);
      text = prefix + escName(common);
    }
    if (text.length > word.length || cands.length === 1) {
      this.buf = this.buf.slice(0, r.start) + text + this.buf.slice(this.pos);
      this.pos = r.start + text.length;
      this.renderLine();
    } else {
      const names = cands.slice(0, 120).map(c => c.v + (c.dir ? '/' : ''));
      if (cands.length > 120) names.push('…');
      const list = columns(names, this.cols).replace(/\n$/, '');
      if (this.sh.zsh) { this.setBelow(list); listed = true; }
      else if (this.lastTab === this.buf) {
        // bash lists the choices on the second Tab and then shows the prompt again
        const [buf, pos] = [this.buf, this.pos];
        this.freezeLine();
        this.write(list + '\n');
        this.beginLine(this.promptHtml, 'line');
        this.buf = buf;
        this.pos = pos;
        this.renderLine();
        listed = true;
      } else this.flash();
      this.lastTab = this.buf;
    }
    this.emit('tab', { line: before, after: this.buf, listed, count: cands.length });
  }

  // ---------- Ctrl+R history search ----------
  runSearch(from) {
    const s = this.search;
    const H = this.sh.history;
    let found = -1;
    if (s.q) for (let i = Math.min(from, H.length - 1); i >= 0; i--) if (H[i].includes(s.q)) { found = i; break; }
    s.failed = !!s.q && found < 0;
    if (found >= 0) { s.idx = found; s.match = H[found]; }
    else if (!s.q) { s.match = null; s.idx = H.length; }
    this.renderLine();
  }

  endSearch(accept) {
    const s = this.search;
    this.mode = 'line';
    this.buf = accept ? s.match ?? s.saved : s.saved;
    this.pos = this.buf.length;
    this.clearBelow();
    this.renderLine();
  }

  searchKey(k) {
    const s = this.search;
    if (k === 'C-r') { this.runSearch(s.idx - 1); return true; }
    if (k === 'Backspace') { s.q = s.q.slice(0, -1); this.runSearch(this.sh.history.length - 1); return true; }
    if (k === 'C-c' || k === 'C-g') { this.endSearch(false); return true; }
    if (k === 'Enter') {
      const hit = s.match;
      this.endSearch(true);
      if (hit) this.emit('search-accept', { after: hit });
      this.enter();
      return true;
    }
    this.endSearch(true);
    return k === 'Escape' ? true : this.lineKey(k);
  }

  // ---------- questions asked by commands (passwords, y/n) ----------
  readLine(prompt, { hidden = false } = {}) {
    return new Promise((resolve, reject) => {
      this.readRes = { resolve, reject };
      this.beginLine(esc(prompt), 'read', { hidden });
    });
  }

  readKey(k) {
    const done = fn => { const r = this.readRes; this.readRes = null; this.mode = 'busy'; this.hidden = false; fn(r); };
    if (k === 'Enter') { const v = this.buf; this.freezeLine(); done(r => r.resolve(v)); return true; }
    if (k === 'C-d' && !this.buf) { this.freezeLine(); this.emit('ctrl-d'); done(r => r.resolve(null)); return true; }
    if (k === 'C-c') { this.freezeLine('^C'); this.emit('ctrl-c', { running: true }); done(r => r.reject(new Signal('INT'))); return true; }
    if (k === 'Tab' || k === 'Escape' || k === 'ArrowUp' || k === 'ArrowDown') return true;
    return this.editKey(k);
  }

  // ---------- full-screen programs ----------
  fullscreen(app) {
    return new Promise(resolve => {
      this.app = app;
      this.appDone = resolve;
      this.mode = 'full';
      this.scrollEl.hidden = true;
      this.fullEl.hidden = false;
      app.resize(this.rows, this.cols);
      if (app.interval) this.appTimer = setInterval(() => { app.tick(); this.draw(); }, app.interval);
      this.draw();
    });
  }

  appKey(k) {
    if (!this.app) return;
    this.app.key(k);
    if (this.app.done) this.closeApp();
    else this.draw();
  }

  closeApp() {
    clearInterval(this.appTimer);
    const done = this.appDone;
    this.app = null;
    this.appDone = null;
    this.fullEl.hidden = true;
    this.scrollEl.hidden = false;
    this.mode = 'busy';
    this.out = null;
    this.onAssist(null);
    this.toBottom();
    done();
  }

  draw() {
    const { lines, cursor } = this.app.render();
    this.fullEl.firstElementChild.innerHTML = lines.map((l, r) => rowHtml(l, cursor && cursor.r === r ? cursor.c : -1)).join('\n');
    this.onAssist(this.app.help ? this.app.help() : null, this.app);
  }
}
