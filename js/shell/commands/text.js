// Text tools: head tail wc sort uniq cut tr grep find sed awk tee xargs diff less

import { def } from '../registry.js';
import { FsError } from '../vfs.js';
import { sgr, bytes, toRegex, globToRe, splitLines, diffOps, unifiedHunks, sprintf } from '../util.js';
import { Pager } from '../../editors/pager.js';

async function readInputs(c, files) {
  if (!files.length) return [{ name: null, text: await c.input() }];
  const out = [];
  for (const f of files) {
    if (f === '-') { out.push({ name: null, text: await c.input() }); continue; }
    const t = c.read(f);
    if (t === null) { c.bad = true; continue; }
    out.push({ name: f, text: t });
  }
  return out;
}

// Show text in the pager when writing to a terminal, otherwise just print it.
export async function page(c, text, title = '') {
  if (c.tty && c.io.fullscreen) await c.io.fullscreen(new Pager({ text, title }));
  else c.out(text);
}

def('head', async c => {
  const p = c.opts({ val: 'nc', bool: 'q', numeric: true });
  if (!p) return 1;
  const n = parseInt(p.o.n ?? '10', 10);
  if (isNaN(n)) { c.err(`head: ${c.mac ? 'illegal line count -- ' + p.o.n : `invalid number of lines: ‘${p.o.n}’`}\n`); return 1; }
  const ins = await readInputs(c, p.rest);
  ins.forEach((f, i) => {
    if (p.rest.length > 1) c.out(`${i ? '\n' : ''}==> ${f.name ?? 'standard input'} <==\n`);
    if (p.o.c) c.out(f.text.slice(0, +p.o.c));
    else c.out(splitLines(f.text).slice(0, n).map(l => l + '\n').join(''));
  });
  return c.bad ? 1 : 0;
});

def('tail', async c => {
  const p = c.opts({ val: 'nc', bool: 'fqF', numeric: true });
  if (!p) return 1;
  const raw = String(p.o.n ?? '10');
  const n = parseInt(raw, 10);
  if (isNaN(n)) { c.err(`tail: ${c.mac ? 'illegal offset -- ' + raw : `invalid number of lines: ‘${raw}’`}\n`); return 1; }
  const ins = await readInputs(c, p.rest);
  ins.forEach((f, i) => {
    if (p.rest.length > 1) c.out(`${i ? '\n' : ''}==> ${f.name ?? 'standard input'} <==\n`);
    const ls = splitLines(f.text);
    c.out((raw.startsWith('+') ? ls.slice(n - 1) : n === 0 ? [] : ls.slice(-n)).map(l => l + '\n').join(''));
  });
  if ((p.o.f || p.o.F) && !c.bad && c.tty) {
    c.sh.tip('follow', {});
    await c.sh.sleep(24 * 3600 * 1000);
  }
  return c.bad ? 1 : 0;
});

def('wc', async c => {
  const p = c.opts({ bool: 'lwcm' });
  if (!p) return 1;
  const o = p.o;
  const cols = o.l || o.w || o.c || o.m ? ['l', 'w', 'c'].filter(k => o[k] || (k === 'c' && o.m)) : ['l', 'w', 'c'];
  const count = t => ({ l: (t.match(/\n/g) || []).length, w: (t.match(/\S+/g) || []).length, c: bytes(t) });
  const ins = await readInputs(c, p.rest);
  const rows = ins.map(f => [count(f.text), f.name]);
  if (rows.length > 1) rows.push([{ l: rows.reduce((s, r) => s + r[0].l, 0), w: rows.reduce((s, r) => s + r[0].w, 0), c: rows.reduce((s, r) => s + r[0].c, 0) }, 'total']);
  let w = 8;
  if (!c.mac) {
    if (cols.length === 1 && rows.length === 1) w = 1;
    else if (!p.rest.length) w = 7;
    else w = Math.max(...rows.flatMap(r => cols.map(k => String(r[0][k]).length)));
  }
  for (const [cnt, name] of rows) c.println(cols.map(k => String(cnt[k]).padStart(w)).join(c.mac ? '' : ' ') + (name ? ' ' + name : ''));
  return c.bad ? 1 : 0;
});

def('sort', async c => {
  const p = c.opts({ bool: 'rnufhbdV', val: 'kto' });
  if (!p) return 2;
  const o = p.o;
  const ins = await readInputs(c, p.rest);
  if (c.bad) return 2;
  let ls = ins.flatMap(f => splitLines(f.text));
  const kn = o.k ? parseInt(o.k, 10) : 0;
  const key = l => {
    let k = l;
    if (kn) k = (o.t ? l.split(o.t) : l.trim().split(/\s+/)).slice(kn - 1).join(o.t || ' ');
    return o.f ? k.toLowerCase() : k;
  };
  const numv = s => { const m = s.trim().match(/^-?\d*\.?\d+/); return m ? parseFloat(m[0]) : 0; };
  const hv = s => { const m = s.trim().match(/^(-?\d*\.?\d+)([KMGT]?)/i); return m ? parseFloat(m[1]) * 1024 ** ' KMGT'.indexOf(m[2].toUpperCase() || ' ') : 0; };
  const cmp = (a, b) => {
    const ka = key(a), kb = key(b);
    let d;
    if (o.n) d = numv(ka) - numv(kb);
    else if (o.h) d = hv(ka) - hv(kb);
    else d = c.mac ? (ka < kb ? -1 : ka > kb ? 1 : 0) : ka.localeCompare(kb, 'en');
    return d || (a < b ? -1 : a > b ? 1 : 0);
  };
  ls.sort(cmp);
  if (o.u) ls = ls.filter((l, i) => i === 0 || (o.n ? numv(key(l)) !== numv(key(ls[i - 1])) : key(l) !== key(ls[i - 1])));
  if (o.r) ls.reverse();
  const text = ls.map(l => l + '\n').join('');
  if (o.o) { if (!c.guard(o.o, a => c.fs.write(a, text, c.user))) return 2; }
  else c.out(text);
});

def('uniq', async c => {
  const p = c.opts({ bool: 'cdui' });
  if (!p) return 1;
  const o = p.o;
  const ins = await readInputs(c, p.rest.slice(0, 1));
  if (c.bad) return 1;
  const groups = [];
  for (const l of splitLines(ins[0].text)) {
    const last = groups[groups.length - 1];
    if (last && (o.i ? last[0].toLowerCase() === l.toLowerCase() : last[0] === l)) last[1]++;
    else groups.push([l, 1]);
  }
  for (const [l, n] of groups) {
    if ((o.d && n < 2) || (o.u && n > 1)) continue;
    c.println(o.c ? String(n).padStart(c.mac ? 4 : 7) + ' ' + l : l);
  }
});

function parseList(spec) {
  const ranges = [];
  for (const part of spec.split(',')) {
    const m = part.match(/^(\d*)(-?)(\d*)$/);
    if (!m || (!m[1] && !m[3])) return null;
    ranges.push([m[1] ? +m[1] : 1, m[2] ? (m[3] ? +m[3] : Infinity) : +m[1]]);
  }
  return n => ranges.some(([a, b]) => n >= a && n <= b);
}

def('cut', async c => {
  const p = c.opts({ val: 'dfcb', bool: 's' });
  if (!p) return 1;
  const o = p.o;
  const spec = o.f ?? o.c ?? o.b;
  if (spec === undefined) {
    c.err(c.mac ? 'usage: cut -b list [-n] [file ...]\n       cut -c list [file ...]\n       cut -f list [-s] [-w | -d delim] [file ...]\n' : "cut: you must specify a list of bytes, characters, or fields\nTry 'cut --help' for more information.\n");
    c.sh.lastErr = { cmd: 'cut', code: 'USAGE' };
    return 1;
  }
  const want = parseList(spec);
  if (!want) { c.err(c.mac ? `cut: [-bcf] list: illegal list value\n` : `cut: invalid field value ‘${spec}’\n`); return 1; }
  const d = o.d ?? '\t';
  const ins = await readInputs(c, p.rest);
  for (const f of ins) {
    for (const l of splitLines(f.text)) {
      if (o.f !== undefined) {
        if (!l.includes(d)) { if (!o.s) c.println(l); continue; }
        c.println(l.split(d).filter((_, i) => want(i + 1)).join(d));
      } else c.println([...l].filter((_, i) => want(i + 1)).join(''));
    }
  }
  return c.bad ? 1 : 0;
});

function trSet(s) {
  s = s.replace(/\[:(\w+):\]/g, (m, k) => ({ upper: 'A-Z', lower: 'a-z', digit: '0-9', alpha: 'A-Za-z', alnum: 'A-Za-z0-9', space: ' \t\n', punct: '!-/:-@[-`{-~' }[k] ?? m));
  s = s.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\\\/g, '\\');
  const out = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i + 1] === '-' && i + 2 < s.length) {
      for (let ch = s.charCodeAt(i); ch <= s.charCodeAt(i + 2); ch++) out.push(String.fromCharCode(ch));
      i += 2;
    } else out.push(s[i]);
  }
  return out;
}

def('tr', async c => {
  const p = c.opts({ bool: 'dsc' });
  if (!p) return 1;
  const { o, rest } = p;
  if (!rest.length || (!o.d && !o.s && rest.length < 2)) return c.missing('operand');
  const a = trSet(rest[0]);
  const b = rest[1] !== undefined ? trSet(rest[1]) : [];
  let text = await c.input();
  if (o.d) text = [...text].filter(ch => !a.includes(ch)).join('');
  else if (b.length) text = [...text].map(ch => { const i = a.indexOf(ch); return i < 0 ? ch : b[Math.min(i, b.length - 1)]; }).join('');
  if (o.s) {
    const sq = o.d ? b : b.length ? b : a;
    text = [...text].filter((ch, i, arr) => !(sq.includes(ch) && arr[i - 1] === ch)).join('');
  }
  c.out(text);
});

def(['grep', 'egrep', 'fgrep'], async c => {
  const p = c.opts({
    bool: 'ivnclrREFwoqHhs', val: 'eABCm', permute: true,
    long: { color: 'opt', colour: 'opt', 'ignore-case': 'bool', recursive: 'bool', 'line-number': 'bool', count: 'bool', 'invert-match': 'bool', include: 'val' },
  });
  if (!p) return 2;
  const o = p.o;
  let rest = p.rest;
  let pat = o.e;
  if (pat === undefined) {
    if (!rest.length) {
      c.err(c.mac ? 'usage: grep [-abcdDEFGHhIiJLlMmnOopqRSsUVvwXxZz] [-A num] [-B num] [-C[num]]\n\t[-e pattern] [-f file] [--binary-files=value] [--color=when]\n\t[--context[=num]] [--directories=action] [--label] [--line-buffered]\n\t[--null] [pattern] [file ...]\n' : "Usage: grep [OPTION]... PATTERNS [FILE]...\nTry 'grep --help' for more information.\n");
      c.sh.lastErr = { cmd: 'grep', code: 'USAGE' };
      return 2;
    }
    pat = rest[0];
    rest = rest.slice(1);
  }
  const re = toRegex(pat, { ere: o.E || c.name === 'egrep', fixed: o.F || c.name === 'fgrep', icase: o.i || o['ignore-case'], word: o.w });
  if (!re) { c.err(`grep: ${c.mac ? 'brackets ([ ]) not balanced' : 'Unmatched [, [^, [:, [., or [='}\n`); return 2; }
  const rec = o.r || o.R || o.recursive;
  const lineNo = o.n || o['line-number'];
  const count = o.c || o.count;
  const invert = o.v || o['invert-match'];
  const colorOpt = o.color ?? o.colour;
  const color = c.tty && colorOpt !== undefined && colorOpt !== 'never';
  const inc = o.include ? globToRe(o.include) : null;
  let err = false;

  const files = []; // { name, text }
  if (!rest.length && !rec) files.push({ name: null, text: await c.input() });
  for (const t of rest.length ? rest : rec ? ['.'] : []) {
    const n = c.node(t);
    if (!n) { err = true; continue; }
    if (n.t === 'd') {
      if (!rec) { c.fail('EISDIR', t, { coach: 'GREP_DIR' }); err = true; continue; }
      const walk = (label, node) => {
        for (const [k, v] of [...node.kids].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
          const l = label === '' ? k : label.endsWith('/') ? label + k : label + '/' + k;
          if (v.t === 'd') walk(l, v);
          else if (v.t === 'f' && !v.bin && (!inc || inc.test(k)) && c.fs.can(v, c.user, 4)) files.push({ name: l, text: v.data });
        }
      };
      walk(rest.length ? t : '', n);
    } else {
      const text = c.read(t);
      if (text === null) err = true;
      else files.push({ name: t, text });
    }
  }
  const showName = !o.h && (o.H || files.length > 1 || rec);
  const ctxB = +(o.B ?? o.C ?? 0), ctxA = +(o.A ?? o.C ?? 0);
  const maxN = o.m ? +o.m : Infinity;
  let any = false;
  for (const f of files) {
    const ls = splitLines(f.text);
    const hit = ls.map(l => { re.lastIndex = 0; return re.test(l) !== !!invert; });
    const n = Math.min(hit.filter(Boolean).length, maxN);
    if (n) any = true;
    if (o.q) continue;
    const label = f.name ?? '(standard input)';
    const nameTag = sep => (showName ? (color ? sgr('35', label) + sgr('36', sep) : label + sep) : '');
    if (o.l) { if (n) c.println(color ? sgr('35', label) : label); continue; }
    if (count) { c.println(nameTag(':') + n); continue; }
    let shown = 0;
    let lastPrinted = -2;
    for (let i = 0; i < ls.length && shown < maxN; i++) {
      if (!hit[i]) continue;
      shown++;
      const from = Math.max(i - ctxB, lastPrinted + 1);
      if ((ctxA || ctxB) && lastPrinted >= 0 && from > lastPrinted + 1) c.println('--');
      for (let k = from; k < i; k++) c.println(nameTag('-') + (lineNo ? k + 1 + '-' : '') + ls[k]);
      let text = ls[i];
      if (o.o && !invert) {
        re.lastIndex = 0;
        for (const m of text.matchAll(re)) if (m[0]) c.println(nameTag(':') + (lineNo ? i + 1 + ':' : '') + (color ? sgr('1;31', m[0]) : m[0]));
      } else {
        if (color && !invert) { re.lastIndex = 0; text = text.replace(re, m => (m ? sgr('1;31', m) : m)); }
        c.println(nameTag(':') + (lineNo ? (color ? sgr('32', String(i + 1)) + sgr('36', ':') : i + 1 + ':') : '') + text);
      }
      lastPrinted = i;
      for (let k = i + 1; k <= Math.min(ls.length - 1, i + ctxA) && !hit[k]; k++) { c.println(nameTag('-') + (lineNo ? k + 1 + '-' : '') + ls[k]); lastPrinted = k; }
    }
  }
  return err ? 2 : any ? 0 : 1;
});

def('find', async c => {
  const a = c.args.slice();
  const roots = [];
  while (a.length && !a[0].startsWith('-') && a[0] !== '!' && a[0] !== '(') roots.push(a.shift());
  if (!roots.length) {
    if (c.mac) {
      c.err('usage: find [-H | -L | -P] [-EXdsx] [-f path] path ... [expression]\n       find [-H | -L | -P] [-EXdsx] -f path [path ...] [expression]\n');
      c.sh.lastErr = { cmd: 'find', code: 'FIND_PATH' };
      return 1;
    }
    roots.push('.');
  }
  const tests = [];
  let maxd = Infinity, mind = 0, del = false, exec = null, neg = false;
  const add = fn => { tests.push(neg ? (...x) => !fn(...x) : fn); neg = false; };
  const argOf = k => {
    if (!a.length) {
      c.err(c.mac ? `find: ${k}: requires additional arguments\n` : `find: missing argument to \`${k}'\n`);
      c.sh.lastErr = { cmd: 'find', code: 'USAGE' };
      return null;
    }
    return a.shift();
  };
  while (a.length) {
    const k = a.shift();
    let v;
    switch (k) {
      case '-name': case '-iname': {
        if ((v = argOf(k)) === null) return 1;
        const re = globToRe(v, k === '-iname');
        add(name => re.test(name));
        break;
      }
      case '-type':
        if ((v = argOf(k)) === null) return 1;
        { const t = v; add((name, n) => n.t === ({ f: 'f', d: 'd', l: 'l' }[t] || 'x')); }
        break;
      case '-maxdepth': if ((v = argOf(k)) === null) return 1; maxd = +v; break;
      case '-mindepth': if ((v = argOf(k)) === null) return 1; mind = +v; break;
      case '-empty': add((name, n) => (n.t === 'd' ? !n.kids.size : n.t === 'f' && !n.data.length)); break;
      case '-size': {
        if ((v = argOf(k)) === null) return 1;
        const m = v.match(/^([+-]?)(\d+)([ckMG]?)$/);
        if (!m) { c.err(`find: ${c.mac ? '-size: ' + v + ': illegal trailing character' : `invalid argument \`${v}' to \`-size'`}\n`); return 1; }
        const unit = { c: 1, k: 1024, M: 1048576, G: 1073741824, '': 512 }[m[3]];
        add((name, n) => { const b = n.t === 'f' ? Math.ceil(bytes(n.data) / unit) : 0; return m[1] === '+' ? b > +m[2] : m[1] === '-' ? b < +m[2] : b === +m[2]; });
        break;
      }
      case '-not': case '!': neg = !neg; break;
      case '-delete': del = true; break;
      case '-print': break;
      case '-exec': {
        exec = [];
        while (a.length && a[0] !== ';' && a[0] !== '+') exec.push(a.shift());
        if (!a.length) { c.err(c.mac ? 'find: -exec: no terminating ";" or "+"\n' : "find: missing argument to `-exec'\n"); c.sh.lastErr = { cmd: 'find', code: 'FIND_EXEC' }; return 1; }
        a.shift();
        break;
      }
      default:
        if (!k.startsWith('-')) {
          // Typical cause: an unquoted pattern like *.txt was expanded by the shell into several names.
          c.err(c.mac ? `find: ${k}: unknown primary or operator\n` : `find: paths must precede expression: \`${k}'\nfind: possible unquoted pattern after predicate \`-name'?\n`);
          c.sh.lastErr = { cmd: 'find', code: 'FIND_UNQUOTED', target: k };
          return 1;
        }
        c.err(c.mac ? `find: ${k}: unknown primary or operator\n` : `find: unknown predicate \`${k}'\n`);
        c.sh.lastErr = { cmd: 'find', code: 'BADOPT', target: k };
        return 1;
    }
  }
  let st = 0;
  const hits = [];
  const visit = (label, abs, n, depth) => {
    const name = label === '/' ? '/' : label.replace(/\/+$/, '').split('/').pop();
    const match = depth >= mind && tests.every(t => t(name, n));
    if (match && !del) hits.push([label, abs]);
    if (n.t === 'd' && depth < maxd) {
      if (!c.fs.can(n, c.user, 4) || !c.fs.can(n, c.user, 1)) { c.fail('EACCES', label); st = 1; }
      else for (const [k, v] of [...n.kids]) visit(label.endsWith('/') ? label + k : label + '/' + k, abs === '/' ? '/' + k : abs + '/' + k, v, depth + 1);
    }
    if (match && del) hits.push([label, abs]);
  };
  for (const r of roots) {
    const n = c.node(r, { follow: false });
    if (!n) { st = 1; continue; }
    visit(r, c.abs(r), n, 0);
  }
  for (const [label, abs] of hits) {
    if (del) { try { c.fs.rm(abs, c.user); } catch (e) { if (!(e instanceof FsError)) throw e; c.err(`find: ${c.mac ? '-delete: ' + label : `cannot delete ‘${label}’`}: ${e.code === 'ENOTEMPTY' ? 'Directory not empty' : 'Permission denied'}\n`); st = 1; } }
    else if (exec) await c.sh.exec(exec.map(x => x.replaceAll('{}', label)), c.sio, { alias: false });
    else c.println(label);
  }
  return st;
});

// ---------- sed ----------
function parseSed(script, ere) {
  const cmds = [];
  let i = 0;
  const addrAt = () => {
    const m = script.slice(i).match(/^(\d+|\$|\/(?:[^/\\]|\\.)*\/)/);
    if (!m) return null;
    i += m[0].length;
    if (m[0] === '$') return { last: true };
    if (m[0][0] === '/') return { re: toRegex(m[0].slice(1, -1), { ere, flags: '' }) };
    return { n: +m[0] };
  };
  while (i < script.length) {
    if (/[\s;]/.test(script[i])) { i++; continue; }
    const cmd = { a1: addrAt(), a2: null };
    if (cmd.a1 && script[i] === ',') { i++; cmd.a2 = addrAt(); }
    while (script[i] === ' ') i++;
    const ch = script[i];
    if (ch === undefined) return { error: 'command expected', gnu: 'missing command', pos: i };
    if (ch === 's') {
      const d = script[i + 1];
      const parts = [];
      let cur = '';
      let j = i + 2;
      for (; j < script.length && parts.length < 2; j++) {
        if (script[j] === '\\' && j + 1 < script.length) { cur += script[j + 1] === d ? d : '\\' + script[j + 1]; j++; }
        else if (script[j] === d) { parts.push(cur); cur = ''; }
        else cur += script[j];
      }
      if (!d || parts.length < 2) return { error: parts.length === 1 ? 'unterminated substitute in regular expression' : 'unterminated substitute pattern', gnu: "unterminated `s' command", pos: script.length };
      const fm = script.slice(j).match(/^[gipI0-9]*/)[0];
      i = j + fm.length;
      const re = toRegex(parts[0], { ere, icase: /[iI]/.test(fm), flags: fm.includes('g') ? 'g' : '' });
      if (!re) return { error: 'RE error: invalid expression', gnu: 'Invalid regular expression', pos: i };
      const rep = parts[1].replace(/\$/g, '$$$$').replace(/\\([1-9])/g, '$$$1').replace(/(^|[^\\])&/g, '$1$$&').replace(/\\&/g, '&').replace(/\\n/g, '\n');
      cmds.push({ ...cmd, op: 's', re, rep, print: fm.includes('p') });
    } else if ('dpq'.includes(ch)) { cmds.push({ ...cmd, op: ch }); i++; }
    else return { error: `invalid command code ${ch}`, gnu: `unknown command: \`${ch}'`, pos: i + 1 };
  }
  return { cmds };
}

def('sed', async c => {
  const a = c.args.slice();
  let quiet = false, inplace = false, ere = false, suffix;
  const scripts = [];
  while (a.length && a[0].startsWith('-') && a[0].length > 1) {
    const f = a.shift();
    if (f === '-n') quiet = true;
    else if (f === '-E' || f === '-r') ere = true;
    else if (f === '-e') scripts.push(a.shift() ?? '');
    else if (f === '--') break;
    else if (f.startsWith('-i')) {
      inplace = true;
      if (c.mac && f === '-i') suffix = a.shift(); // BSD sed: -i needs an extension argument
    } else {
      c.err(c.mac ? `sed: illegal option -- ${f.slice(1)}\nusage: sed script [-Ealnru] [-i extension] [file ...]\n` : `sed: invalid option -- '${f.slice(1)}'\n`);
      c.sh.lastErr = { cmd: 'sed', code: 'BADOPT', target: f };
      return 1;
    }
  }
  if (!scripts.length) {
    if (!a.length) {
      c.err(c.mac ? 'usage: sed script [-Ealnru] [-i extension] [file ...]\n\tsed [-Ealnu] [-i extension] [-e script] ... [-f script_file] ... [file ...]\n' : "Usage: sed [OPTION]... {script-only-if-no-other-script} [input-file]...\n");
      c.sh.lastErr = { cmd: 'sed', code: suffix !== undefined ? 'SED_I' : 'USAGE' };
      return 1;
    }
    scripts.push(a.shift());
  }
  const cmds = [];
  for (const s of scripts) {
    const r = parseSed(s, ere);
    if (r.error) {
      c.err(c.mac ? `sed: 1: "${s}": ${r.error}\n` : `sed: -e expression #1, char ${r.pos}: ${r.gnu}\n`);
      c.sh.lastErr = { cmd: 'sed', code: c.mac && suffix !== undefined && suffix !== '' ? 'SED_I' : 'SED_SCRIPT', target: s };
      return 1;
    }
    cmds.push(...r.cmds);
  }
  const run = text => {
    const ls = splitLines(text);
    let out = '';
    const active = cmds.map(() => false);
    const hit = (ad, l, idx) => (ad.last ? idx === ls.length - 1 : ad.re ? ad.re.test(l) : ad.n === idx + 1);
    outer: for (let idx = 0; idx < ls.length; idx++) {
      let l = ls[idx];
      for (let k = 0; k < cmds.length; k++) {
        const cm = cmds[k];
        let on = true;
        if (cm.a1 && !cm.a2) on = hit(cm.a1, l, idx);
        else if (cm.a1 && cm.a2) {
          if (active[k]) { on = true; if (hit(cm.a2, l, idx) || (cm.a2.n && cm.a2.n <= idx + 1)) active[k] = false; }
          else if (hit(cm.a1, l, idx)) { on = true; active[k] = !(cm.a2.n && cm.a2.n <= idx + 1); }
          else on = false;
        }
        if (!on) continue;
        if (cm.op === 'd') continue outer;
        if (cm.op === 'p') out += l + '\n';
        if (cm.op === 'q') { if (!quiet) out += l + '\n'; break outer; }
        if (cm.op === 's') {
          cm.re.lastIndex = 0;
          const nl = l.replace(cm.re, cm.rep);
          if (nl !== l && cm.print) out += nl + '\n';
          l = nl;
        }
      }
      if (!quiet) out += l + '\n';
    }
    return out;
  };
  if (inplace) {
    if (!a.length) { c.err('sed: no input files\n'); return 1; }
    let st = 0;
    for (const f of a) {
      const t = c.read(f);
      if (t === null) { st = 1; continue; }
      if (suffix) c.fs.write(c.abs(f + suffix), t, c.user);
      if (!c.guard(f, p => c.fs.write(p, run(t), c.user))) st = 1;
    }
    return st;
  }
  const ins = await readInputs(c, a);
  for (const f of ins) c.out(run(f.text));
  return c.bad ? 1 : 0;
});

// ---------- awk (a useful subset) ----------
function awkTokens(src) {
  const T = [];
  let i = 0;
  const operand = () => { const t = T[T.length - 1]; return t && (t.t === 'num' || t.t === 'str' || t.t === 'name' || t.v === ')'); };
  while (i < src.length) {
    const ch = src[i];
    if (ch === ' ' || ch === '\t') { i++; continue; }
    if (ch === '\n') { T.push({ t: 'op', v: ';' }); i++; continue; }
    if (ch === '#') { while (i < src.length && src[i] !== '\n') i++; continue; }
    let m;
    if ((m = src.slice(i).match(/^(\d+\.?\d*|\.\d+)/))) { T.push({ t: 'num', v: parseFloat(m[0]) }); i += m[0].length; continue; }
    if (ch === '"') {
      let s = '';
      for (i++; i < src.length && src[i] !== '"'; i++) {
        if (src[i] === '\\') { const n = src[++i]; s += n === 'n' ? '\n' : n === 't' ? '\t' : n; }
        else s += src[i];
      }
      i++;
      T.push({ t: 'str', v: s });
      continue;
    }
    if (ch === '/' && !operand()) {
      let s = '';
      for (i++; i < src.length && src[i] !== '/'; i++) {
        if (src[i] === '\\' && src[i + 1] === '/') { s += '/'; i++; }
        else s += src[i];
      }
      i++;
      T.push({ t: 're', v: s });
      continue;
    }
    if ((m = src.slice(i).match(/^[A-Za-z_]\w*/))) { T.push({ t: 'name', v: m[0] }); i += m[0].length; continue; }
    const op = ['&&', '||', '==', '!=', '>=', '<=', '!~', '+=', '-=', '*=', '/=', '++', '--'].find(o => src.startsWith(o, i)) || ch;
    T.push({ t: 'op', v: op });
    i += op.length;
  }
  return T;
}

const aNum = v => { if (typeof v === 'number') return v; const n = parseFloat(v); return isNaN(n) ? 0 : n; };
const aStr = v => (typeof v === 'number' ? (Number.isInteger(v) ? String(v) : String(+v.toPrecision(6))) : String(v));
const aLooksNum = v => typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v)));
const aTrue = v => (typeof v === 'number' ? v !== 0 : aLooksNum(v) ? Number(v) !== 0 : v !== '');
const aCmp = (a, b) => (aLooksNum(a) && aLooksNum(b) ? aNum(a) - aNum(b) : aStr(a) < aStr(b) ? -1 : aStr(a) > aStr(b) ? 1 : 0);

function awkCompile(src) {
  const T = awkTokens(src);
  let i = 0;
  const peek = v => T[i] && T[i].t === 'op' && T[i].v === v;
  const isName = v => T[i] && T[i].t === 'name' && T[i].v === v;
  const eat = v => (peek(v) ? (i++, true) : false);
  const need = v => { if (!eat(v)) throw new Error(`syntax error near ${T[i] ? T[i].v : 'end of program'}`); };
  const FUNCS = {
    length: (e, a) => aStr(a.length ? a[0] : e.f[0]).length,
    toupper: (e, a) => aStr(a[0]).toUpperCase(),
    tolower: (e, a) => aStr(a[0]).toLowerCase(),
    substr: (e, a) => { const s = aStr(a[0]); const m = Math.max(1, aNum(a[1])); return a.length > 2 ? s.substr(m - 1, aNum(a[2])) : s.slice(m - 1); },
    int: (e, a) => Math.trunc(aNum(a[0])),
    index: (e, a) => aStr(a[0]).indexOf(aStr(a[1])) + 1,
    sprintf: (e, a) => sprintf(aStr(a[0]), a.slice(1)),
  };

  function primary() {
    const t = T[i];
    if (!t) throw new Error('syntax error at end of program');
    i++;
    if (t.t === 'num' || t.t === 'str') return () => t.v;
    if (t.t === 're') { const re = new RegExp(t.v); const f = e => (re.test(e.f[0]) ? 1 : 0); f.re = re; return f; }
    if (t.t === 'op') {
      if (t.v === '$') { const idx = primary(); const f = e => e.f[aNum(idx(e))] ?? ''; f.set = (e, v) => e.setField(aNum(idx(e)), v); return f; }
      if (t.v === '(') { const x = expr(); need(')'); return x; }
      if (t.v === '-') { const x = primary(); return e => -aNum(x(e)); }
      if (t.v === '!') { const x = primary(); return e => (aTrue(x(e)) ? 0 : 1); }
    }
    if (t.t === 'name') {
      if (peek('(') && FUNCS[t.v]) {
        i++;
        const args = [];
        if (!peek(')')) do args.push(expr()); while (eat(','));
        need(')');
        return e => FUNCS[t.v](e, args.map(a => a(e)));
      }
      if (t.v === 'length') return e => e.f[0].length;
      const f = e => e.get(t.v);
      f.set = (e, v) => e.set(t.v, v);
      return f;
    }
    throw new Error(`syntax error near ${t.v}`);
  }
  function postfix() {
    const x = primary();
    if (x.set && (peek('++') || peek('--'))) {
      const d = T[i++].v === '++' ? 1 : -1;
      return e => { const old = aNum(x(e)); x.set(e, old + d); return old; };
    }
    return x;
  }
  const binary = (next, ops) => () => {
    let l = next();
    while (T[i] && T[i].t === 'op' && ops[T[i].v]) {
      const fn = ops[T[i++].v];
      const a = l, b = next();
      l = e => fn(a(e), b(e));
    }
    return l;
  };
  const mul = binary(postfix, { '*': (a, b) => aNum(a) * aNum(b), '/': (a, b) => aNum(a) / aNum(b), '%': (a, b) => aNum(a) % aNum(b) });
  const add = binary(mul, { '+': (a, b) => aNum(a) + aNum(b), '-': (a, b) => aNum(a) - aNum(b) });
  function concat() {
    let l = add();
    while (T[i] && (T[i].t === 'num' || T[i].t === 'str' || (T[i].t === 'name' && !['in'].includes(T[i].v)) || (T[i].t === 'op' && (T[i].v === '$' || T[i].v === '(')))) {
      const a = l, b = add();
      l = e => aStr(a(e)) + aStr(b(e));
    }
    return l;
  }
  const cmp = binary(concat, { '<': (a, b) => +(aCmp(a, b) < 0), '<=': (a, b) => +(aCmp(a, b) <= 0), '==': (a, b) => +(aCmp(a, b) === 0), '!=': (a, b) => +(aCmp(a, b) !== 0), '>': (a, b) => +(aCmp(a, b) > 0), '>=': (a, b) => +(aCmp(a, b) >= 0) });
  function match() {
    let l = cmp();
    while (peek('~') || peek('!~')) {
      const negate = T[i++].v === '!~';
      const a = l, b = cmp();
      l = e => { const re = b.re || new RegExp(aStr(b(e))); return +(re.test(aStr(a(e))) !== negate); };
    }
    return l;
  }
  const and = binary(match, { '&&': (a, b) => +(aTrue(a) && aTrue(b)) });
  const or = binary(and, { '||': (a, b) => +(aTrue(a) || aTrue(b)) });
  function expr() {
    const l = or();
    const t = T[i];
    if (l.set && t && t.t === 'op' && ['=', '+=', '-=', '*=', '/='].includes(t.v)) {
      i++;
      const r = expr();
      const f = { '=': (a, b) => b, '+=': (a, b) => aNum(a) + aNum(b), '-=': (a, b) => aNum(a) - aNum(b), '*=': (a, b) => aNum(a) * aNum(b), '/=': (a, b) => aNum(a) / aNum(b) }[t.v];
      return e => l.set(e, f(l(e), r(e)));
    }
    return l;
  }
  const endStmt = () => !T[i] || peek(';') || peek('}');
  function stmt() {
    if (isName('print')) {
      i++;
      const args = [];
      if (!endStmt()) do args.push(expr()); while (eat(','));
      return e => e.out((args.length ? args.map(a => aStr(a(e))).join(aStr(e.get('OFS'))) : e.f[0]) + '\n');
    }
    if (isName('printf')) {
      i++;
      const paren = eat('(');
      const args = [];
      do args.push(expr()); while (eat(','));
      if (paren) need(')');
      return e => e.out(sprintf(aStr(args[0](e)), args.slice(1).map(a => a(e))));
    }
    if (isName('if')) {
      i++;
      need('(');
      const cond = expr();
      need(')');
      const a = peek('{') ? block() : stmt();
      const save = i;
      while (eat(';'));
      let b = null;
      if (isName('else')) { i++; b = peek('{') ? block() : stmt(); } else i = save;
      return e => { if (aTrue(cond(e))) a(e); else if (b) b(e); };
    }
    if (isName('next')) { i++; return () => { throw awkCompile.NEXT; }; }
    const x = expr();
    return e => { x(e); };
  }
  function block() {
    need('{');
    const ss = [];
    while (!peek('}')) {
      if (eat(';')) continue;
      if (!T[i]) throw new Error('syntax error: missing }');
      ss.push(stmt());
    }
    need('}');
    return e => { for (const s of ss) s(e); };
  }
  const rules = [];
  while (i < T.length) {
    if (eat(';')) continue;
    let kind = 'main', pat = null, act = null;
    if (isName('BEGIN')) { i++; kind = 'begin'; }
    else if (isName('END')) { i++; kind = 'end'; }
    else if (!peek('{')) pat = expr();
    if (peek('{')) act = block();
    else if (kind !== 'main') throw new Error('syntax error: BEGIN and END need an action in { }');
    rules.push({ kind, pat, act });
  }
  return rules;
}
awkCompile.NEXT = Symbol('next');

def('awk', async c => {
  const a = c.args.slice();
  let fs = ' ';
  const pre = {};
  while (a.length && a[0].startsWith('-') && a[0].length > 1) {
    const f = a.shift();
    if (f === '-F') fs = a.shift() ?? ' ';
    else if (f.startsWith('-F')) fs = f.slice(2);
    else if (f === '-v') { const [k, v] = (a.shift() ?? '').split(/=(.*)/s); pre[k] = v ?? ''; }
    else if (f === '--') break;
    else { c.err(`awk: unknown option ${f} ignored\n`); }
  }
  if (!a.length) {
    c.err(c.mac ? 'usage: awk [-F fs][-v var=value][prog | -f progfile][file ...]\n' : 'Usage: awk [POSIX or GNU style options] [--] \'program\' file ...\n');
    c.sh.lastErr = { cmd: 'awk', code: 'USAGE' };
    return 2;
  }
  const prog = a.shift();
  let rules;
  try { rules = awkCompile(prog); } catch (e) {
    c.err(`awk: ${e.message}\n source line number 1\n`);
    c.sh.lastErr = { cmd: 'awk', code: 'AWK_SYNTAX', target: prog };
    return 2;
  }
  if (fs === '\\t') fs = '\t';
  const env = {
    vars: { NR: 0, FS: fs, OFS: ' ', ...pre },
    f: [''],
    out: s => c.out(s),
    get(k) { return k === 'NF' ? this.f.length - 1 : this.vars[k] ?? ''; },
    set(k, v) { this.vars[k] = v; return v; },
    split(line) {
      const sep = aStr(this.vars.FS);
      const parts = sep === ' ' ? (line.trim() ? line.trim().split(/\s+/) : []) : sep.length === 1 ? line.split(sep) : line.split(new RegExp(sep));
      this.f = [line, ...parts];
    },
    setField(n, v) {
      if (n === 0) this.split(aStr(v));
      else { while (this.f.length <= n) this.f.push(''); this.f[n] = aStr(v); this.f[0] = this.f.slice(1).join(aStr(this.vars.OFS)); }
      return v;
    },
  };
  for (const r of rules) if (r.kind === 'begin') r.act(env);
  if (rules.some(r => r.kind !== 'begin')) {
    const ins = await readInputs(c, a);
    for (const f of ins) {
      for (const line of splitLines(f.text)) {
        env.vars.NR++;
        env.split(line);
        try {
          for (const r of rules) {
            if (r.kind !== 'main') continue;
            if (r.pat && !aTrue(r.pat(env))) continue;
            if (r.act) r.act(env); else c.println(env.f[0]);
          }
        } catch (e) { if (e !== awkCompile.NEXT) throw e; }
      }
    }
  }
  for (const r of rules) if (r.kind === 'end') r.act(env);
  return c.bad ? 2 : 0;
});

def('tee', async c => {
  const p = c.opts({ bool: 'ai' });
  if (!p) return 1;
  const text = await c.input();
  let st = 0;
  for (const f of p.rest) if (!c.guard(f, a => c.fs.write(a, text, c.user, { append: p.o.a }))) st = 1;
  c.out(text);
  return st;
});

def('xargs', async c => {
  const p = c.opts({ val: 'InL', bool: 'tr0', permute: false });
  if (!p) return 1;
  const text = await c.input();
  const cmd = p.rest.length ? p.rest : ['echo'];
  const run = argv => c.sh.exec(argv, { ...c.sio, stdin: '' }, { alias: false });
  let st = 0;
  if (p.o.I) {
    for (const l of splitLines(text)) if (l.trim()) st = (await run(cmd.map(x => x.replaceAll(p.o.I, l)))) || st;
  } else {
    const items = text.split(/\s+/).filter(Boolean);
    if (!items.length) return 0;
    const n = p.o.n ? +p.o.n : items.length;
    for (let i = 0; i < items.length; i += n) st = (await run([...cmd, ...items.slice(i, i + n)])) || st;
  }
  return st ? 123 : 0;
});

def('diff', c => {
  const p = c.opts({ bool: 'uqrNi', permute: true });
  if (!p) return 2;
  if (p.rest.length < 2) {
    c.err(p.rest.length ? `diff: missing operand after '${p.rest[0]}'\ndiff: Try 'diff --help' for more information.\n` : "diff: missing operand after 'diff'\ndiff: Try 'diff --help' for more information.\n");
    c.sh.lastErr = { cmd: 'diff', code: 'USAGE' };
    return 2;
  }
  const [fa, fb] = p.rest;
  const ta = c.read(fa);
  const tb = c.read(fb);
  if (ta === null || tb === null) return 2;
  if (ta === tb) return 0;
  if (p.o.q) { c.println(`Files ${fa} and ${fb} differ`); return 1; }
  const A = splitLines(ta), B = splitLines(tb);
  if (p.o.u) {
    c.println(`--- ${fa}\n+++ ${fb}`);
    for (const l of unifiedHunks(A, B)) c.println(l);
    return 1;
  }
  const ops = diffOps(A, B);
  for (let k = 0; k < ops.length;) {
    if (ops[k].t === ' ') { k++; continue; }
    let e = k;
    while (e < ops.length && ops[e].t !== ' ') e++;
    const dels = ops.slice(k, e).filter(o => o.t === '-');
    const adds = ops.slice(k, e).filter(o => o.t === '+');
    const rng = (list, key, base) => (list.length ? (list.length > 1 ? `${list[0][key] + 1},${list.at(-1)[key] + 1}` : String(list[0][key] + 1)) : String(base));
    c.println(rng(dels, 'a', ops[k].a) + (dels.length && adds.length ? 'c' : dels.length ? 'd' : 'a') + rng(adds, 'b', ops[k].b));
    dels.forEach(o => c.println('< ' + o.s));
    if (dels.length && adds.length) c.println('---');
    adds.forEach(o => c.println('> ' + o.s));
    k = e;
  }
  return 1;
});

def('seq', c => {
  const n = c.args.map(Number);
  if (!n.length || n.some(isNaN)) return c.missing();
  const [from, step, to] = n.length === 1 ? [1, 1, n[0]] : n.length === 2 ? [n[0], 1, n[1]] : n;
  for (let v = from; step > 0 ? v <= to : v >= to; v += step || 1) c.println(String(v));
});

def(['less', 'more'], async c => {
  const p = c.opts({ bool: 'NRSFXin', permute: true });
  if (!p) return 1;
  if (!p.rest.length && (c.stdin === null || c.stdin === undefined)) {
    c.err(c.name === 'less' ? 'Missing filename ("less --help" for help)\n' : 'usage: more [-dfln] [+linenum | +/pattern] name1 name2 ...\n');
    c.sh.lastErr = { cmd: c.name, code: 'USAGE' };
    return 1;
  }
  const ins = await readInputs(c, p.rest);
  if (c.bad && !ins.length) return 1;
  await page(c, ins.map(f => f.text).join(''), ins[0]?.name || '');
  return c.bad ? 1 : 0;
});
