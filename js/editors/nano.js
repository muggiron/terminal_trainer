// A small GNU nano: type directly, shortcuts are listed at the bottom (^ means Ctrl).

import { expand } from './vi.js';

const isChar = k => k.length === 1 || (k.length === 2 && k.codePointAt(0) > 0xffff);

export class Nano {
  constructor({ text = '', name = '', isNew = false, write = null, emit = null } = {}) {
    this.name = name;
    this.write = write || (() => null);
    this.emit = emit || (() => {});
    this.lines = text.split('\n');
    if (text.endsWith('\n')) this.lines.pop();
    if (!this.lines.length) this.lines = [''];
    this.cx = 0; this.cy = 0; this.top = 0;
    this.rows = 24; this.cols = 80;
    this.cut = []; this.lastWasCut = false;
    this.modified = false;
    this.prompt = null;
    this.lastSearch = '';
    this.done = false;
    this.msg = name ? (isNew ? 'New File' : `Read ${this.lines.length} line${this.lines.length === 1 ? '' : 's'}`) : 'Welcome to nano.  For basic help, type Ctrl+G.';
  }

  get text() { return this.lines.join('\n'); }
  resize(rows, cols) { this.rows = rows; this.cols = cols; }

  save(name, quitAfter) {
    if (!name) { this.msg = 'Cancelled'; return; }
    const err = this.write(name, this.lines.join('\n') + '\n');
    if (err) {
      this.msg = `Error writing ${name}: ${{ EACCES: 'Permission denied', EISDIR: 'Is a directory', ENOENT: 'No such file or directory' }[err] || err}`;
      this.emit('error', { code: err, msg: this.msg });
      return;
    }
    this.name = name;
    this.modified = false;
    this.msg = `Wrote ${this.lines.length} line${this.lines.length === 1 ? '' : 's'}`;
    this.emit('write', { name });
    if (quitAfter) this.quit();
  }

  quit() {
    this.done = true;
    this.emit('quit', { saved: !this.modified });
  }

  key(k) {
    const L = this.lines;
    const cutNow = this.lastWasCut;
    this.lastWasCut = false;
    if (this.prompt) { this.kPrompt(k); this.emit('key', { key: k }); return; }
    this.msg = '';
    const l = L[this.cy];
    switch (k) {
      case 'C-x': if (this.modified) this.prompt = { type: 'exit' }; else this.quit(); break;
      case 'C-o': this.prompt = { type: 'name', text: this.name, quit: false }; break;
      case 'C-s': if (this.name) this.save(this.name, false); else this.prompt = { type: 'name', text: '', quit: false }; break;
      case 'C-w': this.prompt = { type: 'search', text: '' }; break;
      case 'C-g': this.msg = 'Ctrl+O saves, Ctrl+X exits, Ctrl+W searches, Ctrl+K cuts a line, Ctrl+U pastes'; break;
      case 'C-c': this.msg = `line ${this.cy + 1}/${L.length} (${Math.round(((this.cy + 1) / L.length) * 100)}%), col ${this.cx + 1}/${l.length + 1}`; break;
      case 'C-k':
        if (!cutNow) this.cut = [];
        this.cut.push(l);
        if (L.length > 1) L.splice(this.cy, 1); else L[0] = '';
        this.cx = 0;
        this.modified = true;
        this.lastWasCut = true;
        break;
      case 'C-u':
        if (this.cut.length) { L.splice(this.cy, 0, ...this.cut); this.cy += this.cut.length; this.cx = 0; this.modified = true; }
        break;
      case 'Enter': L.splice(this.cy, 1, l.slice(0, this.cx), l.slice(this.cx)); this.cy++; this.cx = 0; this.modified = true; break;
      case 'Backspace':
        if (this.cx > 0) { L[this.cy] = l.slice(0, this.cx - 1) + l.slice(this.cx); this.cx--; this.modified = true; }
        else if (this.cy > 0) { this.cx = L[this.cy - 1].length; L.splice(this.cy - 1, 2, L[this.cy - 1] + l); this.cy--; this.modified = true; }
        break;
      case 'Delete': case 'C-d':
        if (this.cx < l.length) { L[this.cy] = l.slice(0, this.cx) + l.slice(this.cx + 1); this.modified = true; }
        else if (this.cy < L.length - 1) { L.splice(this.cy, 2, l + L[this.cy + 1]); this.modified = true; }
        break;
      case 'ArrowLeft': case 'C-b': if (this.cx > 0) this.cx--; else if (this.cy > 0) { this.cy--; this.cx = L[this.cy].length; } break;
      case 'ArrowRight': case 'C-f': if (this.cx < l.length) this.cx++; else if (this.cy < L.length - 1) { this.cy++; this.cx = 0; } break;
      case 'ArrowUp': case 'C-p': this.cy--; break;
      case 'ArrowDown': case 'C-n': this.cy++; break;
      case 'Home': case 'C-a': this.cx = 0; break;
      case 'End': case 'C-e': this.cx = l.length; break;
      case 'PageUp': case 'C-y': this.cy -= Math.max(1, this.rows - 5); break;
      case 'PageDown': case 'C-v': this.cy += Math.max(1, this.rows - 5); break;
      default:
        if (k === 'Tab') k = '    ';
        if (isChar(k) || k === '    ') { L[this.cy] = l.slice(0, this.cx) + k + l.slice(this.cx); this.cx += k.length; this.modified = true; }
    }
    this.cy = Math.max(0, Math.min(L.length - 1, this.cy));
    this.cx = Math.max(0, Math.min(L[this.cy].length, this.cx));
    this.emit('key', { key: k });
  }

  kPrompt(k) {
    const p = this.prompt;
    if (k === 'C-c' || k === 'Escape') { this.prompt = null; this.msg = 'Cancelled'; return; }
    if (p.type === 'exit') {
      if (k === 'y' || k === 'Y') this.prompt = { type: 'name', text: this.name, quit: true };
      else if (k === 'n' || k === 'N') { this.prompt = null; this.quit(); }
      return;
    }
    if (k === 'Enter') {
      this.prompt = null;
      if (p.type === 'name') return this.save(p.text.trim(), p.quit);
      const q = p.text || this.lastSearch;
      if (!q) { this.msg = 'Cancelled'; return; }
      this.lastSearch = q;
      const L = this.lines;
      const needle = q.toLowerCase();
      for (let step = 0; step <= L.length; step++) {
        const y = (this.cy + step) % L.length;
        const from = step === 0 ? this.cx + 1 : 0;
        const x = L[y].toLowerCase().indexOf(needle, from);
        if (x >= 0 && !(step === L.length && x > this.cx)) { this.cy = y; this.cx = x; if (step && y <= this.cy && step === L.length) this.msg = 'Search Wrapped'; return; }
      }
      this.msg = `"${q}" not found`;
      return;
    }
    if (k === 'Backspace') p.text = p.text.slice(0, -1);
    else if (isChar(k)) p.text += k;
  }

  render() {
    const { rows, cols } = this;
    const textRows = Math.max(1, rows - 4);
    const L = this.lines;
    if (this.cy < this.top) this.top = this.cy;
    if (this.cy >= this.top + textRows) this.top = this.cy - textRows + 1;
    const out = [];
    const name = this.name || 'New Buffer';
    const leftT = '  GNU nano 7.2';
    const pad = Math.max(1, Math.floor((cols - name.length) / 2) - leftT.length);
    let title = leftT + ' '.repeat(pad) + name;
    title = (title.padEnd(cols - 10) + (this.modified ? 'Modified' : '')).padEnd(cols).slice(0, cols);
    out.push({ text: title, spans: [{ a: 0, b: cols, cls: 'inv' }] });
    const cur = expand(L[this.cy]);
    const ccol = cur.map[this.cx];
    const left = ccol >= cols - 1 ? ccol - cols + 2 : 0;
    for (let i = 0; i < textRows; i++) {
      const y = this.top + i;
      out.push({ text: y < L.length ? expand(L[y]).text.slice(y === this.cy ? left : 0, (y === this.cy ? left : 0) + cols) : '', spans: [] });
    }
    let cursor = { r: 1 + this.cy - this.top, c: ccol - left };
    const p = this.prompt;
    if (p) {
      const label = p.type === 'exit' ? 'Save modified buffer? ' : p.type === 'name' ? 'File Name to Write: ' : `Search${this.lastSearch ? ` [${this.lastSearch}]` : ''}: `;
      const text = label + (p.text ?? '');
      out.push({ text: text.padEnd(cols).slice(0, cols), spans: [{ a: 0, b: cols, cls: 'inv' }] });
      cursor = { r: rows - 3, c: Math.min(cols - 1, text.length) };
    } else if (this.msg) {
      const m = `[ ${this.msg} ]`;
      const a = Math.max(0, Math.floor((cols - m.length) / 2));
      out.push({ text: ' '.repeat(a) + m, spans: [{ a, b: Math.min(cols, a + m.length), cls: 'inv' }] });
    } else out.push({ text: '', spans: [] });
    const helpRows = p?.type === 'exit'
      ? [[[' Y', 'Yes']], [[' N', 'No'], ['^C', 'Cancel']]]
      : p
        ? [[['^G', 'Help']], [['^C', 'Cancel']]]
        : [[['^G', 'Help'], ['^O', 'Write Out'], ['^W', 'Where Is'], ['^K', 'Cut'], ['^C', 'Location']], [['^X', 'Exit'], ['^R', 'Read File'], ['^\\', 'Replace'], ['^U', 'Paste'], ['^/', 'Go To Line']]];
    const w = Math.max(12, Math.floor(cols / 5));
    for (const row of helpRows) {
      let text = '';
      const spans = [];
      for (const [key, label] of row) {
        if (text.length + w > cols + 2) break;
        spans.push({ a: text.length, b: text.length + 2, cls: 'inv' });
        text += (key + ' ' + label).padEnd(w);
      }
      out.push({ text: text.slice(0, cols), spans });
    }
    return { lines: out, cursor };
  }

  help() {
    if (this.prompt?.type === 'exit') return { mode: 'nano: save changes?', hint: '', keys: [['Y', 'save'], ['N', 'discard'], ['Ctrl+C', 'cancel']] };
    if (this.prompt?.type === 'name') return { mode: 'nano: file name', hint: 'Confirm or change the name.', keys: [['Enter', 'save'], ['Ctrl+C', 'cancel']] };
    if (this.prompt) return { mode: 'nano: search', hint: 'Type the text to find.', keys: [['Enter', 'find'], ['Ctrl+C', 'cancel']] };
    return { mode: 'nano', hint: 'Just type. In the bar below, ^ means Ctrl.', keys: [['Ctrl+O, Enter', 'save'], ['Ctrl+X', 'exit'], ['Ctrl+W', 'search'], ['Ctrl+K', 'cut line'], ['Ctrl+U', 'paste']] };
  }
}
