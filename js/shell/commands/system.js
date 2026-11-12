// Shell builtins, help, permissions, processes and system information.

import { def, commands, Exit, Signal } from '../registry.js';
import { FsError } from '../vfs.js';
import { sgr, quoteArg, MONTHS, DAYS, p2, fullDate } from '../util.js';
import { REF, REFMAP, CATS, noteFor } from '../../data/reference.js';
import { helpText } from '../shell.js';
import { page } from './text.js';
import { installedPkgs } from '../packages.js';

// ---------- help ----------
const available = (sh, r) => (!r.os || r.os === sh.os) && (!r.pkg || !!sh.which(r.name) || !!installedPkgs(sh.fs)[r.pkg]);

def('help', c => {
  const sh = c.sh;
  if (c.args.length) {
    const t = helpText(c.args[0]);
    if (!t) { c.err(`help: no help topics match '${c.args[0]}'. Try 'help' for the list of commands.\n`); return 1; }
    c.out(t);
    return 0;
  }
  c.println('Commands in this trainer (macOS and Linux differ slightly).');
  c.println("Type 'man NAME' for the manual, or open the Reference panel.\n");
  for (const cat of CATS) {
    const rows = REF.filter(r => r.cat === cat && (!r.os || r.os === sh.os));
    if (!rows.length) continue;
    c.println(c.tty ? sgr('1', cat) : cat);
    for (const r of rows) c.println(`  ${r.name.padEnd(12)} ${r.sum}${available(sh, r) ? '' : '  (not installed)'}`);
    c.println('');
  }
}, { builtin: true });

function manPage(r, os) {
  const head = `${r.name.toUpperCase()}(1)`;
  const mid = 'General Commands Manual';
  const gap = Math.max(2, Math.floor((78 - head.length * 2 - mid.length) / 2));
  let s = `${head}${' '.repeat(gap)}${mid}${' '.repeat(gap)}${head}\n\nNAME\n     ${r.name} – ${r.sum[0].toLowerCase() + r.sum.slice(1)}\n\nSYNOPSIS\n     ${r.syn}\n`;
  if (r.opts.length) {
    s += '\nOPTIONS\n';
    for (const [k, d] of r.opts) s += `     ${k}\n             ${d[0].toUpperCase() + d.slice(1)}.\n\n`;
  }
  if (r.ex.length) {
    s += `${r.opts.length ? '' : '\n'}EXAMPLES\n`;
    for (const [k, d] of r.ex) s += `     ${k}\n             ${d[0].toUpperCase() + d.slice(1)}.\n\n`;
  }
  const note = noteFor(r, os);
  if (note) s += `NOTES\n     ${note.replace(/`/g, '')}\n\n`;
  s += `${os === 'mac' ? 'macOS' : 'Linux'}                         Terminal Trainer manual                         ${head}\n`;
  return s;
}

const apropos = (c, words) => {
  let any = false;
  for (const w of words) {
    const rows = REF.filter(r => (!r.os || r.os === c.os) && (r.name.includes(w.toLowerCase()) || r.sum.toLowerCase().includes(w.toLowerCase())));
    if (!rows.length) { c.println(`${w}: nothing appropriate.`); continue; }
    any = true;
    for (const r of rows) c.println(`${(r.name + ' (1)').padEnd(20)} - ${r.sum}`);
  }
  return any ? 0 : 1;
};

def('man', async c => {
  const a = c.args;
  if (a[0] === '-k') return apropos(c, a.slice(1));
  const name = a.filter(x => !/^(-\w+|\d)$/.test(x))[0];
  if (!name) { c.err("What manual page do you want?\nFor example, try 'man man'.\n"); c.sh.lastErr = { cmd: 'man', code: 'USAGE' }; return 1; }
  if (name === 'man') {
    await page(c, 'MAN(1)                     General Commands Manual                    MAN(1)\n\nNAME\n     man – display manual pages\n\nSYNOPSIS\n     man command\n     man -k keyword\n\nDESCRIPTION\n     The man utility finds and displays the manual page of a command.\n     Pages open in the pager less.\n\n     Space   next page\n     b       previous page\n     /text   search for text, n jumps to the next match\n     q       quit\n', ' Manual page man(1) line 1 (press h for help or q to quit)');
    return 0;
  }
  const r = REFMAP[name];
  if (!r || (r.os && r.os !== c.os)) { c.err(`No manual entry for ${name}\n`); c.sh.lastErr = { cmd: 'man', code: 'NOMAN', target: name }; return 1; }
  c.sh.tip('pager', { cmd: 'man' });
  await page(c, manPage(r, c.os), ` Manual page ${name}(1) line 1 (press h for help or q to quit)`);
});
def('whatis', c => {
  if (!c.args.length) { c.err('whatis what?\n'); return 1; }
  let st = 0;
  for (const n of c.args) {
    const r = REFMAP[n];
    if (r && (!r.os || r.os === c.os)) c.println(`${(n + ' (1)').padEnd(20)} - ${r.sum}`);
    else { c.println(`${n}: nothing appropriate.`); st = 1; }
  }
  return st;
});
def('apropos', c => (c.args.length ? apropos(c, c.args) : (c.err('apropos what?\n'), 1)));

def('which', c => {
  const sh = c.sh;
  let st = 0;
  for (const n of c.args.filter(a => !a.startsWith('-'))) {
    if (sh.zsh && sh.aliases[n] !== undefined) c.println(`${n}: aliased to ${sh.aliases[n]}`);
    else if (sh.zsh && commands[n]?.builtin && !commands[n].hidden) c.println(`${n}: shell built-in command`);
    else {
      const f = sh.which(n);
      if (f) c.println(f.path);
      else { if (sh.zsh) c.println(`${n} not found`); st = 1; }
    }
  }
  return st;
}, { builtin: true });

def('type', c => {
  const sh = c.sh;
  let st = 0;
  for (const n of c.args) {
    if (sh.aliases[n] !== undefined) c.println(sh.zsh ? `${n} is an alias for ${sh.aliases[n]}` : `${n} is aliased to \`${sh.aliases[n]}'`);
    else if (commands[n]?.builtin && !commands[n].hidden) c.println(`${n} is a shell builtin`);
    else {
      const f = sh.which(n);
      if (f) c.println(`${n} is ${f.path}`);
      else { c.err(sh.zsh ? `${n} not found\n` : `bash: type: ${n}: not found\n`); st = 1; }
    }
  }
  return st;
}, { builtin: true });

def('history', c => {
  const sh = c.sh;
  if (c.args[0] === '-c') { sh.history.length = 0; return 0; }
  const n = parseInt(c.args[0], 10);
  const H = sh.history;
  const from = isNaN(n) ? 0 : Math.max(0, H.length - Math.abs(n));
  for (let i = from; i < H.length; i++) c.println(`${String(i + 1).padStart(5)}  ${H[i]}`);
}, { builtin: true });

// ---------- variables and aliases ----------
def('alias', c => {
  const sh = c.sh;
  const show = (k, v) => c.println(sh.zsh ? `${k}=${quoteArg(v)}` : `alias ${k}='${v.replace(/'/g, `'\\''`)}'`);
  if (!c.args.length) { for (const k of Object.keys(sh.aliases).sort()) show(k, sh.aliases[k]); return 0; }
  let st = 0;
  for (const a of c.args) {
    const i = a.indexOf('=');
    if (i > 0) sh.aliases[a.slice(0, i)] = a.slice(i + 1);
    else if (sh.aliases[a] !== undefined) show(a, sh.aliases[a]);
    else { if (!sh.zsh) c.err(`bash: alias: ${a}: not found\n`); st = 1; }
  }
  if (c.args.some(a => a.includes('=')) && c.tty) sh.tip('alias-temp', {});
  return st;
}, { builtin: true });
def('unalias', c => {
  let st = 0;
  for (const a of c.args) {
    if (c.sh.aliases[a] === undefined) { c.err(c.sh.zsh ? `unalias: no such hash table element: ${a}\n` : `bash: unalias: ${a}: not found\n`); st = 1; }
    else delete c.sh.aliases[a];
  }
  return st;
}, { builtin: true });

def('export', c => {
  const sh = c.sh;
  if (!c.args.length || c.args[0] === '-p') {
    for (const k of [...sh.exported].sort()) if (sh.env[k] !== undefined) c.println(sh.zsh ? `${k}=${quoteArg(sh.env[k])}` : `declare -x ${k}="${sh.env[k]}"`);
    return 0;
  }
  for (const a of c.args) {
    const i = a.indexOf('=');
    const k = i < 0 ? a : a.slice(0, i);
    if (!/^[A-Za-z_]\w*$/.test(k)) { c.err(sh.zsh ? `export: not valid in this context: ${k}\n` : `bash: export: \`${a}': not a valid identifier\n`); sh.lastErr = { cmd: 'export', code: 'BAD_NAME', target: a }; return 1; }
    if (i >= 0) sh.env[k] = a.slice(i + 1);
    sh.exported.add(k);
    if (k === 'PATH' && i >= 0 && !/(^|:)\/(usr\/)?bin(:|$)/.test(sh.env.PATH)) sh.tip('path-broken', { path: sh.env.PATH });
  }
}, { builtin: true });
def('unset', c => { for (const a of c.args) { delete c.sh.env[a]; c.sh.exported.delete(a); } }, { builtin: true });
const envList = c => {
  const sh = c.sh;
  if (c.args.length && c.name === 'printenv') {
    let st = 0;
    for (const k of c.args) { if (sh.exported.has(k) && sh.env[k] !== undefined) c.println(sh.env[k]); else st = 1; }
    return st;
  }
  for (const k of sh.exported) if (sh.env[k] !== undefined) c.println(`${k}=${sh.env[k]}`);
};
def('env', envList);
def('printenv', envList);

def(['source', '.'], async c => {
  const sh = c.sh;
  if (!c.args.length) { c.err(sh.zsh ? `${c.name}: not enough arguments\n` : `bash: ${c.name}: filename argument required\n${c.name}: usage: ${c.name} filename [arguments]\n`); sh.lastErr = { cmd: 'source', code: 'USAGE' }; return 1; }
  const f = c.args[0];
  let text;
  try { text = c.fs.read(c.abs(f), c.user); } catch (e) {
    if (!(e instanceof FsError)) throw e;
    const t = { ENOENT: 'no such file or directory', EACCES: 'permission denied', EISDIR: 'is a directory' }[e.code] || e.code;
    c.err(sh.zsh ? `${c.name}: ${t}: ${f}\n` : `bash: ${f}: ${t[0].toUpperCase() + t.slice(1)}\n`);
    sh.lastErr = { cmd: 'source', code: e.code, target: f };
    return 1;
  }
  return sh.sourceText(text, c.sio);
}, { builtin: true });
def('eval', c => c.sh.runScript(c.args.join(' '), c.sh.pos, c.sio), { builtin: true });
def(['exit', 'logout'], c => { throw new Exit(parseInt(c.args[0], 10) || 0); }, { builtin: true });
def(['clear', 'reset'], c => { c.io.clear?.(); });
def('true', () => 0, { builtin: true, bin: true });
def('false', () => 1, { builtin: true, bin: true });

def(['bash', 'sh', 'zsh'], async c => {
  const a = c.args;
  if (a[0] === '--version') { c.println(c.name === 'zsh' ? 'zsh 5.9 (arm64-apple-darwin25.0)' : c.mac ? 'GNU bash, version 3.2.57(1)-release (arm64-apple-darwin25)' : 'GNU bash, version 5.2.21(1)-release (x86_64-pc-linux-gnu)'); return 0; }
  if (a[0] === '-c') {
    if (a[1] === undefined) { c.err(`${c.name}: -c: option requires an argument\n`); return 2; }
    return c.sh.runScript(a[1], [c.name, ...a.slice(2)], c.sio);
  }
  const i = a.findIndex(x => !x.startsWith('-'));
  if (i < 0) { c.sh.tip('subshell', { shell: c.name }); return 0; }
  let text;
  try { text = c.fs.read(c.abs(a[i]), c.user); } catch (e) {
    if (!(e instanceof FsError)) throw e;
    c.err(`${c.name}: ${a[i]}: ${e.code === 'ENOENT' ? 'No such file or directory' : e.code === 'EISDIR' ? 'Is a directory' : 'Permission denied'}\n`);
    c.sh.lastErr = { cmd: c.name, code: e.code, target: a[i] };
    return 127;
  }
  return c.sh.runScript(text, a.slice(i), c.sio);
}, { dir: { mac: '/bin' } });

// ---------- who and what ----------
def('whoami', c => c.println(c.user.name));
def('hostname', c => c.println(c.mac ? c.sh.host + '.local' : c.sh.host));
def('id', c => c.println(c.user.root ? 'uid=0(root) gid=0(' + c.user.group + ') groups=0(' + c.user.group + ')' : c.mac ? `uid=501(${c.user.name}) gid=20(staff) groups=20(staff),12(everyone),61(localaccounts),80(admin)` : `uid=1000(${c.user.name}) gid=1000(${c.user.name}) groups=1000(${c.user.name}),4(adm),27(sudo),100(users)`));
def('groups', c => c.println(c.mac ? 'staff everyone localaccounts admin' : `${c.user.name} adm sudo users`));
def('uname', c => {
  const f = c.args.join('');
  const mac = c.mac;
  const s = mac ? 'Darwin' : 'Linux', n = mac ? c.sh.host + '.local' : c.sh.host, r = mac ? '25.1.0' : '6.8.0-48-generic', m = mac ? 'arm64' : 'x86_64';
  if (f.includes('a')) c.println(mac ? `${s} ${n} ${r} Darwin Kernel Version ${r}: Mon Oct 20 19:32:41 PDT 2025; root:xnu-12377.41.6~2/RELEASE_ARM64_T6031 ${m}` : `${s} ${n} ${r} #48-Ubuntu SMP PREEMPT_DYNAMIC Fri Sep 27 14:04:52 UTC 2024 ${m} ${m} ${m} GNU/Linux`);
  else c.println([...(f.replace(/-/g, '') || 's')].map(ch => ({ s, n, r, m }[ch] || '')).filter(Boolean).join(' ') || s);
});
def('sw_vers', c => c.println('ProductName:\t\tmacOS\nProductVersion:\t\t26.1\nBuildVersion:\t\t25B78'), { os: 'mac' });
def('lsb_release', c => c.println('No LSB modules are available.\nDistributor ID:\tUbuntu\nDescription:\tUbuntu 24.04.1 LTS\nRelease:\t24.04\nCodename:\tnoble'), { os: 'linux' });

function tzName(d) {
  try { return new Intl.DateTimeFormat('en', { timeZoneName: 'short' }).formatToParts(d).find(p => p.type === 'timeZoneName').value; } catch { return 'UTC'; }
}
def('date', c => {
  const d = new Date();
  const fmt = c.args.find(a => a.startsWith('+'));
  if (fmt) {
    const map = { Y: d.getFullYear(), m: p2(d.getMonth() + 1), d: p2(d.getDate()), H: p2(d.getHours()), M: p2(d.getMinutes()), S: p2(d.getSeconds()), s: Math.floor(d / 1000), a: DAYS[d.getDay()], b: MONTHS[d.getMonth()], y: p2(d.getFullYear() % 100), '%': '%' };
    map.F = `${map.Y}-${map.m}-${map.d}`;
    map.T = `${map.H}:${map.M}:${map.S}`;
    c.println(fmt.slice(1).replace(/%(.)/g, (m, k) => map[k] ?? m));
    return;
  }
  const base = `${DAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2)}`;
  if (c.mac) c.println(`${base} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())} ${tzName(d)} ${d.getFullYear()}`);
  else c.println(`${base} ${p2(d.getHours() % 12 || 12)}:${p2(d.getMinutes())}:${p2(d.getSeconds())} ${d.getHours() < 12 ? 'AM' : 'PM'} ${tzName(d)} ${d.getFullYear()}`);
}, { dir: { mac: '/bin' } });
def('cal', c => {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  const title = `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m]} ${y}`;
  c.println(' '.repeat(Math.floor((20 - title.length) / 2)) + title);
  c.println('Su Mo Tu We Th Fr Sa');
  let line = '   '.repeat(new Date(y, m, 1).getDay());
  const days = new Date(y, m + 1, 0).getDate();
  for (let d = 1; d <= days; d++) {
    const cell = String(d).padStart(2);
    line += (d === now.getDate() && c.tty ? sgr('7', cell) : cell) + ' ';
    if (new Date(y, m, d).getDay() === 6 || d === days) { c.println(line.trimEnd()); line = ''; }
  }
});
def('uptime', c => {
  const d = new Date();
  const t = `${p2(d.getHours())}:${p2(d.getMinutes())}`;
  c.println(c.mac ? `${t}  up 3 days,  2:14, 2 users, load averages: 1.52 1.61 1.70` : ` ${t}:${p2(d.getSeconds())} up 3 days,  2:14,  1 user,  load average: 0.52, 0.61, 0.70`);
});
def('free', c => {
  c.println(c.args.join('').includes('h')
    ? '               total        used        free      shared  buff/cache   available\nMem:            15Gi       7.8Gi       3.8Gi       412Mi       3.9Gi       7.3Gi\nSwap:          4.0Gi          0B       4.0Gi'
    : '               total        used        free      shared  buff/cache   available\nMem:        16302816     8204516     3984604      421940     4113696     7676360\nSwap:        4194300           0     4194300');
}, { os: 'linux' });

// ---------- permissions ----------
function applyMode(spec, node) {
  if (/^[0-7]{3,4}$/.test(spec)) return parseInt(spec, 8) & 0o777;
  let mode = node.mode;
  for (const clause of spec.split(',')) {
    const m = clause.match(/^([ugoa]*)([+\-=])([rwxX]*)$/);
    if (!m) return null;
    for (const w of !m[1] || m[1].includes('a') ? 'ugo' : m[1]) {
      let bits = 0;
      for (const ch of m[3]) bits |= ch === 'r' ? 4 : ch === 'w' ? 2 : ch === 'x' || node.t === 'd' || node.mode & 0o111 ? 1 : 0;
      if (!m[1] && m[2] === '+' && w !== 'u') bits &= ~2; // the umask keeps "+w" from making files world-writable
      const sh = { u: 6, g: 3, o: 0 }[w];
      if (m[2] === '+') mode |= bits << sh;
      else if (m[2] === '-') mode &= ~(bits << sh);
      else mode = (mode & ~(7 << sh)) | (bits << sh);
    }
  }
  return mode;
}

function eachTarget(c, files, recursive, fn) {
  let st = 0;
  for (const f of files) {
    const n = c.node(f);
    if (!n) { st = 1; continue; }
    const go = (label, node) => {
      if (!fn(label, node)) st = 1;
      if (recursive && node.t === 'd') for (const [k, v] of node.kids) go(label + '/' + k, v);
    };
    go(f, n);
  }
  return st;
}

def('chmod', c => {
  const a = c.args.slice();
  let rec = false, verbose = false;
  while (a.length && /^-[Rvf]+$/.test(a[0])) { const f = a.shift(); if (f.includes('R')) rec = true; if (f.includes('v')) verbose = true; }
  if (a.length < 2) {
    if (c.mac) c.err('usage:\tchmod [-fhv] [-R [-H | -L | -P]] [-a | +a | =a  [i][# [ n]]] mode|entry file ...\n\tchmod [-fhv] [-R [-H | -L | -P]] [-E | -C | -N | -i | -I] file ...\n');
    else c.err(a.length ? `chmod: missing operand after ‘${a[0]}’\nTry 'chmod --help' for more information.\n` : "chmod: missing operand\nTry 'chmod --help' for more information.\n");
    c.sh.lastErr = { cmd: 'chmod', code: 'USAGE' };
    return 1;
  }
  const spec = a.shift();
  if (applyMode(spec, { mode: 0, t: 'f' }) === null) {
    c.err(c.mac ? `chmod: Invalid file mode: ${spec}\n` : `chmod: invalid mode: ‘${spec}’\nTry 'chmod --help' for more information.\n`);
    c.sh.lastErr = { cmd: 'chmod', code: 'BAD_MODE', target: spec };
    return 1;
  }
  return eachTarget(c, a, rec, (label, n) => {
    if (!c.user.root && n.owner !== c.user.name) {
      c.err(c.mac ? `chmod: Unable to change file mode on ${label}: Operation not permitted\n` : `chmod: changing permissions of '${label}': Operation not permitted\n`);
      c.sh.lastErr = { cmd: 'chmod', code: 'EPERM', target: label };
      return false;
    }
    n.mode = applyMode(spec, n);
    if (verbose) c.println(c.mac ? label : `mode of '${label}' changed to 0${n.mode.toString(8).padStart(3, '0')}`);
    return true;
  });
}, { dir: { mac: '/bin' } });

const USERS = { mac: ['you', 'root', 'nobody', 'daemon', '_www'], linux: ['you', 'root', 'nobody', 'daemon', 'www-data', 'deploy'] };
const GROUPS = { mac: ['staff', 'wheel', 'admin', 'everyone', '_www'], linux: ['you', 'root', 'adm', 'sudo', 'users', 'www-data', 'deploy'] };
def('chown', c => {
  const a = c.args.slice();
  let rec = false;
  while (a.length && /^-[Rvfh]+$/.test(a[0])) { if (a.shift().includes('R')) rec = true; }
  if (a.length < 2) {
    if (c.mac) c.err('usage: chown [-fhnvx] [-R [-H | -L | -P]] owner[:group] file ...\n       chown [-fhnvx] [-R [-H | -L | -P]] :group file ...\n');
    else c.err(a.length ? `chown: missing operand after ‘${a[0]}’\nTry 'chown --help' for more information.\n` : "chown: missing operand\nTry 'chown --help' for more information.\n");
    c.sh.lastErr = { cmd: 'chown', code: 'USAGE' };
    return 1;
  }
  const [owner, group] = a.shift().split(/[:.]/);
  if (owner && !USERS[c.os].includes(owner)) { c.err(c.mac ? `chown: ${owner}: illegal user name\n` : `chown: invalid user: ‘${owner}’\n`); c.sh.lastErr = { cmd: 'chown', code: 'BAD_USER', target: owner }; return 1; }
  if (group && !GROUPS[c.os].includes(group)) { c.err(c.mac ? `chown: ${group}: illegal group name\n` : `chown: invalid group: ‘${owner}:${group}’\n`); c.sh.lastErr = { cmd: 'chown', code: 'BAD_USER', target: group }; return 1; }
  return eachTarget(c, a, rec, (label, n) => {
    if (!c.user.root) {
      c.err(c.mac ? `chown: ${label}: Operation not permitted\n` : `chown: changing ownership of '${label}': Operation not permitted\n`);
      c.sh.lastErr = { cmd: 'chown', code: 'EPERM', target: label };
      return false;
    }
    if (owner) n.owner = owner;
    if (group) n.group = group;
    return true;
  });
}, { dir: { mac: '/usr/sbin' } });

def('sudo', async c => {
  const sh = c.sh;
  let a = c.args.slice();
  if (!a.length) { c.err('usage: sudo -h | -K | -k | -V\nusage: sudo [-u user] command\n'); sh.lastErr = { cmd: 'sudo', code: 'USAGE' }; return 1; }
  if (a[0] === '-k' || a[0] === '-K') { sh.sudoOk = false; return 0; }
  const shellMode = a[0] === '-i' || a[0] === '-s' || (a[0] === 'su' && (a.length === 1 || a[1] === '-'));
  if (a[0] === '-u') a = a.slice(2);
  if (!sh.euser.root && !sh.sudoOk) {
    if (c.io.readLine) {
      sh.tip('sudo', {});
      let ok = false;
      for (let i = 0; i < 3 && !ok; i++) {
        const pw = await c.io.readLine(c.mac ? 'Password:' : `[sudo] password for ${sh.user.name}: `, { hidden: true });
        if (pw === null) { c.err('sudo: a password is required\n'); return 1; }
        if (pw.length) ok = true;
        else if (i < 2) c.err('Sorry, try again.\n');
      }
      if (!ok) { c.err('sudo: 3 incorrect password attempts\n'); sh.lastErr = { cmd: 'sudo', code: 'SUDO_PW' }; return 1; }
    }
    sh.sudoOk = true;
  }
  if (a[0] === '-v' || !a.length) return 0;
  if (shellMode) {
    const hist = sh.history;
    sh.push({ os: sh.os, fs: sh.fs, user: 'root', host: sh.host, root: true });
    sh.history = hist;
    sh.tip('rootshell', {});
    return 0;
  }
  const prev = sh.euser;
  sh.euser = sh.rootUser;
  try {
    return await sh.exec(a, c.sio, { alias: false });
  } finally {
    sh.euser = prev;
  }
});

def('su', async c => {
  if (c.user.root) return 0;
  if (c.io.readLine) await c.io.readLine('Password:', { hidden: true });
  c.err(c.mac ? 'su: Sorry\n' : 'su: Authentication failure\n');
  c.sh.lastErr = { cmd: 'su', code: 'SU' };
  return 1;
});

// ---------- processes ----------
export function allProcs(sh) {
  const list = sh.procs.map(p => ({ ...p }));
  list.push({ pid: 4242, user: sh.user.name, cpu: 0.0, mem: 0.1, cmd: sh.zsh ? '-zsh' : 'bash', tty: true });
  for (const j of sh.jobs) if (j.state !== 'done' && j.state !== 'killed') list.push({ pid: j.pid, user: sh.user.name, cpu: 0.0, mem: 0.0, cmd: j.cmd, tty: true, stopped: j.state === 'stopped' });
  return list.sort((a, b) => a.pid - b.pid);
}
const procName = p => p.cmd.split(' ')[0].split('/').pop().replace(/^-/, '');

def('ps', c => {
  const sh = c.sh;
  const f = c.args.join('').replace(/-/g, '');
  const all = /[aeAx]/.test(f);
  const wide = /[ufl]/.test(f);
  const self = { pid: sh.nextPid++, user: c.user.name, cpu: 0.0, mem: 0.0, cmd: ['ps', ...c.args].join(' '), tty: true };
  const list = [...allProcs(sh), self].filter(p => all || p.tty);
  const tty = p => (p.tty ? (c.mac ? 's000' : 'pts/0') : c.mac ? '??' : '?');
  const clip = s => (c.tty ? s.slice(0, c.cols) : s);
  if (wide) {
    const now = new Date();
    const start = `${p2(Math.max(0, now.getHours() - 2))}:${p2(now.getMinutes())}`;
    if (c.mac) {
      c.println('USER               PID  %CPU %MEM      VSZ    RSS   TT  STAT STARTED      TIME COMMAND');
      for (const p of list) c.println(clip(`${p.user.padEnd(16)} ${String(p.pid).padStart(5)} ${p.cpu.toFixed(1).padStart(5)} ${p.mem.toFixed(1).padStart(4)} ${String(408000000 + p.pid * 911).padStart(9)} ${String(Math.round(p.mem * 163000) + 1200).padStart(6)}   ${tty(p).padEnd(4)} ${(p.stopped ? 'T' : p.cpu > 50 ? 'R' : 'S').padEnd(4)} ${(start + (now.getHours() < 12 ? 'AM' : 'PM')).padEnd(7)} ${('0:' + p2(Math.round(p.cpu * 3) % 60) + '.' + p2(p.pid % 100)).padStart(9)} ${p.cmd}`));
    } else {
      c.println('USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND');
      for (const p of list) c.println(clip(`${p.user.padEnd(8)} ${String(p.pid).padStart(7)} ${p.cpu.toFixed(1).padStart(4)} ${p.mem.toFixed(1).padStart(4)} ${String(10000 + (p.pid * 37) % 900000).padStart(6)} ${String(Math.round(p.mem * 1630) + 800).padStart(5)} ${tty(p).padEnd(8)} ${(p.stopped ? 'T' : p.cpu > 50 ? 'R' : p.pid === self.pid ? 'R+' : 'S').padEnd(4)} ${start}   ${'0:' + p2(Math.round(p.cpu * 3) % 60)} ${p.cmd}`));
    }
    return;
  }
  if (c.mac) {
    c.println('  PID TTY           TIME CMD');
    for (const p of list) if (p !== self || all) c.println(clip(`${String(p.pid).padStart(5)} ${(p.tty ? 'ttys000' : '??').padEnd(8)}   0:00.${p2(p.pid % 60)} ${p.cmd}`));
  } else {
    c.println('    PID TTY          TIME CMD');
    for (const p of list) c.println(clip(`${String(p.pid).padStart(7)} ${tty(p).padEnd(8)} 00:00:${p2(Math.round(p.cpu) % 60)} ${p.tty ? procName(p) : p.cmd}`));
  }
}, { dir: { mac: '/bin' } });

class Top {
  constructor(sh, fancy) {
    this.sh = sh;
    this.fancy = fancy;
    this.interval = 2000;
    this.done = false;
    this.rows = 24;
    this.cols = 80;
    this.snap();
  }
  snap() {
    this.list = allProcs(this.sh).map(p => ({ ...p, cpu: Math.max(0, p.cpu + (p.cpu > 50 ? (Math.random() - 0.5) * 4 : (Math.random() - 0.4) * 0.6)) })).sort((a, b) => b.cpu - a.cpu);
  }
  resize(rows, cols) { this.rows = rows; this.cols = cols; }
  tick() { this.snap(); }
  key(k) { if (k === 'q' || k === 'C-c' || k === 'F10') this.done = true; }
  render() {
    const mac = this.sh.os === 'mac';
    const d = new Date();
    const time = `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
    const used = this.list.reduce((s, p) => s + p.cpu, 0);
    const lines = [];
    const L = (text, spans = []) => lines.push({ text: text.slice(0, this.cols), spans });
    if (this.fancy) {
      const bar = (label, frac, text) => {
        const w = 26;
        const fill = Math.round(Math.min(1, frac) * w);
        const s = `  ${label}[${'|'.repeat(fill)}${' '.repeat(w - fill)}${text.padStart(8)}]`;
        return { s, spans: [{ a: 2, b: 2 + label.length, cls: 'c6' }, { a: 3 + label.length, b: 3 + label.length + fill, cls: 'c2' }] };
      };
      const b1 = bar('CPU', used / 100, used.toFixed(1) + '%');
      const b2 = bar('Mem', 0.51, '8.0G/16G');
      L(b1.s + `   Tasks: ${this.list.length + 80}, 312 thr; 1 running`, b1.spans);
      L(b2.s + '   Load average: 0.52 0.61 0.70', b2.spans);
      L('');
      const h = '    PID USER       PRI  NI  CPU%  MEM%   TIME+  Command';
      L(h.padEnd(this.cols), [{ a: 0, b: this.cols, cls: 'inv' }]);
      for (const p of this.list.slice(0, this.rows - 5)) L(`${String(p.pid).padStart(7)} ${p.user.slice(0, 9).padEnd(9)}   20   0 ${p.cpu.toFixed(1).padStart(5)} ${p.mem.toFixed(1).padStart(5)}  0:${p2(Math.round(p.cpu * 3) % 60)}.${p2(p.pid % 100)}  ${p.cmd}`, p.cpu > 50 ? [{ a: 27, b: 32, cls: 'c1' }] : []);
      while (lines.length < this.rows - 1) L('');
      const foot = 'F1Help  F2Setup  F3Search  F4Filter  F5Tree  F6SortBy  F9Kill  F10Quit   (q quits)';
      L(foot.padEnd(this.cols), [{ a: 0, b: this.cols, cls: 'inv' }]);
    } else if (mac) {
      L(`Processes: ${this.list.length + 400} total, 2 running, ${this.list.length + 398} sleeping, 2104 threads`.padEnd(this.cols - 9) + time);
      L(`Load Avg: 1.52, 1.61, 1.70  CPU usage: ${(used * 0.6).toFixed(2)}% user, ${(used * 0.4).toFixed(2)}% sys, ${Math.max(0, 100 - used).toFixed(2)}% idle`);
      L('PhysMem: 12G used (2104M wired, 311M compressor), 3891M unused.');
      L('');
      L('PID    COMMAND          %CPU  TIME     #TH   MEM    STATE', [{ a: 0, b: 55, cls: 'bold' }]);
      for (const p of this.list.slice(0, this.rows - 6)) L(`${String(p.pid).padEnd(6)} ${procName(p).slice(0, 16).padEnd(16)} ${p.cpu.toFixed(1).padStart(4)}  00:${p2(Math.round(p.cpu * 3) % 60)}.${p2(p.pid % 100)} ${String(1 + (p.pid % 9)).padEnd(5)} ${(Math.round(p.mem * 160) + 1 + 'M').padEnd(6)} ${p.cpu > 50 ? 'running' : 'sleeping'}`);
    } else {
      L(`top - ${time} up 3 days,  2:14,  1 user,  load average: 0.52, 0.61, 0.70`);
      L(`Tasks: ${this.list.length + 200} total,   1 running, ${this.list.length + 199} sleeping,   0 stopped,   0 zombie`);
      L(`%Cpu(s): ${(used * 0.6).toFixed(1).padStart(4)} us, ${(used * 0.4).toFixed(1).padStart(4)} sy,  0.0 ni, ${Math.max(0, 100 - used).toFixed(1).padStart(4)} id,  0.0 wa,  0.0 hi,  0.0 si,  0.0 st`);
      L('MiB Mem :  15921.4 total,   3891.2 free,   8012.3 used,   4017.9 buff/cache');
      L('MiB Swap:   4096.0 total,   4096.0 free,      0.0 used.   7496.5 avail Mem');
      L('');
      const h = '    PID USER      PR  NI    VIRT    RES    SHR S  %CPU  %MEM     TIME+ COMMAND';
      L(h.padEnd(this.cols), [{ a: 0, b: this.cols, cls: 'inv' }]);
      for (const p of this.list.slice(0, this.rows - 8)) L(`${String(p.pid).padStart(7)} ${p.user.slice(0, 8).padEnd(8)}  20   0 ${String(10000 + (p.pid * 37) % 900000).padStart(7)} ${String(Math.round(p.mem * 1630) + 800).padStart(6)} ${String(3000 + (p.pid % 4000)).padStart(6)} ${p.cpu > 50 ? 'R' : 'S'} ${p.cpu.toFixed(1).padStart(5)} ${p.mem.toFixed(1).padStart(5)}   0:${p2(Math.round(p.cpu * 3) % 60)}.${p2(p.pid % 100)} ${procName(p)}`);
    }
    return { lines, cursor: null };
  }
  help() {
    return { mode: this.fancy ? 'htop' : 'top', keys: [['q', 'quit'], ['', 'the list refreshes every 2 seconds; the busiest process is at the top']] };
  }
}
const topCmd = fancy => async c => {
  if (!c.tty || !c.io.fullscreen) { c.println(new Top(c.sh, false).render().lines.map(l => l.text).join('\n')); return 0; }
  await c.io.fullscreen(new Top(c.sh, fancy));
};
def('top', topCmd(false));
def('htop', topCmd(true), { pkg: 'htop' });

function killPid(c, pid, sig) {
  const sh = c.sh;
  const fail = (text, code) => {
    c.err(sh.zsh ? `kill: kill ${pid} failed: ${text.toLowerCase()}\n` : `bash: kill: (${pid}) - ${text}\n`);
    sh.lastErr = { cmd: 'kill', code, target: String(pid) };
    return false;
  };
  const job = sh.jobs.find(j => j.pid === pid);
  if (job) { job.state = 'killed'; return true; }
  if (pid === 4242) return true; // an interactive shell ignores a plain kill
  const i = sh.procs.findIndex(p => p.pid === pid);
  if (i < 0) return fail('No such process', 'ESRCH');
  const p = sh.procs[i];
  if (p.user !== c.user.name && !c.user.root) return fail('Operation not permitted', 'EPERM');
  if (p.stubborn && sig !== 'KILL') { sh.tip('stubborn', { pid }); return true; }
  sh.procs.splice(i, 1);
  return true;
}
const findJob = (sh, spec) => {
  if (!spec || spec === '%' || spec === '%%' || spec === '%+') return sh.jobs.at(-1);
  const n = parseInt(spec.replace(/^%/, ''), 10);
  return sh.jobs.find(j => j.id === n);
};
const noJob = (c, spec) => {
  const sh = c.sh;
  c.err(sh.zsh ? `${c.name}: ${spec ? spec + ': no such job' : 'no current job'}\n` : `bash: ${c.name}: ${spec || 'current'}: no such job\n`);
  sh.lastErr = { cmd: c.name, code: 'NOJOB', target: spec || '' };
  return 1;
};

def('kill', c => {
  const sh = c.sh;
  const a = c.args.slice();
  let sig = 'TERM';
  if (a[0] && /^-\w+$/.test(a[0])) {
    const s = a.shift().slice(1);
    if (s === 'l') { c.println('HUP INT QUIT ILL TRAP ABRT EMT FPE KILL BUS SEGV SYS PIPE ALRM TERM URG STOP TSTP CONT'); return 0; }
    sig = s === 's' ? a.shift() ?? 'TERM' : { 9: 'KILL', 15: 'TERM', 2: 'INT', 1: 'HUP' }[s] || s.replace(/^SIG/, '');
  }
  if (!a.length) {
    c.err(sh.zsh ? 'kill: not enough arguments\n' : 'kill: usage: kill [-s sigspec | -n signum | -sigspec] pid | jobspec ... or kill -l [sigspec]\n');
    sh.lastErr = { cmd: 'kill', code: 'USAGE' };
    return 1;
  }
  let st = 0;
  for (const t of a) {
    if (t.startsWith('%')) {
      const j = findJob(sh, t);
      if (!j) { c.err(sh.zsh ? `kill: ${t}: no such job\n` : `bash: kill: ${t}: no such job\n`); sh.lastErr = { cmd: 'kill', code: 'NOJOB', target: t }; st = 1; }
      else j.state = 'killed';
      continue;
    }
    if (!/^\d+$/.test(t)) {
      c.err(sh.zsh ? `kill: illegal pid: ${t}\n` : `bash: kill: ${t}: arguments must be process or job IDs\n`);
      sh.lastErr = { cmd: 'kill', code: 'BAD_PID', target: t };
      st = 1;
      continue;
    }
    if (!killPid(c, +t, sig)) st = 1;
  }
  return st;
}, { builtin: true, bin: true });

const byName = exact => c => {
  const sh = c.sh;
  const a = c.args.filter(x => !x.startsWith('-'));
  const sig = c.args.includes('-9') || c.args.includes('-KILL') ? 'KILL' : 'TERM';
  if (!a.length) return c.missing();
  const hits = allProcs(sh).filter(p => p.pid !== 4242 && (exact ? procName(p) === a[0] : p.cmd.includes(a[0])) && (c.name === 'pgrep' || p.user === c.user.name || c.user.root));
  if (!hits.length) {
    if (c.name === 'killall') { c.err(c.mac ? 'No matching processes belonging to you were found\n' : `${a[0]}: no process found\n`); sh.lastErr = { cmd: 'killall', code: 'ESRCH', target: a[0] }; }
    return 1;
  }
  for (const p of hits) { if (c.name === 'pgrep') c.println(String(p.pid)); else killPid(c, p.pid, sig); }
  return 0;
};
def('killall', byName(true));
def('pkill', byName(false));
def('pgrep', byName(false));

def('jobs', c => {
  for (const j of c.sh.jobs) if (j.state === 'running' || j.state === 'stopped') c.println(c.sh.jobLine(j, j.state === 'stopped' ? 'suspended' : 'running'));
}, { builtin: true });

def('fg', async c => {
  const sh = c.sh;
  const j = findJob(sh, c.args[0]);
  if (!j || j.state === 'fg') return noJob(c, c.args[0]);
  const remain = j.state === 'stopped' ? j.remain : Math.max(0, (j.end - Date.now()) * sh.speed);
  c.println(sh.zsh ? `[${j.id}]  + continued  ${j.cmd}` : j.cmd);
  j.state = 'fg';
  try {
    await sh.sleep(remain);
    sh.jobs = sh.jobs.filter(x => x !== j);
    return 0;
  } catch (e) {
    if (!(e instanceof Signal)) throw e;
    if (e.sig === 'TSTP') {
      j.state = 'stopped';
      j.remain = e.remain;
      c.println(sh.zsh ? `zsh: suspended  ${j.cmd}` : sh.jobLine(j, 'suspended'));
      return 148;
    }
    sh.jobs = sh.jobs.filter(x => x !== j);
    throw e;
  }
}, { builtin: true });

def('bg', c => {
  const sh = c.sh;
  const j = c.args[0] ? findJob(sh, c.args[0]) : sh.jobs.findLast(x => x.state === 'stopped');
  if (!j) return noJob(c, c.args[0]);
  if (j.state === 'stopped') { j.state = 'running'; j.end = Date.now() + j.remain / sh.speed; }
  c.println(sh.zsh ? `[${j.id}]  + continued  ${j.cmd}` : `[${j.id}]+ ${j.cmd} &`);
}, { builtin: true });

def('sleep', async c => {
  const s = parseFloat(c.args[0]);
  if (isNaN(s)) {
    if (!c.args.length) return c.missing();
    c.err(c.mac ? 'usage: sleep number[unit] [...]\n' : `sleep: invalid time interval ‘${c.args[0]}’\n`);
    c.sh.lastErr = { cmd: 'sleep', code: 'USAGE' };
    return 1;
  }
  const unit = { m: 60, h: 3600 }[c.args[0].slice(-1)] || 1;
  await c.sh.sleep(s * unit * 1000);
}, { dir: { mac: '/bin' } });

// ---------- services (Linux) ----------
const SERVICES = { ssh: 'OpenBSD Secure Shell server', cron: 'Regular background program processing daemon', nginx: 'A high performance web server and a reverse proxy server' };
export const services = fs => (fs.root.services ??= { ssh: { active: true, enabled: true }, cron: { active: true, enabled: true } });
def('systemctl', c => {
  const [verb, raw] = c.args.filter(a => !a.startsWith('-'));
  const svc = services(c.fs);
  if (!verb || verb === 'list-units') {
    c.println('  UNIT           LOAD   ACTIVE SUB     DESCRIPTION');
    for (const [k, v] of Object.entries(svc)) c.println(`  ${(k + '.service').padEnd(14)} loaded ${v.active ? 'active running' : 'inactive dead  '} ${SERVICES[k]}`);
    return 0;
  }
  if (!raw) { c.err('Too few arguments.\n'); c.sh.lastErr = { cmd: 'systemctl', code: 'USAGE' }; return 1; }
  const name = raw.replace(/\.service$/, '');
  const s = svc[name];
  if (!s) { c.err(`${verb === 'status' ? 'Unit' : `Failed to ${verb} ${name}.service: Unit`} ${name}.service ${verb === 'status' ? 'could not be found' : 'not found'}.\n`); c.sh.lastErr = { cmd: 'systemctl', code: 'NO_UNIT', target: name }; return verb === 'status' ? 4 : 5; }
  if (verb === 'status') {
    const dot = s.active ? (c.tty ? sgr('1;32', '●') : '●') : '○';
    c.println(`${dot} ${name}.service - ${SERVICES[name]}`);
    c.println(`     Loaded: loaded (/usr/lib/systemd/system/${name}.service; ${s.enabled ? 'enabled' : 'disabled'}; preset: enabled)`);
    c.println(`     Active: ${s.active ? (c.tty ? sgr('1;32', 'active (running)') : 'active (running)') + ' since ' + fullDate(Date.now() - 8 * 3600e3) + '; 8h ago' : 'inactive (dead)'}`);
    if (s.active) c.println(`   Main PID: ${900 + name.length} (${name})\n      Tasks: 3 (limit: 18928)\n     Memory: 8.4M`);
    return s.active ? 0 : 3;
  }
  if (verb === 'is-active') { c.println(s.active ? 'active' : 'inactive'); return s.active ? 0 : 3; }
  if (!['start', 'stop', 'restart', 'reload', 'enable', 'disable'].includes(verb)) { c.err(`Unknown command verb '${verb}'.\n`); return 1; }
  if (!c.user.root) {
    c.err(`Failed to ${verb} ${name}.service: Interactive authentication required.\nSee system logs and 'systemctl status ${name}.service' for details.\n`);
    c.sh.lastErr = { cmd: 'systemctl', code: 'SVC_ROOT', target: `${verb} ${name}` };
    return 1;
  }
  if (verb === 'start' || verb === 'restart') s.active = true;
  else if (verb === 'stop') s.active = false;
  else if (verb === 'enable') { s.enabled = true; c.println(`Created symlink /etc/systemd/system/multi-user.target.wants/${name}.service → /usr/lib/systemd/system/${name}.service.`); }
  else if (verb === 'disable') { s.enabled = false; c.println(`Removed "/etc/systemd/system/multi-user.target.wants/${name}.service".`); }
}, { os: 'linux', complete: (sh, words, word) => (words.length === 1 ? ['status', 'start', 'stop', 'restart', 'enable', 'disable', 'is-active'] : Object.keys(services(sh.fs))).filter(x => x.startsWith(word)).map(v => ({ v })) });

// ---------- macOS extras ----------
def('pbcopy', async c => {
  c.sh.clip = await c.input();
  try { globalThis.navigator?.clipboard?.writeText(c.sh.clip)?.catch(() => {}); } catch { /* clipboard not available */ }
}, { os: 'mac' });
def('pbpaste', c => c.out(c.sh.clip), { os: 'mac' });
def('say', async c => {
  const text = c.args.length ? c.args.join(' ') : await c.input();
  c.sh.tip('say', { text });
}, { os: 'mac' });
