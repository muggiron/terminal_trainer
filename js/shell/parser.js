// Shell command-line parser: quoting, operators, pipelines, lists.
//
// A word is a list of parts: { s, q } where q is 0 (unquoted), 1 (double-quoted)
// or 2 (literal: single-quoted or backslash-escaped). Command substitutions are
// parts of the form { sub: 'command text', q }.

export class Incomplete extends Error {
  constructor(kind) {
    super('incomplete input');
    this.kind = kind;
  }
}

export class ParseError extends Error {
  constructor(near) {
    super('parse error');
    this.near = near;
  }
}

const OPS = ['2>&1', '>&2', '&>>', '2>>', '2>', '&>', '&&', '||', '>>', '>', '<', '|', ';', '&'];
const REDIRS = ['>', '>>', '<', '2>', '2>>', '&>', '&>>'];

function matchParen(src, i) {
  let depth = 0;
  let q = null;
  for (let j = i; j < src.length; j++) {
    const ch = src[j];
    if (q) {
      if (ch === '\\' && q === '"') j++;
      else if (ch === q) q = null;
      continue;
    }
    if (ch === '\\') j++;
    else if (ch === '"' || ch === "'") q = ch;
    else if (ch === '(') depth++;
    else if (ch === ')' && --depth === 0) return j;
  }
  return -1;
}

export function tokenize(src) {
  const toks = [];
  let parts = null;
  let i = 0;
  const push = (s, q) => {
    parts ??= [];
    const last = parts[parts.length - 1];
    if (last && last.q === q && last.sub === undefined) last.s += s;
    else parts.push({ s, q });
  };
  const sub = (text, q) => {
    parts ??= [];
    parts.push({ sub: text, q });
  };
  const end = () => {
    if (parts) toks.push({ type: 'word', parts });
    parts = null;
  };
  const dollarParen = q => {
    if (src.startsWith('$((', i)) {
      const end = src.indexOf('))', i + 3);
      if (end < 0) throw new Incomplete('math');
      parts ??= [];
      parts.push({ arith: src.slice(i + 3, end), q });
      i = end + 2;
      return;
    }
    const j = matchParen(src, i + 1);
    if (j < 0) throw new Incomplete('cmdsubst');
    sub(src.slice(i + 2, j), q);
    i = j + 1;
  };
  const backtick = q => {
    const j = src.indexOf('`', i + 1);
    if (j < 0) throw new Incomplete('bquote');
    sub(src.slice(i + 1, j), q);
    i = j + 1;
  };

  while (i < src.length) {
    const ch = src[i];
    if (ch === ' ' || ch === '\t') { end(); i++; continue; }
    if (ch === '\n') { end(); toks.push({ type: 'op', v: ';' }); i++; continue; }
    if (ch === '#' && !parts) {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (ch === '\\') {
      if (i + 1 >= src.length) throw new Incomplete('bslash');
      if (src[i + 1] !== '\n') push(src[i + 1], 2);
      i += 2;
      continue;
    }
    if (ch === "'") {
      const j = src.indexOf("'", i + 1);
      if (j < 0) throw new Incomplete('quote');
      push(src.slice(i + 1, j), 2);
      i = j + 1;
      continue;
    }
    if (ch === '"') {
      i++;
      push('', 1);
      for (;;) {
        if (i >= src.length) throw new Incomplete('dquote');
        const c = src[i];
        if (c === '"') { i++; break; }
        if (c === '\\' && i + 1 < src.length && '"\\$`\n'.includes(src[i + 1])) {
          if (src[i + 1] !== '\n') push(src[i + 1], 2);
          i += 2;
        } else if (c === '$' && src[i + 1] === '(') dollarParen(1);
        else if (c === '`') backtick(1);
        else { push(c, 1); i++; }
      }
      continue;
    }
    if (ch === '$' && src[i + 1] === '(') { dollarParen(0); continue; }
    if (ch === '`') { backtick(0); continue; }
    const op = OPS.find(o => src.startsWith(o, i) && (o[0] !== '2' || !parts));
    if (op) {
      end();
      toks.push({ type: 'op', v: op });
      i += op.length;
      continue;
    }
    push(ch, 0);
    i++;
  }
  end();
  return toks;
}

// Returns { items: [{ andor: [{ pipe: [cmd], op }], bg }] }
// where cmd = { words: [word], redirs: [{ op, target }] }
export function parse(src) {
  const toks = tokenize(src);
  const items = [];
  let i = 0;
  const isOp = (t, v) => t && t.type === 'op' && (v === undefined || t.v === v);

  const simple = () => {
    const cmd = { words: [], redirs: [] };
    while (i < toks.length) {
      const t = toks[i];
      if (t.type === 'word') { cmd.words.push(t); i++; }
      else if (REDIRS.includes(t.v)) {
        const target = toks[i + 1];
        if (!target) throw new ParseError('\\n');
        if (target.type !== 'word') throw new ParseError(target.v);
        cmd.redirs.push({ op: t.v, target });
        i += 2;
      } else if (t.v === '2>&1' || t.v === '>&2') { cmd.redirs.push({ op: t.v }); i++; }
      else break;
    }
    return cmd;
  };

  const pipeline = () => {
    const cmds = [];
    for (;;) {
      const c = simple();
      if (!c.words.length && !c.redirs.length) throw new ParseError(toks[i] ? toks[i].v : '\\n');
      cmds.push(c);
      if (isOp(toks[i], '|')) {
        i++;
        if (i >= toks.length) throw new Incomplete('pipe');
        continue;
      }
      return cmds;
    }
  };

  while (i < toks.length) {
    if (isOp(toks[i], ';')) { i++; continue; }
    const andor = [];
    for (;;) {
      const pipe = pipeline();
      const t = toks[i];
      if (isOp(t, '&&') || isOp(t, '||')) {
        andor.push({ pipe, op: t.v });
        i++;
        if (i >= toks.length) throw new Incomplete(t.v === '&&' ? 'cmdand' : 'cmdor');
        continue;
      }
      andor.push({ pipe, op: null });
      break;
    }
    let bg = false;
    const t = toks[i];
    if (isOp(t, '&')) { bg = true; i++; }
    else if (isOp(t, ';')) i++;
    else if (t) throw new ParseError(t.v ?? t.parts.map(p => p.s ?? '').join(''));
    items.push({ andor, bg });
  }
  return { items };
}

// Returns the kind of continuation needed ('dquote', 'pipe', ...) or null.
export function needsMore(src) {
  try {
    parse(src);
    return null;
  } catch (e) {
    if (e instanceof Incomplete) return e.kind;
    return null;
  }
}

// Plain text of a word (ignoring quoting). Used for quick checks.
export const wordText = w => w.parts.map(p => p.s ?? '').join('');
