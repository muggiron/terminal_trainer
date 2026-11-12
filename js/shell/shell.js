// The simulated shell: expansion, pipelines, redirection, jobs, completion.
// macOS mode behaves like zsh, Linux mode like bash.

import { FsError, errText, norm, basename } from './vfs.js';
import { parse, Incomplete, ParseError, wordText } from './parser.js';
import { commands, Signal, Exit } from './registry.js';
import { parseOpts, stripAnsi, sgr, fmtErr, quoteArg, globToRe } from './util.js';
import { REFMAP } from '../data/reference.js';
import { providerOf } from './packages.js';

class NoMatch extends Error {
  constructor(pat) { super(pat); this.pat = pat; }
}
class HistError extends Error {}

const SESSION_KEYS = ['os', 'zsh', 'fs', 'host', 'user', 'rootUser', 'euser', 'home', 'cwd', 'env', 'exported', 'aliases', 'jobs', 'sudoOk', 'procs', 'exitMsg'];

function baseProcs(os, user) {
  const P = (pid, u, cpu, mem, cmd) => ({ pid, user: u, cpu, mem, cmd });
  return os === 'mac'
    ? [P(1, 'root', 0.1, 0.1, '/sbin/launchd'), P(88, 'root', 0.0, 0.1, '/usr/libexec/logd'), P(301, '_windowserver', 3.2, 1.4, '/System/Library/PrivateFrameworks/SkyLight.framework/Resources/WindowServer -daemon'), P(412, user, 0.3, 0.9, '/System/Library/CoreServices/Finder.app/Contents/MacOS/Finder'), P(455, user, 0.1, 0.5, '/System/Library/CoreServices/Dock.app/Contents/MacOS/Dock'), P(520, user, 1.1, 0.8, '/System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal'), P(611, user, 2.4, 3.1, '/Applications/Safari.app/Contents/MacOS/Safari')]
    : [P(1, 'root', 0.0, 0.1, '/sbin/init splash'), P(2, 'root', 0.0, 0.0, '[kthreadd]'), P(412, 'root', 0.0, 0.2, '/usr/lib/systemd/systemd-journald'), P(780, 'root', 0.0, 0.0, '/usr/sbin/cron -f -P'), P(802, 'root', 0.0, 0.1, 'sshd: /usr/sbin/sshd -D [listener]'), P(1320, user, 0.0, 0.1, '/usr/lib/systemd/systemd --user'), P(1512, user, 2.8, 4.2, '/usr/bin/gnome-shell'), P(2301, user, 0.9, 0.7, '/usr/libexec/gnome-terminal-server')];
}

export function helpText(name) {
  const r = REFMAP[name];
  if (!r) return null;
  let s = `Usage: ${r.syn}\n${r.sum}.\n`;
  if (r.opts.length) {
    const w = Math.max(...r.opts.map(o => o[0].length));
    s += '\nOptions:\n' + r.opts.map(o => `  ${o[0].padEnd(w)}  ${o[1]}`).join('\n') + '\n';
  }
  if (r.ex.length) s += '\nExamples:\n' + r.ex.map(e => `  ${e[0]}\n      ${e[1]}`).join('\n') + '\n';
  return s;
}

function braceExpand(parts) {
  for (let pi = 0; pi < parts.length; pi++) {
    const p = parts[pi];
    if (p.q !== 0 || p.s === undefined) continue;
    const s = p.s;
    for (let a = s.indexOf('{'); a >= 0; a = s.indexOf('{', a + 1)) {
      let depth = 0, b = -1;
      const commas = [];
      for (let j = a; j < s.length; j++) {
        if (s[j] === '{') depth++;
        else if (s[j] === '}') { if (--depth === 0) { b = j; break; } }
        else if (s[j] === ',' && depth === 1) commas.push(j);
      }
      if (b < 0) break;
      const body = s.slice(a + 1, b);
      let alts = null;
      let m;
      if (commas.length) {
        alts = [];
        let st = a + 1;
        for (const cm of [...commas, b]) { alts.push(s.slice(st, cm)); st = cm + 1; }
      } else if ((m = body.match(/^(-?\d+)\.\.(-?\d+)$/))) {
        alts = [];
        const from = +m[1], to = +m[2], step = from <= to ? 1 : -1;
        for (let v = from; step > 0 ? v <= to : v >= to; v += step) alts.push(String(v));
      } else if ((m = body.match(/^([a-zA-Z])\.\.([a-zA-Z])$/))) {
        alts = [];
        const from = m[1].charCodeAt(0), to = m[2].charCodeAt(0), step = from <= to ? 1 : -1;
        for (let v = from; step > 0 ? v <= to : v >= to; v += step) alts.push(String.fromCharCode(v));
      }
      if (!alts) continue;
      const res = [];
      for (const alt of alts) res.push(...braceExpand([...parts.slice(0, pi), { s: s.slice(0, a) + alt + s.slice(b + 1), q: 0 }, ...parts.slice(pi + 1)]));
      return res;
    }
  }
  return [parts];
}

// Integer arithmetic for $(( ... )): + - * / % and parentheses.
function arith(src) {
  const t = src.match(/\d+|[-+*/%()]/g) || [];
  let i = 0;
  const atom = () => {
    if (t[i] === '(') { i++; const v = sum(); i++; return v; }
    if (t[i] === '-') { i++; return -atom(); }
    if (t[i] === '+') { i++; return atom(); }
    return parseInt(t[i++], 10) || 0;
  };
  const product = () => {
    let v = atom();
    while (t[i] === '*' || t[i] === '/' || t[i] === '%') {
      const op = t[i++];
      const r = atom();
      v = op === '*' ? v * r : r === 0 ? 0 : op === '/' ? Math.trunc(v / r) : v % r;
    }
    return v;
  };
  const sum = () => {
    let v = product();
    while (t[i] === '+' || t[i] === '-') v = t[i++] === '+' ? v + product() : v - product();
    return v;
  };
  return sum();
}

const isAssign = w => w.parts[0].q === 0 && w.parts[0].sub === undefined && /^[A-Za-z_]\w*=/.test(w.parts[0].s);
const joinPath = (base, name) => (base === '' ? name : base.endsWith('/') ? base + name : base + '/' + name);

export class Shell {
  constructor({ os = 'mac', fs, io = null, onEvent = null, speed = 1 }) {
    this.io = io || { buf: '', write(s) { this.buf += s; }, cols: 80, rows: 24 };
    this.onEvent = onEvent || (() => {});
    this.speed = speed;
    this.stack = [];
    this.history = [];
    this.status = 0;
    this.trace = [];
    this.captured = '';
    this.remotes = {};
    this.clip = '';
    this.visits = {};
    this.nextPid = 5001;
    this.pos = [];
    this.aliasStack = [];
    this.session({ os, fs, user: 'you', host: os === 'mac' ? 'MacBook-Pro' : 'ubuntu' });
  }

  session({ os, fs, user, host, root = false, exitMsg = '' }) {
    this.os = os;
    this.zsh = os === 'mac';
    this.fs = fs;
    this.host = host;
    this.exitMsg = exitMsg;
    this.rootUser = { name: 'root', group: os === 'mac' ? 'wheel' : 'root', root: true };
    this.user = root ? this.rootUser : { name: user, group: os === 'mac' ? 'staff' : user, root: false };
    this.euser = this.user;
    this.home = root ? (os === 'mac' ? '/var/root' : '/root') : os === 'mac' ? `/Users/${user}` : `/home/${user}`;
    this.cwd = this.fs.get(this.home) ? this.home : '/';
    this.env = {
      HOME: this.home, USER: this.user.name, LOGNAME: this.user.name, SHELL: this.zsh ? '/bin/zsh' : '/bin/bash',
      PATH: os === 'mac' ? '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin' : '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      PWD: this.cwd, OLDPWD: this.cwd, TERM: 'xterm-256color', LANG: 'en_US.UTF-8',
    };
    this.exported = new Set(Object.keys(this.env));
    this.aliases = {};
    this.jobs = [];
    this.sudoOk = root;
    this.procs = baseProcs(os, user);
  }

  push(sess) {
    this.stack.push(Object.fromEntries(SESSION_KEYS.map(k => [k, this[k]])));
    this.session(sess);
  }

  // Read the startup files, as a real shell does when a terminal opens.
  async init() {
    for (const f of this.zsh ? ['.zprofile', '.zshrc'] : ['.bashrc']) {
      const n = this.fs.get(`${this.home}/${f}`);
      if (n && n.t === 'f') await this.sourceText(n.data);
    }
    return this;
  }

  // ---------- output ----------
  write(s) {
    this.captured += s;
    this.io.write(s);
  }
  termSio() {
    return { stdin: null, out: s => this.write(s), err: s => this.write(s), tty: true };
  }
  // Ask the trainer to show a teaching note. Silent while startup files or scripts run.
  tip(id, data = {}) {
    if (!this.quiet) this.onEvent({ type: 'tip', id, data, sh: this });
  }

  prompt() {
    let p = this.cwd;
    const hash = this.user.root ? '#' : null;
    if (this.zsh) {
      const d = p === this.home ? '~' : p === '/' ? '/' : basename(p);
      return `${this.user.name}@${this.host} ${d} ${hash || '%'} `;
    }
    if (p === this.home) p = '~';
    else if (p.startsWith(this.home + '/')) p = '~' + p.slice(this.home.length);
    return sgr('1;32', `${this.user.name}@${this.host}`) + ':' + sgr('1;34', p) + (hash || '$') + ' ';
  }
  prompt2(kind) {
    if (!this.zsh) return '> ';
    return { dquote: 'dquote> ', quote: 'quote> ', bquote: 'bquote> ', pipe: 'pipe> ', cmdand: 'cmdand> ', cmdor: 'cmdor> ', cmdsubst: 'cmdsubst> ' }[kind] || '> ';
  }

  // ---------- running a line ----------
  async run(line) {
    this.trace = [];
    this.captured = '';
    this.lastErr = null;
    let src = line;
    let st = 0;
    let exited = false;
    let bang = false;
    try {
      const h = this.histExpand(src);
      if (h.changed) { src = h.src; bang = true; this.write(src + '\n'); }
      if (src.trim()) this.history.push(src.trim());
      this.curLine = src;
      st = await this.runList(parse(src), this.termSio());
    } catch (e) {
      if (e instanceof Signal) st = this.onSignal(e);
      else if (e instanceof Exit) { st = e.code; exited = true; }
      else if (e instanceof ParseError || e instanceof Incomplete) st = this.syntaxError(e, s => this.write(s));
      else if (e instanceof HistError) { this.write(e.message + '\n'); this.lastErr = { code: 'HIST' }; st = 1; }
      else { this.write(`trainer: internal error: ${e.message}\n`); console.error(e); st = 1; }
    }
    this.status = st;
    if (exited) this.doExit();
    const ev = { type: 'cmd', line: src, cmds: this.trace, exit: st, out: stripAnsi(this.captured), err: this.lastErr, bang, sh: this };
    this.onEvent(ev);
    return ev;
  }

  syntaxError(e, err) {
    const near = e instanceof Incomplete ? '\\n' : e.near;
    err(this.zsh ? `zsh: parse error near \`${near}'\n` : `bash: syntax error near unexpected token \`${near === '\\n' ? 'newline' : near}'\n`);
    this.lastErr = { code: 'SYNTAX', target: near };
    return this.zsh ? 1 : 2;
  }

  doExit() {
    if (this.stack.length) {
      const msg = this.exitMsg;
      Object.assign(this, this.stack.pop());
      if (msg) this.write(msg + '\n');
    } else this.onEvent({ type: 'exit', sh: this });
  }

  onSignal(e) {
    if (e.sig !== 'TSTP') return 130;
    let job = this.fgJob;
    if (!job) job = this.addJob(this.curLine.trim(), 0, 'stopped');
    job.state = 'stopped';
    job.remain = e.remain;
    this.write((this.zsh ? `zsh: suspended  ${job.cmd}` : this.jobLine(job, 'suspended')) + '\n');
    return 148;
  }

  histExpand(src) {
    if (!src.includes('!')) return { src, changed: false };
    const H = this.history;
    let out = '';
    let changed = false;
    let inS = false;
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (ch === "'") inS = !inS;
      if (ch === '\\') { out += ch + (src[i + 1] ?? ''); i++; continue; }
      if (ch !== '!' || inS) { out += ch; continue; }
      const rest = src.slice(i + 1);
      let rep, len, m;
      if (rest[0] === '!') { rep = H.at(-1); len = 1; }
      else if (rest[0] === '$') { rep = H.at(-1)?.trim().split(/\s+/).pop(); len = 1; }
      else if ((m = rest.match(/^-?\d+/))) { const n = +m[0]; rep = n < 0 ? H.at(n) : H[n - 1]; len = m[0].length; }
      else if ((m = rest.match(/^[A-Za-z][\w.-]*/))) { rep = H.findLast(h => h.startsWith(m[0])); len = m[0].length; }
      else { out += ch; continue; }
      if (rep === undefined) {
        const what = rest.slice(0, len);
        throw new HistError(this.zsh ? `zsh: event not found: ${what === '!' ? '' : what}` : `bash: !${what}: event not found`);
      }
      out += rep;
      i += len;
      changed = true;
    }
    return { src: out, changed };
  }

  async runList(ast, sio) {
    let st = 0;
    for (const item of ast.items) {
      st = item.bg ? await this.runBg(item, sio) : await this.runAndOr(item, sio);
      this.status = st;
    }
    return st;
  }

  async runAndOr(item, sio) {
    let st = 0;
    for (let i = 0; i < item.andor.length; i++) {
      if (i > 0) {
        const prev = item.andor[i - 1].op;
        if ((prev === '&&' && st !== 0) || (prev === '||' && st === 0)) continue;
      }
      st = await this.runPipe(item.andor[i].pipe, sio);
      this.status = st;
    }
    return st;
  }

  async runBg(item, sio) {
    const text = this.curLine.replace(/\s*&\s*$/, '').trim();
    const only = item.andor.length === 1 && item.andor[0].pipe.length === 1 ? item.andor[0].pipe[0] : null;
    let ms = 0;
    if (only && only.words.length === 2 && wordText(only.words[0]) === 'sleep') ms = (parseFloat(wordText(only.words[1])) || 0) * 1000;
    const job = this.addJob(text, ms, 'running');
    this.trace.push({ name: '&', args: [text], exit: 0, ok: true });
    sio.err(`[${job.id}] ${job.pid}\n`);
    if (!ms) await this.runAndOr(item, sio);
    return 0;
  }

  async runPipe(cmds, sio) {
    let input = sio.stdin;
    let st = 0;
    for (let i = 0; i < cmds.length; i++) {
      const last = i === cmds.length - 1;
      let buf = '';
      st = await this.runSimple(cmds[i], { stdin: input, out: last ? sio.out : s => { buf += s; }, err: sio.err, tty: last && sio.tty });
      input = buf;
    }
    return st;
  }

  shErr(code, target, err, extra = {}) {
    const t = errText(code);
    err(this.zsh ? `zsh: ${t.toLowerCase()}: ${target}\n` : `bash: ${target}: ${t}\n`);
    this.lastErr = { cmd: 'shell', code, target, ...extra };
  }

  async runSimple(cmd, sio) {
    const argv = [];
    const assigns = [];
    let { stdin, out, err, tty } = sio;
    try {
      let wi = 0;
      for (; wi < cmd.words.length && isAssign(cmd.words[wi]); wi++) {
        const s = (await this.expandWord(cmd.words[wi], false))[0] ?? '';
        const k = s.indexOf('=');
        assigns.push([s.slice(0, k), s.slice(k + 1)]);
      }
      for (; wi < cmd.words.length; wi++) argv.push(...(await this.expandWord(cmd.words[wi])));

      for (const r of cmd.redirs) {
        if (r.op === '2>&1') { err = out; continue; }
        if (r.op === '>&2') { out = err; tty = sio.tty; continue; }
        const t = (await this.expandWord(r.target))[0] ?? '';
        const path = norm(t, this.cwd);
        try {
          if (r.op === '<') { stdin = this.fs.read(path, this.euser); continue; }
          const append = r.op.endsWith('>>');
          const old = this.fs.get(path, { user: this.euser });
          if (!append && old && old.t === 'f' && old.data.length && argv.length) this.tip('overwrite', { file: t });
          this.fs.write(path, '', this.euser, { append });
          const w = s => this.fs.write(path, s, this.euser, { append: true });
          if (r.op.startsWith('2')) err = w;
          else if (r.op.startsWith('&')) { out = w; err = w; tty = false; }
          else { out = w; tty = false; }
        } catch (e) {
          if (!(e instanceof FsError)) throw e;
          this.shErr(e.code, t, sio.err, { redirect: true });
          return 1;
        }
      }
    } catch (e) {
      if (e instanceof NoMatch) {
        sio.err(`zsh: no matches found: ${e.pat}\n`);
        this.lastErr = { cmd: 'shell', code: 'NOMATCH', target: e.pat };
        return 1;
      }
      throw e;
    }

    if (!argv.length) {
      for (const [k, v] of assigns) this.env[k] = v;
      return 0;
    }
    const saved = assigns.map(([k]) => [k, this.env[k]]);
    for (const [k, v] of assigns) this.env[k] = v;
    try {
      const first = cmd.words[assigns.length];
      const aliasOk = first.parts.length === 1 && first.parts[0].q === 0;
      return await this.exec(argv, { stdin, out, err, tty }, { alias: aliasOk });
    } finally {
      for (const [k, v] of saved) { if (v === undefined) delete this.env[k]; else this.env[k] = v; }
    }
  }

  // Run a command given as a list of words.
  async exec(argv, sio, { alias = true } = {}) {
    const name = argv[0];
    if (alias && this.aliases[name] !== undefined && !this.aliasStack.includes(name)) {
      const line = this.aliases[name] + ' ' + argv.slice(1).map(quoteArg).join(' ');
      this.aliasStack.push(name);
      try {
        return await this.runList(parse(line), sio);
      } catch (e) {
        if (e instanceof ParseError || e instanceof Incomplete) return this.syntaxError(e, sio.err);
        throw e;
      } finally {
        this.aliasStack.pop();
      }
    }
    const rec = { name: basename(name), args: argv.slice(1), exit: null, ok: false };
    this.trace.push(rec);
    try {
      rec.exit = await this.dispatch(argv, sio);
    } catch (e) {
      rec.exit = e instanceof Exit ? e.code : 130;
      throw e;
    } finally {
      rec.ok = rec.exit === 0;
    }
    return rec.exit;
  }

  which(name) {
    for (const d of (this.env.PATH || '').split(':')) {
      if (!d) continue;
      try {
        const node = this.fs.get(`${d}/${name}`);
        if (node && node.t === 'f' && node.mode & 0o111) return { path: `${d}/${name}`, node };
      } catch { /* not a directory */ }
    }
    return null;
  }

  notFound(name, sio) {
    const prov = this.os === 'linux' && providerOf('linux', name);
    if (this.zsh) sio.err(`zsh: command not found: ${name}\n`);
    else if (prov && !prov.renamed) sio.err(`Command '${name}' not found, but can be installed with:\nsudo apt install ${prov.name}\n`);
    else sio.err(`${name}: command not found\n`);
    this.lastErr = { cmd: 'shell', code: 'NOTFOUND', target: name };
    return 127;
  }

  async dispatch(argv, sio) {
    const name = argv[0];
    let ent = null;
    let script = null;
    if (name.includes('/')) {
      let n = null;
      try { n = this.fs.get(norm(name, this.cwd), { user: this.euser }); } catch { /* treated as missing */ }
      if (!n) { this.shErr('ENOENT', name, sio.err); return 127; }
      if (n.t === 'd') { this.shErr(this.zsh ? 'EACCES' : 'EISDIR', name, sio.err, { isDir: true }); return 126; }
      if (!(n.mode & 0o111) || !this.fs.can(n, this.euser, 1)) { this.shErr('EACCES', name, sio.err, { noexec: true }); return 126; }
      if (n.bin) ent = commands[n.bin];
      else script = n.data;
    } else {
      ent = commands[name];
      if (!ent || !ent.builtin) {
        const found = this.which(name);
        if (!found) return this.notFound(name, sio);
        if (found.node.bin) ent = commands[found.node.bin];
        else { ent = null; script = found.node.data; }
      }
    }
    if (script !== null) return this.runScript(script, argv, sio);
    if (!ent) return this.notFound(name, sio);

    const c = this.ctx(ent, argv, sio);
    if (!ent.builtin && REFMAP[ent.name] && c.args.includes('--help')) {
      if (this.os === 'linux' || ent.help || ent.pkg || REFMAP[ent.name].help) { sio.out(helpText(ent.name)); return 0; }
      sio.err(`${c.name}: unrecognized option \`--help'\nusage: ${REFMAP[ent.name].syn}\n`);
      this.lastErr = { cmd: c.name, code: 'BADOPT', target: '--help' };
      return 1;
    }
    try {
      return (await ent.fn(c)) ?? 0;
    } catch (e) {
      if (e instanceof FsError) return c.fail(e.code, e.path);
      throw e;
    }
  }

  ctx(ent, argv, sio) {
    const sh = this;
    const c = {
      name: basename(argv[0]), impl: ent.name, args: argv.slice(1), sh, fs: this.fs, os: this.os, mac: this.os === 'mac',
      user: this.euser, stdin: sio.stdin, tty: sio.tty, io: this.io, sio,
      get cols() { return sh.io.cols || 80; },
      get rows() { return sh.io.rows || 24; },
      out: s => sio.out(s),
      err: s => sio.err(s),
      println: (s = '') => sio.out(s + '\n'),
      abs: p => norm(p, sh.cwd),
      fail(code, target, extra = {}) {
        sio.err((extra.msg ?? fmtErr(sh.os, c.name, code, target, extra.verb)) + '\n');
        sh.lastErr = { cmd: c.name, code, target, ...extra };
        return 1;
      },
      opts(spec = {}) {
        const r = parseOpts(c.args, { permute: !c.mac, ...spec });
        if (r.bad === undefined) return r;
        const syn = REFMAP[c.name]?.syn || c.name;
        if (c.mac) sio.err((r.badLong ? `${c.name}: unrecognized option \`${r.bad}'` : `${c.name}: illegal option -- ${r.bad}`) + `\nusage: ${syn}\n`);
        else sio.err((r.badLong ? `${c.name}: unrecognized option '${r.bad}'` : `${c.name}: invalid option -- '${r.bad}'`) + `\nTry '${c.name} --help' for more information.\n`);
        sh.lastErr = { cmd: c.name, code: 'BADOPT', target: r.badLong ? r.bad : '-' + r.bad };
        return null;
      },
      missing(what = 'operand') {
        const syn = REFMAP[c.name]?.syn || c.name;
        if (c.mac) sio.err(`usage: ${syn}\n`);
        else sio.err(`${c.name}: missing ${what}\nTry '${c.name} --help' for more information.\n`);
        sh.lastErr = { cmd: c.name, code: 'USAGE' };
        return c.mac ? 64 : 1;
      },
      node(p, o = {}) {
        try {
          const n = sh.fs.get(c.abs(p), { follow: o.follow ?? true, user: c.user });
          if (!n) c.fail('ENOENT', p, o);
          return n;
        } catch (e) {
          if (!(e instanceof FsError)) throw e;
          c.fail(e.code, p, o);
          return null;
        }
      },
      read(p) {
        try {
          return sh.fs.read(c.abs(p), c.user);
        } catch (e) {
          if (!(e instanceof FsError)) throw e;
          c.fail(e.code, p);
          return null;
        }
      },
      guard(p, fn, extra) {
        try {
          fn(c.abs(p));
          return true;
        } catch (e) {
          if (!(e instanceof FsError)) throw e;
          c.fail(e.code, p, extra);
          return false;
        }
      },
      // Everything from standard input. From the keyboard this reads until Ctrl+D.
      async input() {
        if (c.stdin !== null && c.stdin !== undefined) return c.stdin;
        if (!sh.io.readLine) return '';
        sh.tip('stdin', { cmd: c.name });
        let buf = '';
        for (;;) {
          const l = await sh.io.readLine('');
          if (l === null) break;
          buf += l + '\n';
        }
        return buf;
      },
    };
    return c;
  }

  async runScript(text, argv, sio) {
    const prev = this.pos;
    this.pos = argv;
    try {
      return await this.sourceText(text, sio);
    } catch (e) {
      if (e instanceof Exit) return e.code;
      throw e;
    } finally {
      this.pos = prev;
    }
  }

  async sourceText(text, sio = this.termSio()) {
    let st = 0;
    let buf = '';
    this.quiet = (this.quiet || 0) + 1;
    try {
      for (const raw of text.split('\n')) {
        buf += (buf ? '\n' : '') + raw;
        let ast;
        try {
          ast = parse(buf);
        } catch (e) {
          if (e instanceof Incomplete) continue;
          if (e instanceof ParseError) return this.syntaxError(e, sio.err);
          throw e;
        }
        buf = '';
        st = await this.runList(ast, sio);
      }
    } finally {
      this.quiet--;
    }
    return st;
  }

  // Run text and return what it printed (for $(...) substitution).
  async capture(src) {
    let buf = '';
    try {
      await this.runList(parse(src), { stdin: null, out: s => { buf += s; }, err: s => this.write(s), tty: false });
    } catch (e) {
      if (e instanceof ParseError || e instanceof Incomplete) this.syntaxError(e, s => this.write(s));
      else throw e;
    }
    return buf;
  }

  // ---------- expansion ----------
  tilde(s) {
    return s === '~' || s.startsWith('~/') ? this.home + s.slice(1) : s;
  }

  vars(s) {
    return s.replace(/\$\{([A-Za-z_]\w*|[?$#@*0-9])\}|\$([A-Za-z_]\w*|[?$#@*0-9])/g, (m, a, b) => {
      const k = a ?? b;
      if (k === '?') return String(this.status);
      if (k === '$') return '4242';
      if (k === '#') return String(Math.max(0, this.pos.length - 1));
      if (k === '@' || k === '*') return this.pos.slice(1).join(' ');
      if (/^\d$/.test(k)) return this.pos[+k] ?? (k === '0' ? (this.zsh ? '-zsh' : 'bash') : '');
      if (k === 'RANDOM') return String(Math.floor(Math.random() * 32768));
      return this.env[k] ?? '';
    });
  }

  async expandWord(w, doGlob = true) {
    const out = [];
    for (const parts of braceExpand(w.parts)) {
      const fields = [[]];
      const quoted = parts.some(p => p.q);
      for (let pi = 0; pi < parts.length; pi++) {
        const p = parts[pi];
        if (p.arith !== undefined) { fields.at(-1).push({ s: String(arith(this.vars(p.arith).replace(/[A-Za-z_]\w*/g, k => this.env[k] ?? '0'))), g: false }); continue; }
        if (p.sub !== undefined) {
          const res = (await this.capture(p.sub)).replace(/\n+$/, '');
          if (p.q === 0) {
            res.split(/\s+/).filter(Boolean).forEach((b, k) => {
              if (k) fields.push([]);
              fields.at(-1).push({ s: b, g: false });
            });
          } else fields.at(-1).push({ s: res, g: false });
          continue;
        }
        let s = p.s;
        if (p.q === 2) { fields.at(-1).push({ s, g: false }); continue; }
        if (p.q === 0 && pi === 0) {
          s = this.tilde(s);
          if (/^[A-Za-z_]\w*=/.test(s)) s = s.replace(/=~(?=\/|:|$)/, '=' + this.home).replace(/:~(?=\/|:|$)/g, ':' + this.home);
        }
        fields.at(-1).push({ s: this.vars(s), g: p.q === 0 });
      }
      for (const f of fields) {
        const text = f.map(x => x.s).join('');
        if (doGlob && f.some(x => x.g && /[*?[]/.test(x.s))) {
          const pat = f.map(x => (x.g ? x.s : x.s.replace(/[*?[\]\\]/g, '\\$&'))).join('');
          const m = this.glob(pat);
          if (m.length) { out.push(...m); continue; }
          if (this.zsh) throw new NoMatch(text);
        }
        if (text === '' && !quoted) continue;
        out.push(text);
      }
    }
    return out;
  }

  glob(pat) {
    const dirsOnly = pat.endsWith('/');
    const segs = pat.split('/').filter(Boolean);
    let cur = [pat.startsWith('/') ? '/' : ''];
    for (const seg of segs) {
      const next = [];
      const special = /[*?[]/.test(seg.replace(/\\./g, ''));
      for (const base of cur) {
        let node = null;
        try { node = this.fs.get(norm(base || '.', this.cwd)); } catch { /* skip */ }
        if (!node || node.t !== 'd') continue;
        if (!special) {
          const name = seg.replace(/\\(.)/g, '$1');
          if (name === '.' || name === '..' || node.kids.has(name)) next.push(joinPath(base, name));
        } else {
          const re = globToRe(seg);
          for (const name of [...node.kids.keys()].sort()) {
            if (name.startsWith('.') && !seg.startsWith('.')) continue;
            if (re.test(name)) next.push(joinPath(base, name));
          }
        }
      }
      cur = next;
    }
    if (dirsOnly) cur = cur.filter(p => this.fs.get(norm(p, this.cwd))?.t === 'd').map(p => p + '/');
    return cur.filter(Boolean);
  }

  // ---------- jobs ----------
  addJob(cmd, ms, state) {
    let id = 1;
    while (this.jobs.some(j => j.id === id)) id++;
    const job = { id, pid: this.nextPid++, cmd, state, end: Date.now() + ms / this.speed, remain: ms };
    this.jobs.push(job);
    return job;
  }

  jobLine(j, what) {
    const cur = j === this.jobs.at(-1) ? '+' : '-';
    if (this.zsh) return `[${j.id}]  ${cur} ${what.padEnd(10)} ${j.cmd}`;
    const W = { done: 'Done', terminated: 'Terminated', suspended: 'Stopped', running: 'Running' }[what];
    return `[${j.id}]${cur}  ${W.padEnd(23)} ${j.cmd}${what === 'running' ? ' &' : ''}`;
  }

  // Text of "job finished" notices, shown before the next prompt.
  reap() {
    let s = '';
    const now = Date.now();
    for (const j of this.jobs) {
      if (j.state === 'running' && now >= j.end) j.state = 'done';
      if (j.state === 'done' || j.state === 'killed') {
        s += this.jobLine(j, j.state === 'done' ? 'done' : 'terminated') + '\n';
        j.gone = true;
      }
    }
    this.jobs = this.jobs.filter(j => !j.gone);
    return s;
  }

  // Wait in the foreground; Ctrl+C / Ctrl+Z interrupt it.
  sleep(ms) {
    return new Promise((res, rej) => {
      const t = setTimeout(() => { this.fgWait = null; res(); }, ms / this.speed);
      this.fgWait = { rej, t, start: Date.now(), ms };
    });
  }

  signal(sig) {
    const w = this.fgWait;
    if (!w) return false;
    clearTimeout(w.t);
    this.fgWait = null;
    w.rej(new Signal(sig, Math.max(0, w.ms - (Date.now() - w.start) * this.speed)));
    return true;
  }

  visit(dir) {
    this.visits[dir] = (this.visits[dir] || 0) + 1;
  }

  // ---------- Tab completion ----------
  commandNames() {
    const names = new Set(Object.keys(this.aliases));
    for (const [k, v] of Object.entries(commands)) if (v.builtin && !v.hidden && (!v.os || v.os === this.os)) names.add(k);
    for (const d of (this.env.PATH || '').split(':')) {
      try {
        const n = d && this.fs.get(d);
        if (n && n.t === 'd') for (const [k, v] of n.kids) if (v.t !== 'd' && v.mode & 0o111) names.add(k);
      } catch { /* ignore */ }
    }
    return [...names].sort();
  }

  pathCands(rawWord, { dirsOnly = false } = {}) {
    const un = s => s.replace(/\\(.)/g, '$1').replace(/^["']/, '');
    const cut = rawWord.lastIndexOf('/') + 1;
    const rawDir = rawWord.slice(0, cut);
    const base = un(rawWord.slice(cut));
    let node = null;
    try { node = this.fs.get(norm(this.tilde(un(rawDir)) || '.', this.cwd), { user: this.euser }); } catch { /* ignore */ }
    if (!node || node.t !== 'd' || !this.fs.can(node, this.euser, 4)) return [];
    const res = [];
    for (const [name, k] of [...node.kids].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      if (!name.startsWith(base) || (name.startsWith('.') && !base.startsWith('.'))) continue;
      let isDir = k.t === 'd';
      if (k.t === 'l') { try { isDir = this.fs.get(norm(k.to, norm(this.tilde(un(rawDir)) || '.', this.cwd)))?.t === 'd'; } catch { /* ignore */ } }
      if (dirsOnly && !isDir) continue;
      res.push({ v: name, dir: isDir, prefix: rawDir, path: true });
    }
    return res;
  }

  // Returns { start, cands: [{ v, dir?, prefix?, path? }], quote }
  complete(line, pos = line.length) {
    const before = line.slice(0, pos);
    let start = 0;
    let q = null;
    for (let k = 0; k < before.length; k++) {
      const ch = before[k];
      if (q) { if (ch === q) q = null; continue; }
      if (ch === '\\') { k++; continue; }
      if (ch === '"' || ch === "'") { q = ch; continue; }
      if (' \t|;&<>'.includes(ch)) start = k + 1;
    }
    const rawWord = before.slice(start);
    const quote = rawWord[0] === '"' || rawWord[0] === "'" ? rawWord[0] : '';
    const head = before.slice(0, start);
    let words = head.split(/[|;&]+/).pop().trim().split(/\s+/).filter(Boolean);
    if (words[0] === 'sudo') words = words.slice(1);
    const afterRedirect = /[<>]\s*$/.test(head);
    const isCmd = !words.length && !afterRedirect;
    const plain = rawWord.replace(/\\(.)/g, '$1').replace(/^["']/, '');
    let cands;
    if (isCmd && !rawWord.includes('/')) cands = this.commandNames().filter(n => n.startsWith(plain)).map(v => ({ v }));
    else if (!afterRedirect && words.length && commands[words[0]]?.complete) cands = commands[words[0]].complete(this, words, plain);
    if (!cands && plain.startsWith('$')) cands = Object.keys(this.env).filter(k => k.startsWith(plain.slice(1))).sort().map(k => ({ v: '$' + k }));
    if (!cands) {
      if (['man', 'which', 'type', 'whatis', 'tldr', 'help'].includes(words[0]) && !afterRedirect) cands = this.commandNames().filter(n => n.startsWith(plain)).map(v => ({ v }));
      else cands = this.pathCands(rawWord, { dirsOnly: !afterRedirect && (words[0] === 'cd' || words[0] === 'rmdir') });
    }
    return { start, cands, quote };
  }
}
