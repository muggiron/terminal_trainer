// A small `less`: the pager used by less, more, man and git log.
//
// Full-screen apps share one interface with the terminal:
//   resize(rows, cols), key(name), render() -> { lines, cursor }, done, help()

const stripAnsi = s => s.replace(/\x1b\[[0-9;]*m/g, '');

export class Pager {
  constructor({ text, title = '' }) {
    const raw = stripAnsi(text).replace(/\t/g, '        ').split('\n');
    if (raw[raw.length - 1] === '') raw.pop();
    this.raw = raw;
    this.title = title;
    this.top = 0;
    this.rows = 24;
    this.cols = 80;
    this.mode = 'view';
    this.q = '';
    this.re = null;
    this.msg = '';
    this.done = false;
    this.wrap();
  }

  resize(rows, cols) {
    this.rows = rows;
    this.cols = cols;
    this.wrap();
  }

  wrap() {
    this.lines = [];
    for (const l of this.raw) {
      if (!l.length) this.lines.push('');
      else for (let i = 0; i < l.length; i += this.cols) this.lines.push(l.slice(i, i + this.cols));
    }
    this.scroll(0);
  }

  get page() { return Math.max(1, this.rows - 1); }
  get maxTop() { return Math.max(0, this.lines.length - this.page); }
  scroll(d) { this.top = Math.max(0, Math.min(this.maxTop, this.top + d)); }

  find(dir) {
    if (!this.re) { this.msg = 'No previous regular expression'; return; }
    for (let i = this.top + dir; i >= 0 && i < this.lines.length; i += dir) {
      if (this.re.test(this.lines[i])) { this.top = Math.min(i, Math.max(this.maxTop, i)); return; }
    }
    this.msg = 'Pattern not found';
  }

  key(k) {
    this.msg = '';
    if (this.mode === 'search') {
      if (k === 'Enter') {
        this.mode = 'view';
        if (this.q) {
          try { this.re = new RegExp(this.q, /[A-Z]/.test(this.q) ? '' : 'i'); } catch { this.re = new RegExp(this.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); }
        }
        this.top--;
        this.find(1);
        if (this.msg) this.top++;
      } else if (k === 'Escape' || k === 'C-c') this.mode = 'view';
      else if (k === 'Backspace') { if (this.q) this.q = this.q.slice(0, -1); else this.mode = 'view'; }
      else if (k.length === 1) this.q += k;
      return;
    }
    switch (k) {
      case 'q': case 'Q': case 'Z': this.done = true; break;
      case 'j': case 'e': case 'Enter': case 'ArrowDown': case 'C-n': case 'C-e': this.scroll(1); break;
      case 'k': case 'y': case 'ArrowUp': case 'C-p': case 'C-y': this.scroll(-1); break;
      case ' ': case 'f': case 'PageDown': case 'C-f': case 'C-v': this.scroll(this.page); break;
      case 'b': case 'PageUp': case 'C-b': this.scroll(-this.page); break;
      case 'd': case 'C-d': this.scroll(Math.ceil(this.page / 2)); break;
      case 'u': case 'C-u': this.scroll(-Math.ceil(this.page / 2)); break;
      case 'g': case '<': case 'Home': this.top = 0; break;
      case 'G': case '>': case 'End': this.top = this.maxTop; break;
      case '/': this.mode = 'search'; this.q = ''; break;
      case 'n': this.find(1); break;
      case 'N': this.find(-1); break;
      case 'h': case 'H': this.msg = 'Space: next page   b: back   /text: search   n: next match   q: quit'; break;
      case 'C-c': this.msg = 'Press q to quit'; break;
      default:
    }
  }

  render() {
    const lines = [];
    for (let i = 0; i < this.page; i++) {
      const text = this.lines[this.top + i];
      if (text === undefined) { lines.push({ text: '~', spans: [{ a: 0, b: 1, cls: 'dim' }] }); continue; }
      const spans = [];
      if (this.re) {
        const g = new RegExp(this.re.source, this.re.flags + 'g');
        for (const m of text.matchAll(g)) if (m[0]) spans.push({ a: m.index, b: m.index + m[0].length, cls: 'inv' });
      }
      lines.push({ text, spans });
    }
    let status;
    let cursor;
    if (this.mode === 'search') {
      status = { text: '/' + this.q, spans: [] };
      cursor = { r: this.page, c: this.q.length + 1 };
    } else {
      const atEnd = this.top >= this.maxTop;
      const t = this.msg || (atEnd ? '(END)' : this.top === 0 && this.title ? this.title : ':');
      status = { text: t, spans: t === ':' ? [] : [{ a: 0, b: t.length, cls: 'inv' }] };
      cursor = { r: this.page, c: t.length };
    }
    lines.push(status);
    return { lines, cursor };
  }

  help() {
    return this.mode === 'search'
      ? { mode: 'less: search', keys: [['type the text', ''], ['Enter', 'find'], ['Esc', 'cancel']] }
      : { mode: 'less (pager)', keys: [['Space', 'next page'], ['b', 'page back'], ['↑ ↓', 'line by line'], ['/text', 'search'], ['n', 'next match'], ['q', 'quit']] };
  }
}
