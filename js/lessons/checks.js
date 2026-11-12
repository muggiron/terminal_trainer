// Small building blocks for "did the learner do it?" checks.
//
// Every check is a function (ev) => boolean. Events come from three places:
//   { type: 'cmd', line, cmds: [{ name, args, ok }], exit, out, err, bang, sh }  after a command line ran
//   { type: 'key', key, line, after, sh }                                       terminal shortcuts (Tab, Ctrl+A ...)
//   { type: 'vi' | 'nano', what, vi | nano, sh, ... }                            from inside the editors
//
// Where possible, checks look at the resulting state (does the file exist?) instead of
// the exact text typed, so that every correct way of doing something counts.

import { norm } from '../shell/vfs.js';

export const path = (sh, p) => norm(sh.tilde(p), sh.cwd);
export const node = (sh, p) => {
  try { return sh.fs.get(path(sh, p)); } catch { return null; }
};

// The entry itself, without following a symbolic link.
export const lnode = (sh, p) => {
  try { return sh.fs.get(path(sh, p), { follow: false }); } catch { return null; }
};
export const isLink = p => ev => ev.type === 'cmd' && lnode(ev.sh, p)?.t === 'l';

export const flags = args => args.filter(a => /^-[A-Za-z0-9]/.test(a)).map(a => a.slice(1)).join('');
export const has = (...f) => args => { const s = flags(args); return f.every(x => s.includes(x)); };
export const arg = re => args => args.some(a => (re instanceof RegExp ? re.test(a) : a === re));

const named = (c, name) => (Array.isArray(name) ? name.includes(c.name) : c.name === name);
// A command with this name ran successfully (optionally with matching arguments).
export const ran = (name, test) => ev => ev.type === 'cmd' && ev.cmds.some(c => named(c, name) && c.ok && (!test || test(c.args, ev)));
// A command with this name was attempted, whether or not it worked.
export const tried = (name, test) => ev => ev.type === 'cmd' && ev.cmds.some(c => named(c, name) && (!test || test(c.args, ev)));

export const cmd = test => ev => ev.type === 'cmd' && test(ev, ev.sh);
export const line = re => ev => ev.type === 'cmd' && re.test(ev.line);
export const out = re => ev => ev.type === 'cmd' && re.test(ev.out);
export const failed = code => ev => ev.type === 'cmd' && ev.err?.code === code;
export const cwd = p => ev => ev.type === 'cmd' && ev.sh.cwd === path(ev.sh, p);
export const exists = p => ev => ev.type === 'cmd' && !!node(ev.sh, p);
export const gone = p => ev => ev.type === 'cmd' && !node(ev.sh, p);
export const isDir = p => ev => ev.type === 'cmd' && node(ev.sh, p)?.t === 'd';
// The file exists and its content matches (checked after any kind of event, so editors count too).
export const fileHas = (p, re) => ev => { const n = ev.sh && node(ev.sh, p); return !!n && n.t === 'f' && re.test(n.data); };

export const key = (k, test) => ev => ev.type === 'key' && ev.key === k && (!test || test(ev));
export const vi = (what, test) => ev => ev.type === 'vi' && (!what || ev.what === what) && (!test || test(ev.vi, ev));
export const nano = (what, test) => ev => ev.type === 'nano' && (!what || ev.what === what) && (!test || test(ev.nano, ev));

export const all = (...fs) => ev => fs.every(f => f(ev));
export const any = (...fs) => ev => fs.some(f => f(ev));

// Run shell text without showing output or raising events (for lesson setup).
export const quiet = (sh, text) => sh.sourceText(text, { stdin: null, out() {}, err() {}, tty: false });
