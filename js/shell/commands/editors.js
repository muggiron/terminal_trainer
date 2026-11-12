// vi / vim / nano commands: they hand the screen over to a full-screen editor.

import { def } from '../registry.js';
import { FsError, norm } from '../vfs.js';
import { Vi } from '../../editors/vi.js';
import { Nano } from '../../editors/nano.js';

function openFile(c, name) {
  const r = { text: '', isNew: false, readonly: false, denied: false, dir: false };
  if (!name) return r;
  let n = null;
  try { n = c.fs.get(c.abs(name), { user: c.user }); } catch { r.denied = true; }
  if (n && n.t === 'd') r.dir = true;
  else if (!n) r.isNew = !r.denied;
  else if (!c.fs.can(n, c.user, 4)) r.denied = true;
  else { r.text = n.data; r.readonly = !c.fs.can(n, c.user, 2); }
  return r;
}

const writer = c => {
  const { sh, user } = c;
  const cwd = sh.cwd;
  return (name, text) => {
    try {
      sh.fs.write(norm(sh.tilde(name), cwd), text, user);
      return null;
    } catch (e) {
      if (e instanceof FsError) return e.code;
      throw e;
    }
  };
};

export async function runVi(c, name, { readonly = false } = {}) {
  const f = openFile(c, name);
  if (f.dir) {
    c.err(`"${name}" is a directory\n`);
    c.sh.lastErr = { cmd: 'vi', code: 'VI_DIR', target: name };
    return 1;
  }
  const sh = c.sh;
  const app = new Vi({ text: f.text, name, isNew: f.isNew, readonly: readonly || f.readonly, denied: f.denied, write: writer(c), emit: (what, data) => sh.onEvent({ type: 'vi', what, ...data, vi: app, sh }) });
  sh.onEvent({ type: 'vi', what: 'open', vi: app, sh });
  await c.io.fullscreen(app);
  return 0;
}

def(['vi', 'vim', 'view', 'nvim'], async c => {
  if (c.args.includes('--version')) { c.println('VIM - Vi IMproved 9.1 (2024 Jan 02)'); return 0; }
  if (!c.io.fullscreen || !c.tty) { c.err('Vim: Warning: Output is not to a terminal\n'); return 1; }
  const name = c.args.find(a => !a.startsWith('-') && !a.startsWith('+')) || '';
  return runVi(c, name, { readonly: c.name === 'view' });
}, { help: true });

def(['nano', 'pico'], async c => {
  if (!c.io.fullscreen || !c.tty) { c.err('Too many errors from stdin\n'); return 1; }
  const name = c.args.find(a => !a.startsWith('-') && !a.startsWith('+')) || '';
  const f = openFile(c, name);
  if (f.dir) {
    c.err(`nano: ${name} is a directory\n`);
    c.sh.lastErr = { cmd: 'nano', code: 'VI_DIR', target: name };
    return 1;
  }
  const sh = c.sh;
  const app = new Nano({ text: f.text, name, isNew: f.isNew, write: writer(c), emit: (what, data) => sh.onEvent({ type: 'nano', what, ...data, nano: app, sh }) });
  if (f.denied) app.msg = `Error reading ${name}: Permission denied`;
  else if (f.readonly) app.msg = `File '${name}' is unwritable`;
  sh.onEvent({ type: 'nano', what: 'open', nano: app, sh });
  await c.io.fullscreen(app);
  return 0;
}, { help: true });
