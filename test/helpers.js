// Shared test helpers: a fake terminal and a way to script key presses.

import { createShell } from '../js/shell/index.js';

// 'ihello<Esc>:wq<Enter>' -> ['i','h','e','l','l','o','Escape',':','w','q','Enter']
export function keys(text) {
  const names = { Esc: 'Escape', Enter: 'Enter', BS: 'Backspace', Tab: 'Tab', Up: 'ArrowUp', Down: 'ArrowDown', Left: 'ArrowLeft', Right: 'ArrowRight', Space: ' ' };
  const out = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '<') {
      const j = text.indexOf('>', i);
      const name = j > 0 ? text.slice(i + 1, j) : '';
      if (names[name] || /^C-.$/.test(name)) { out.push(names[name] || name); i = j; continue; }
    }
    out.push(text[i]);
  }
  return out;
}

// A terminal stand-in. Full-screen programs read from `keys`, questions from `answers`.
export function makeIo() {
  return {
    buf: '', cols: 80, rows: 24, keys: [], answers: [],
    write(s) { this.buf += s; },
    clear() {},
    readLine(prompt, opts = {}) {
      this.buf += prompt + '\n';
      if (this.answers.length) return Promise.resolve(this.answers.shift());
      if (opts.hidden) return Promise.resolve('secret');
      if (/yes\/no/.test(prompt)) return Promise.resolve('yes');
      if (/RETURN|\[Y\/n\]/.test(prompt)) return Promise.resolve('');
      return Promise.resolve(null); // end of keyboard input (Ctrl+D)
    },
    async fullscreen(app) {
      app.resize(this.rows, this.cols);
      app.render();
      while (!app.done) {
        const k = this.keys.shift();
        if (k === undefined) throw new Error('a full-screen program is still open, but the script has no more keys');
        app.key(k);
        app.render();
      }
    },
  };
}

export async function shellFor(os = 'mac', { onEvent, speed = 1e6 } = {}) {
  const io = makeIo();
  const sh = await createShell({ os, io, onEvent, speed });
  // Run a line and return what it printed, without colour codes.
  const run = async line => {
    io.buf = '';
    const ev = await sh.run(line);
    return { ...ev, text: io.buf.replace(/\x1b\[[0-9;]*m/g, '') };
  };
  return { sh, io, run };
}
