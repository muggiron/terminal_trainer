// Navigation and file commands: pwd cd ls mkdir touch cp mv rm cat echo ...

import { def } from '../registry.js';
import { FsError, dirname, basename } from '../vfs.js';
import { sgr, columns, lsDate, fullDate, human, modeStr, bytes, unescapeC, sprintf } from '../util.js';

const size = (n, mac) => (n.t === 'd' ? (mac ? 32 * (n.kids.size + 2) : 4096) : n.t === 'l' ? n.to.length : bytes(n.data));
const tildeify = (sh, p) => (p === sh.home ? '~' : p.startsWith(sh.home + '/') ? '~' + p.slice(sh.home.length) : p);

async function confirm(c, question) {
  if (!c.io.readLine) return true;
  const a = await c.io.readLine(question);
  return /^y/i.test(a || '');
}

def('pwd', c => {
  // -P prints the physical location, with symbolic links resolved
  const physical = c.args.some(a => /^-\w*P/.test(a));
  c.println(physical ? c.fs.realpath(c.sh.cwd) ?? c.sh.cwd : c.sh.cwd);
}, { builtin: true, bin: true });

def('cd', c => {
  const sh = c.sh;
  const args = c.args.filter(a => a !== '--');
  const bad = (code, t) => {
    const text = { ENOENT: 'no such file or directory', ENOTDIR: 'not a directory', EACCES: 'permission denied' }[code];
    c.err(sh.zsh ? `cd: ${text}: ${t}\n` : `bash: cd: ${t}: ${text[0].toUpperCase() + text.slice(1)}\n`);
    sh.lastErr = { cmd: 'cd', code, target: t };
    return 1;
  };
  if (args.length > 1) {
    c.err(sh.zsh ? `cd: string not in pwd: ${args[0]}\n` : 'bash: cd: too many arguments\n');
    sh.lastErr = { cmd: 'cd', code: 'CD_ARGS', target: args.join(' ') };
    return 1;
  }
  let t = args[0] ?? sh.home;
  let show = false;
  if (t === '-') { t = sh.env.OLDPWD || sh.cwd; show = true; }
  const abs = c.abs(t);
  let n;
  try { n = c.fs.get(abs, { user: c.user }); } catch (e) { return bad(e.code === 'ENOTDIR' ? 'ENOTDIR' : 'EACCES', t); }
  if (!n) return bad('ENOENT', t);
  if (n.t !== 'd') return bad('ENOTDIR', t);
  if (!c.fs.can(n, c.user, 1)) return bad('EACCES', t);
  sh.env.OLDPWD = sh.cwd;
  sh.cwd = abs;
  sh.env.PWD = abs;
  sh.visit(abs);
  if (show) c.println(sh.zsh ? tildeify(sh, abs) : abs);
}, { builtin: true });

def('ls', c => {
  const p = c.opts({ bool: 'laAhRrtS1dFGpC', long: { color: 'opt', all: 'bool' } });
  if (!p) return c.mac ? 1 : 2;
  const { o, rest } = p;
  if (o.all) o.a = true;
  const mac = c.mac;
  const color = c.tty && (mac ? o.G : o.color !== undefined && o.color !== 'never');
  let st = 0;
  const cmp = mac
    ? (a, b) => (a < b ? -1 : a > b ? 1 : 0)
    : (a, b) => a.replace(/^\./, '').toLowerCase().localeCompare(b.replace(/^\./, '').toLowerCase()) || (a < b ? -1 : 1);
  const order = ents => {
    ents.sort((a, b) => (o.t ? b[1].mtime - a[1].mtime : o.S ? size(b[1], mac) - size(a[1], mac) : 0) || cmp(a[0], b[0]));
    if (o.r) ents.reverse();
    return ents;
  };
  const deco = (name, n) => {
    let s = name;
    if (color) {
      if (n.t === 'd') s = sgr(mac ? '34' : '1;34', name);
      else if (n.t === 'l') s = sgr(mac ? '35' : '1;36', name);
      else if (n.mode & 0o111) s = sgr(mac ? '31' : '1;32', name);
    }
    if (n.t === 'd' && (o.F || o.p)) s += '/';
    else if (o.F && n.t === 'l') s += '@';
    else if (o.F && n.mode & 0o111) s += '*';
    return s;
  };
  const show = ents => {
    if (o.l) {
      const rows = ents.map(([name, n]) => [
        modeStr(n), String(n.t === 'd' ? (mac ? n.kids.size + 2 : 2 + [...n.kids.values()].filter(k => k.t === 'd').length) : 1),
        n.owner, n.group, o.h ? human(size(n, mac), mac) : String(size(n, mac)), lsDate(n.mtime),
        deco(name, n) + (n.t === 'l' ? ' -> ' + n.to : ''),
      ]);
      const w = i => Math.max(...rows.map(r => r[i].length));
      const [w1, w2, w3, w4] = [1, 2, 3, 4].map(w);
      const g = mac ? '  ' : ' ';
      for (const r of rows) c.println(`${r[0]}${g}${r[1].padStart(w1)} ${r[2].padEnd(w2)}${g}${r[3].padEnd(w3)}${g}${r[4].padStart(w4)} ${r[5]} ${r[6]}`);
    } else if (!c.tty || o['1']) ents.forEach(e => c.println(deco(...e)));
    else c.out(columns(ents.map(e => deco(...e)), c.cols, mac));
  };
  const listDir = (label, abs, n, header) => {
    if (!c.fs.can(n, c.user, 4)) {
      c.fail('EACCES', label, { verb: 'cannot open directory' });
      st = mac ? 1 : 2;
      return;
    }
    const ents = [...n.kids].filter(([k]) => o.a || o.A || !k.startsWith('.'));
    if (o.a) ents.push(['.', n], ['..', c.fs.get(dirname(abs)) || n]);
    if (header) c.println(label + ':');
    if (o.l) {
      const blocks = ents.reduce((s, [, k]) => s + (k.t === 'f' ? Math.ceil(bytes(k.data) / 4096) * (mac ? 8 : 4) : mac ? 0 : k.t === 'd' ? 4 : 0), 0);
      c.println('total ' + blocks);
    }
    show(order(ents));
    if (o.R) {
      for (const [k, v] of ents) {
        if (v.t !== 'd' || k === '.' || k === '..') continue;
        c.println('');
        listDir(label.endsWith('/') ? label + k : label + '/' + k, abs + '/' + k, v, true);
      }
    }
  };

  const files = [];
  const dirs = [];
  for (const t of rest.length ? rest : ['.']) {
    const n = c.node(t, { follow: !o.l || t.endsWith('/') });
    if (!n) { st = mac ? 1 : 2; continue; }
    (n.t === 'd' && !o.d ? dirs : files).push([t, n]);
  }
  if (files.length) show(order(files));
  const header = dirs.length + files.length > 1 || o.R || st !== 0;
  dirs.forEach(([t, n], i) => {
    if (i || files.length) c.println('');
    listDir(t, c.abs(t), n, header && (dirs.length + files.length > 1 || o.R));
  });
  return st;
}, { dir: { mac: '/bin' } });

def('mkdir', c => {
  const p = c.opts({ bool: 'pv', val: 'm' });
  if (!p) return 1;
  if (!p.rest.length) return c.missing();
  let st = 0;
  for (const d of p.rest) {
    try {
      c.fs.mkdir(c.abs(d), c.user, { p: p.o.p });
      if (p.o.v) c.println(c.mac ? d : `mkdir: created directory '${d}'`);
    } catch (e) {
      if (!(e instanceof FsError)) throw e;
      if (e.code === 'ENOENT') c.fail('ENOENT', c.mac ? dirname(d) : d, { coach: 'MKDIR_PARENT', wanted: d });
      else c.fail(e.code, d);
      st = 1;
    }
  }
  if (!st) c.sh.tip('silent', { cmd: 'mkdir' });
  return st;
}, { dir: { mac: '/bin' } });

def('rmdir', c => {
  const p = c.opts({ bool: 'pv' });
  if (!p) return 1;
  if (!p.rest.length) return c.missing();
  let st = 0;
  for (const d of p.rest) {
    const n = c.node(d, { follow: false });
    if (!n) { st = 1; continue; }
    if (n.t !== 'd') { c.fail('ENOTDIR', d); st = 1; continue; }
    if (!c.guard(d, a => c.fs.rm(a, c.user))) st = 1;
  }
  return st;
}, { dir: { mac: '/bin' } });

def('touch', c => {
  const p = c.opts({ bool: 'acm', val: 't' });
  if (!p) return 1;
  if (!p.rest.length) return c.missing('file operand');
  let st = 0;
  for (const f of p.rest) {
    const ok = c.guard(f, a => {
      const n = c.fs.get(a, { user: c.user });
      if (n) {
        if (!c.fs.can(n, c.user, 2)) throw new FsError('EACCES', a);
        n.mtime = Date.now();
      } else c.fs.write(a, '', c.user);
    });
    if (!ok) st = 1;
  }
  if (!st) c.sh.tip('silent', { cmd: 'touch' });
  return st;
});

// Shared by cp and mv: work out the real destination for each source.
function targets(c, rest) {
  const dst = rest[rest.length - 1];
  const srcs = rest.slice(0, -1);
  let dn = null;
  try { dn = c.fs.get(c.abs(dst), { user: c.user }); } catch { /* reported later */ }
  const intoDir = dn && dn.t === 'd';
  if (srcs.length > 1 && !intoDir) {
    c.err(c.mac ? `${c.name}: ${dst} is not a directory\n` : `${c.name}: target '${dst}' is not a directory\n`);
    c.sh.lastErr = { cmd: c.name, code: 'TARGET_NOT_DIR', target: dst };
    return null;
  }
  return srcs.map(s => [s, intoDir ? (dst.endsWith('/') ? dst : dst + '/') + basename(s) : dst]);
}

def('cp', async c => {
  const p = c.opts({ bool: 'rRvinpaf' });
  if (!p) return 1;
  const { o, rest } = p;
  if (rest.length < 2) {
    if (c.mac || !rest.length) return c.missing('file operand');
    c.err(`cp: missing destination file operand after '${rest[0]}'\nTry 'cp --help' for more information.\n`);
    c.sh.lastErr = { cmd: 'cp', code: 'USAGE' };
    return 1;
  }
  const pairs = targets(c, rest);
  if (!pairs) return 1;
  const rec = o.r || o.R || o.a;
  let st = 0;
  for (const [src, dst] of pairs) {
    const n = c.node(src);
    if (!n) { st = 1; continue; }
    if (n.t === 'd' && !rec) {
      c.err(c.mac ? `cp: ${src} is a directory (not copied).\n` : `cp: -r not specified; omitting directory '${src}'\n`);
      c.sh.lastErr = { cmd: 'cp', code: 'CP_DIR', target: src };
      st = 1;
      continue;
    }
    if (c.abs(src) === c.abs(dst)) {
      c.err(c.mac ? `cp: ${dst} and ${src} are identical (not copied).\n` : `cp: '${src}' and '${dst}' are the same file\n`);
      c.sh.lastErr = { cmd: 'cp', code: 'SAME_FILE', target: src };
      st = 1;
      continue;
    }
    let exists = null;
    try { exists = c.fs.get(c.abs(dst), { user: c.user }); } catch { /* reported by cp below */ }
    if (o.i && exists && exists.t !== 'd' && !(await confirm(c, c.mac ? `overwrite ${dst}? (y/n [n]) ` : `cp: overwrite '${dst}'? `))) {
      if (c.mac) c.println('not overwritten');
      continue;
    }
    try {
      c.fs.cp(c.abs(src), c.abs(dst), c.user, { r: rec });
      if (o.v) c.println(c.mac ? `${src} -> ${dst}` : `'${src}' -> '${dst}'`);
    } catch (e) {
      if (!(e instanceof FsError)) throw e;
      const onDst = e.path !== c.abs(src);
      c.fail(e.code, onDst ? dst : src, onDst ? { verb: e.code === 'EACCES' ? 'cannot create regular file' : 'cannot create' } : {});
      st = 1;
    }
  }
  if (!st) c.sh.tip('silent', { cmd: 'cp' });
  return st;
}, { dir: { mac: '/bin' } });

def('mv', async c => {
  const p = c.opts({ bool: 'ifvn' });
  if (!p) return 1;
  const { o, rest } = p;
  if (rest.length < 2) {
    if (c.mac || !rest.length) return c.missing('file operand');
    c.err(`mv: missing destination file operand after '${rest[0]}'\nTry 'mv --help' for more information.\n`);
    c.sh.lastErr = { cmd: 'mv', code: 'USAGE' };
    return 1;
  }
  const pairs = targets(c, rest);
  if (!pairs) return 1;
  let st = 0;
  for (const [src, dst] of pairs) {
    const n = c.node(src, { follow: false });
    if (!n) { st = 1; continue; }
    let exists = null;
    try { exists = c.fs.get(c.abs(dst), { user: c.user, follow: false }); } catch { /* reported by mv below */ }
    if (exists && o.n) continue;
    if (o.i && exists && !(await confirm(c, c.mac ? `overwrite ${dst}? (y/n [n]) ` : `mv: overwrite '${dst}'? `))) {
      if (c.mac) c.println('not overwritten');
      continue;
    }
    try {
      c.fs.mv(c.abs(src), c.abs(dst), c.user);
      if (o.v) c.println(c.mac ? `${src} -> ${dst}` : `renamed '${src}' -> '${dst}'`);
    } catch (e) {
      if (!(e instanceof FsError)) throw e;
      if (e.code === 'EINVAL') {
        c.err(c.mac ? `mv: rename ${src} to ${dst}: Invalid argument\n` : `mv: cannot move '${src}' to a subdirectory of itself, '${dst}'\n`);
        c.sh.lastErr = { cmd: 'mv', code: 'EINVAL', target: src };
      } else if (c.mac) c.fail(e.code, `rename ${src} to ${dst}`);
      else c.fail(e.code, src, { verb: `cannot move '${src}' to`, msg: `mv: cannot move '${src}' to '${dst}': ${{ ENOENT: 'No such file or directory', EACCES: 'Permission denied', ENOTEMPTY: 'Directory not empty', EISDIR: 'Is a directory', ENOTDIR: 'Not a directory' }[e.code] || e.code}` });
      st = 1;
    }
  }
  if (!st) c.sh.tip('silent', { cmd: 'mv' });
  return st;
}, { dir: { mac: '/bin' } });

def('rm', async c => {
  const p = c.opts({ bool: 'rRfivd', long: { 'no-preserve-root': 'bool', recursive: 'bool', force: 'bool' } });
  if (!p) return 1;
  const { o, rest } = p;
  const rec = o.r || o.R || o.recursive;
  const force = o.f || o.force;
  if (!rest.length) return force ? 0 : c.missing();
  let st = 0;
  let removed = 0;
  for (const f of rest) {
    const abs = c.abs(f);
    if (abs === '/' || (f === '.' || f === '..' || f.endsWith('/.') || f.endsWith('/..'))) {
      if (abs === '/') c.err(c.mac ? 'rm: "/" may not be removed\n' : "rm: it is dangerous to operate recursively on '/'\nrm: use --no-preserve-root to override this failsafe\n");
      else c.err(c.mac ? `rm: "." and ".." may not be removed\n` : `rm: refusing to remove '.' or '..' directory: skipping '${f}'\n`);
      c.sh.lastErr = { cmd: 'rm', code: 'RM_ROOT', target: f };
      st = 1;
      continue;
    }
    let n = null;
    try { n = c.fs.get(abs, { follow: false, user: c.user }); } catch (e) { if (!force) c.fail(e.code, f); st = 1; continue; }
    if (!n) {
      if (!force) { c.fail('ENOENT', f); st = 1; }
      continue;
    }
    if (n.t === 'd' && !rec && !(o.d && !n.kids.size)) {
      c.err(c.mac ? `rm: ${f}: is a directory\n` : `rm: cannot remove '${f}': Is a directory\n`);
      c.sh.lastErr = { cmd: 'rm', code: 'RM_DIR', target: f };
      st = 1;
      continue;
    }
    if (o.i && !force) {
      const what = n.t === 'd' ? 'directory' : n.t === 'f' && !n.data.length ? 'regular empty file' : 'regular file';
      if (!(await confirm(c, c.mac ? `remove ${f}? ` : `rm: remove ${what} '${f}'? `))) continue;
    }
    if (c.guard(f, a => c.fs.rm(a, c.user, { r: rec }))) {
      removed++;
      if (o.v) c.println(c.mac ? f : `removed ${n.t === 'd' ? 'directory ' : ''}'${f}'`);
    } else st = 1;
  }
  if (removed) c.sh.tip('rm', {});
  return st;
}, { dir: { mac: '/bin' } });

def('cat', async c => {
  const p = c.opts({ bool: 'nbsuvet' });
  if (!p) return 1;
  let st = 0;
  let n = 0;
  const emit = text => {
    if (p.o.n || p.o.b) {
      const parts = text.split('\n');
      const tail = parts.pop();
      const num = l => (p.o.b && !l ? l : String(++n).padStart(6) + '\t' + l);
      text = parts.map(l => num(l) + '\n').join('') + (tail ? num(tail) : '');
    }
    c.out(text);
  };
  for (const f of p.rest.length ? p.rest : ['-']) {
    if (f === '-') {
      if (c.stdin !== null && c.stdin !== undefined) emit(c.stdin);
      else if (c.io.readLine) {
        c.sh.tip('stdin', { cmd: 'cat' });
        for (;;) {
          const l = await c.io.readLine('');
          if (l === null) break;
          emit(l + '\n');
        }
      }
      continue;
    }
    const d = c.read(f);
    if (d === null) { st = 1; continue; }
    emit(d);
  }
  return st;
}, { dir: { mac: '/bin' } });

def('echo', c => {
  let a = c.args;
  let nl = true;
  let esc = c.sh.zsh; // zsh's echo understands \n by default, bash's needs -e
  while (a.length && /^-[neE]+$/.test(a[0])) {
    for (const ch of a[0].slice(1)) {
      if (ch === 'n') nl = false;
      else if (ch === 'e') esc = true;
      else esc = false;
    }
    a = a.slice(1);
  }
  const s = a.join(' ');
  c.out((esc ? unescapeC(s) : s) + (nl ? '\n' : ''));
}, { builtin: true, bin: true });

def('printf', c => {
  if (!c.args.length) { c.err(c.sh.zsh ? 'printf: not enough arguments\n' : 'printf: usage: printf [-v var] format [arguments]\n'); return 1; }
  c.out(sprintf(c.args[0], c.args.slice(1)));
}, { builtin: true, bin: true });

def('ln', c => {
  const p = c.opts({ bool: 'sfnv' });
  if (!p) return 1;
  if (p.rest.length < 1) return c.missing('file operand');
  const target = p.rest[0];
  let link = p.rest[1] ?? basename(target);
  const ln = c.fs.get(c.abs(link), { user: c.user });
  if (ln && ln.t === 'd') link = (link.endsWith('/') ? link : link + '/') + basename(target);
  const abs = c.abs(link);
  if (c.fs.get(abs, { follow: false })) {
    if (!p.o.f) return c.fail('EEXIST', link);
    c.fs.rm(abs, c.user, { r: true });
  }
  const parent = c.fs.get(dirname(abs), { user: c.user });
  if (!parent || parent.t !== 'd') return c.fail('ENOENT', link);
  if (!c.fs.can(parent, c.user, 2)) return c.fail('EACCES', link);
  if (p.o.s) parent.kids.set(basename(abs), c.fs.node('l', c.mac ? 0o755 : 0o777, c.user.name, c.user.group, { to: target }));
  else {
    const n = c.node(target);
    if (!n) return 1;
    if (n.t === 'd') { c.err(c.mac ? `ln: ${target}: Is a directory\n` : `ln: ${target}: hard link not allowed for directory\n`); return 1; }
    parent.kids.set(basename(abs), n);
  }
}, { dir: { mac: '/bin' } });

def('file', c => {
  if (!c.args.length) return c.missing('file operand');
  let st = 0;
  for (const f of c.args) {
    const n = c.fs.get(c.abs(f), { follow: false });
    let d;
    if (!n) { d = `cannot open \`${f}' (No such file or directory)`; st = 1; }
    else if (n.t === 'd') d = 'directory';
    else if (n.t === 'l') d = `symbolic link to ${n.to}`;
    else if (n.bin) d = c.mac ? 'Mach-O 64-bit executable arm64' : 'ELF 64-bit LSB pie executable, x86-64, version 1 (SYSV), dynamically linked';
    else if (!n.data.length) d = 'empty';
    else if (n.data.startsWith('\x1fTAR:')) d = n.data.includes('"gz":true') ? 'gzip compressed data, from Unix' : 'POSIX tar archive';
    else if (n.data.startsWith('\x1fZIP:')) d = 'Zip archive data, at least v2.0 to extract';
    else if (/\.(jpe?g)$/i.test(f)) d = 'JPEG image data, JFIF standard 1.01';
    else if (/\.png$/i.test(f)) d = 'PNG image data, 1024 x 768, 8-bit/color RGBA, non-interlaced';
    else if (/\.pdf$/i.test(f)) d = 'PDF document, version 1.7';
    else if (/^#!.*\b(ba|z)?sh\b/.test(n.data)) d = `${/bash/.test(n.data.split('\n')[0]) ? 'Bourne-Again' : 'POSIX'} shell script text executable, ASCII text`;
    else if (/\.json$/i.test(f)) d = 'JSON data';
    else if (/\.html?$/i.test(f)) d = 'HTML document text, ASCII text';
    else if (/\.csv$/i.test(f)) d = 'CSV text';
    else d = 'ASCII text';
    c.println(`${f}: ${d}`);
  }
  return st;
});

def('stat', c => {
  const files = c.args.filter(a => !a.startsWith('-'));
  if (!files.length) return c.missing();
  let st = 0;
  for (const f of files) {
    const n = c.node(f, { follow: false });
    if (!n) { st = 1; continue; }
    const kind = n.t === 'd' ? 'directory' : n.t === 'l' ? 'symbolic link' : n.data?.length ? 'regular file' : 'regular empty file';
    const oct = '0' + n.mode.toString(8).padStart(3, '0');
    const uid = n.owner === 'root' ? 0 : c.mac ? 501 : 1000;
    c.println(`  File: ${f}${n.t === 'l' ? ' -> ' + n.to : ''}`);
    c.println(`  Size: ${String(size(n, c.mac)).padEnd(15)} FileType: ${kind}`);
    c.println(`  Mode: (${oct}/${modeStr(n)})  Uid: (${String(uid).padStart(5)}/${n.owner.padStart(8)})  Gid: (${n.group.padStart(8)})`);
    c.println(`Modify: ${fullDate(n.mtime)}`);
  }
  return st;
});

def('du', c => {
  const p = c.opts({ bool: 'shakc', val: 'd', long: { 'max-depth': 'val' } });
  if (!p) return 1;
  const { o, rest } = p;
  const unit = c.mac ? 512 : 1024;
  const fmt = b => (o.h ? human(b, false).replace(/^(\d+)$/, '$1B') : String(Math.ceil(b / (o.k ? 1024 : unit))));
  let st = 0;
  for (const t of rest.length ? rest : ['.']) {
    const root = c.node(t);
    if (!root) { st = 1; continue; }
    const walk = (label, n) => {
      if (n.t !== 'd') {
        const b = n.t === 'f' ? Math.ceil(bytes(n.data) / 4096) * 4096 : 0;
        if (o.a) c.println(`${fmt(b)}\t${label}`);
        return b;
      }
      let total = c.mac ? 0 : 4096;
      for (const [k, v] of n.kids) total += walk(label.endsWith('/') ? label + k : label + '/' + k, v);
      if (!o.s) c.println(`${fmt(total)}\t${label}`);
      return total;
    };
    const total = walk(t, root);
    if (o.s || root.t !== 'd') c.println(`${fmt(total)}\t${t}`);
  }
  return st;
});

def('df', c => {
  const h = c.args.some(a => /^-\w*h/.test(a));
  if (c.mac) {
    c.println(h
      ? 'Filesystem        Size    Used   Avail Capacity iused ifree %iused  Mounted on\n/dev/disk3s1s1   460Gi    10Gi   212Gi     5%    426k  2.2G    0%   /\n/dev/disk3s5     460Gi   235Gi   212Gi    53%    1.9M  2.2G    0%   /System/Volumes/Data'
      : 'Filesystem     512-blocks      Used Available Capacity iused      ifree %iused  Mounted on\n/dev/disk3s1s1  965595304  21620416 445239152     5%  426201 2226195760    0%   /\n/dev/disk3s5    965595304 493224448 445239152    53% 1934720 2226195760    0%   /System/Volumes/Data');
  } else {
    c.println(h
      ? 'Filesystem      Size  Used Avail Use% Mounted on\ntmpfs           1.6G  2.1M  1.6G   1% /run\n/dev/nvme0n1p2  234G   61G  162G  28% /\ntmpfs           7.8G     0  7.8G   0% /dev/shm\n/dev/nvme0n1p1  1.1G  6.2M  1.1G   1% /boot/efi'
      : 'Filesystem     1K-blocks     Used Available Use% Mounted on\ntmpfs            1630284     2104   1628180   1% /run\n/dev/nvme0n1p2 244506940 63321208 168692708  28% /\ntmpfs            8151408        0   8151408   0% /dev/shm\n/dev/nvme0n1p1   1098632     6284   1092348   1% /boot/efi');
  }
}, { dir: { mac: '/bin' } });

def('basename', c => {
  if (!c.args.length) return c.missing();
  let b = basename(c.args[0]);
  if (c.args[1] && b.endsWith(c.args[1]) && b !== c.args[1]) b = b.slice(0, -c.args[1].length);
  c.println(b);
});
def('dirname', c => (c.args.length ? c.println(dirname(c.args[0])) : c.missing()));
def('realpath', c => {
  if (!c.args.length) return c.missing();
  let st = 0;
  for (const f of c.args) { if (c.node(f)) c.println(c.fs.realpath(c.abs(f)) ?? c.abs(f)); else st = 1; }
  return st;
});

def('readlink', c => {
  const files = c.args.filter(a => !a.startsWith('-'));
  if (!files.length) return c.missing();
  const full = c.args.some(a => /^-\w*f/.test(a));
  let st = 0;
  for (const f of files) {
    let n = null;
    try { n = c.fs.get(c.abs(f), { follow: false, user: c.user }); } catch { /* treated as missing */ }
    if (full && n) c.println(c.fs.realpath(c.abs(f)) ?? c.abs(f));
    else if (n && n.t === 'l') c.println(n.to);
    else st = 1;
  }
  return st;
});

def('tree', c => {
  const p = c.opts({ bool: 'adCF', val: 'L', permute: true });
  if (!p) return 1;
  const { o, rest } = p;
  const depth = o.L ? parseInt(o.L, 10) : Infinity;
  let nd = 0, nf = 0, st = 0;
  for (const t of rest.length ? rest : ['.']) {
    const root = c.fs.get(c.abs(t), { user: c.user });
    if (!root || root.t !== 'd') { c.println(`${t}  [error opening dir]`); st = 2; continue; }
    c.println(c.tty ? sgr('1;34', t) : t);
    const walk = (n, prefix, level) => {
      const ents = [...n.kids].filter(([k, v]) => (o.a || !k.startsWith('.')) && (!o.d || v.t === 'd')).sort((a, b) => a[0].localeCompare(b[0]));
      ents.forEach(([k, v], i) => {
        const last = i === ents.length - 1;
        const name = v.t === 'd' && c.tty ? sgr('1;34', k) : k;
        c.println(prefix + (last ? '└── ' : '├── ') + name + (v.t === 'l' ? ' -> ' + v.to : ''));
        if (v.t === 'd') {
          nd++;
          if (level < depth) walk(v, prefix + (last ? '    ' : '│   '), level + 1);
        } else nf++;
      });
    };
    walk(root, '', 1);
  }
  c.println(`\n${nd} director${nd === 1 ? 'y' : 'ies'}${o.d ? '' : `, ${nf} file${nf === 1 ? '' : 's'}`}`);
  return st;
}, { pkg: 'tree' });

// open / xdg-open cannot launch real apps here, so the trainer says what would happen.
const opener = c => {
  const args = c.args.filter((a, i) => !a.startsWith('-') && c.args[i - 1] !== '-a');
  const app = c.args.includes('-a') ? c.args[c.args.indexOf('-a') + 1] : null;
  if (!args.length && !app) return c.missing();
  for (const t of args.length ? args : ['']) {
    if (!t || /^[a-z]+:\/\//i.test(t)) { c.sh.tip('open', { target: t, kind: t ? 'url' : 'app', app }); continue; }
    const n = c.fs.get(c.abs(t), { user: c.user });
    if (!n) {
      c.err(c.mac ? `The file ${c.abs(t)} does not exist.\n` : `xdg-open: file '${t}' does not exist\n`);
      c.sh.lastErr = { cmd: c.name, code: 'ENOENT', target: t };
      return c.mac ? 1 : 2;
    }
    c.sh.tip('open', { target: t, kind: n.t === 'd' ? 'dir' : 'file', app });
  }
};
def('open', opener, { os: 'mac' });
def('xdg-open', opener, { os: 'linux' });
