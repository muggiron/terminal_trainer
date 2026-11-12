// The vi model: modes, motions, operators, undo, search, ex commands.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vi } from '../js/editors/vi.js';
import { Nano } from '../js/editors/nano.js';
import { Pager } from '../js/editors/pager.js';
import { keys } from './helpers.js';

const TEXT = 'one two three\nfour five six\nseven eight nine\n';

function vi(text = TEXT, opts = {}) {
  const saved = {};
  const events = [];
  const v = new Vi({ text, name: 'f.txt', write: (name, t) => { saved[name] = t; return null; }, emit: (what, data) => events.push({ what, ...data }), ...opts });
  const type = s => { for (const k of keys(s)) v.key(k); return v; };
  return { v, type, saved, events };
}

test('insert mode types text, Esc returns to normal mode', () => {
  const { v, type } = vi();
  assert.equal(v.mode, 'normal');
  type('iHello <Esc>');
  assert.equal(v.mode, 'normal');
  assert.equal(v.lines[0], 'Hello one two three');
  type('A!<Esc>onew line<Esc>');
  assert.deepEqual(v.lines.slice(0, 2), ['Hello one two three!', 'new line']);
});

test('motions', () => {
  const { v, type } = vi();
  type('w');
  assert.equal(v.cx, 4);
  type('$');
  assert.equal(v.cx, 12);
  type('0G');
  assert.deepEqual([v.cy, v.cx], [2, 0]);
  type('gg2j');
  assert.equal(v.cy, 2);
  type('k^e');
  assert.deepEqual([v.cy, v.cx], [1, 3]);
  type('b');
  assert.equal(v.cx, 0);
  type(':3<Enter>');
  assert.equal(v.cy, 2);
  type('ggfw');
  assert.equal(v.cx, 5);
});

test('delete, yank, paste, change with counts and motions', () => {
  const { v, type } = vi();
  type('dw');
  assert.equal(v.lines[0], 'two three');
  type('x');
  assert.equal(v.lines[0], 'wo three');
  type('dd');
  assert.deepEqual(v.lines, ['four five six', 'seven eight nine']);
  type('p');
  assert.deepEqual(v.lines, ['four five six', 'wo three', 'seven eight nine']);
  type('ggyyGp');
  assert.equal(v.lines.at(-1), 'four five six');
  type('ggcwFOUR<Esc>');
  assert.equal(v.lines[0], 'FOUR five six');
  type('wD');
  assert.equal(v.lines[0], 'FOUR ');
  type('2dd');
  assert.equal(v.lines.length, 2);
  type('ciwX<Esc>');
  assert.equal(v.lines[0], 'X eight nine');
});

test('undo, redo and dot repeat', () => {
  const { v, type } = vi();
  type('dd');
  assert.equal(v.lines.length, 2);
  type('u');
  assert.equal(v.lines.length, 3);
  type('<C-r>');
  assert.equal(v.lines.length, 2);
  type('u');
  type('cwX<Esc>w.');
  assert.equal(v.lines[0], 'X X three');
  type('j0x..');
  assert.equal(v.lines[1], 'r five six');
});

test('visual mode', () => {
  const { v, type } = vi();
  type('vwd');
  assert.equal(v.lines[0], 'wo three');
  type('Vjd');
  assert.deepEqual(v.lines, ['seven eight nine']);
  type('veyP');
  assert.equal(v.lines[0], 'sevenseven eight nine');
});

test('search and substitute', () => {
  const { v, type } = vi();
  type('/five<Enter>');
  assert.deepEqual([v.cy, v.cx], [1, 5]);
  type('/e<Enter>n');
  assert.deepEqual([v.cy, v.cx], [2, 1]);
  type(':%s/e/E/g<Enter>');
  assert.equal(v.lines[0], 'onE two thrEE');
  type(':1s/onE/1/<Enter>');
  assert.equal(v.lines[0], '1 two thrEE');
  type('/zebra<Enter>');
  assert.match(v.msg, /E486: Pattern not found: zebra/);
});

test('saving and quitting', () => {
  const { v, type, saved, events } = vi();
  type('ix<Esc>:q<Enter>');
  assert.match(v.msg, /^E37/);
  assert.equal(v.done, false);
  type(':w<Enter>');
  assert.equal(saved['f.txt'], 'xone two three\nfour five six\nseven eight nine\n');
  assert.match(v.msg, /"f.txt" 3L, \d+B written/);
  type(':q<Enter>');
  assert.equal(v.done, true);
  assert.ok(events.some(e => e.what === 'quit' && e.saved));

  const b = vi();
  b.type('ddZZ');
  assert.equal(b.v.done, true);
  assert.equal(b.saved['f.txt'], 'four five six\nseven eight nine\n');

  const c = vi();
  c.type('dd:q!<Enter>');
  assert.equal(c.v.done, true);
  assert.deepEqual(c.saved, {});

  const d = vi();
  d.type(':wrong<Enter>');
  assert.match(d.v.msg, /E492: Not an editor command: wrong/);
});

test('read-only files and options', () => {
  const { v, type } = vi(TEXT, { readonly: true });
  type('dd:w<Enter>');
  assert.match(v.msg, /^E45/);
  type(':set number<Enter>');
  v.resize(10, 40);
  assert.match(v.render().lines[0].text, /^\s+1 four five six/);
  type(':set nonu<Enter>');
  assert.equal(v.render().lines[0].text, 'four five six');
});

test('render shows the mode and keeps the cursor on screen', () => {
  const { v, type } = vi(Array.from({ length: 100 }, (_, i) => 'line ' + (i + 1)).join('\n') + '\n');
  v.resize(10, 60);
  type('G');
  const r = v.render();
  assert.equal(r.lines.length, 10);
  assert.equal(r.lines[8].text, 'line 100');
  assert.equal(r.cursor.r, 8);
  type('i');
  assert.match(v.render().lines[9].text, /^-- INSERT --/);
});

test('nano: type, save, exit', () => {
  const saved = {};
  const n = new Nano({ text: '', name: 'a.txt', isNew: true, write: (name, t) => { saved[name] = t; return null; } });
  for (const k of keys('hello<Enter>world<C-x>')) n.key(k);
  assert.equal(n.prompt.type, 'exit');
  for (const k of keys('y<Enter>')) n.key(k);
  assert.equal(saved['a.txt'], 'hello\nworld\n');
  assert.equal(n.done, true);
});

test('pager: scroll, search, quit', () => {
  const p = new Pager({ text: Array.from({ length: 50 }, (_, i) => 'row ' + i).join('\n') });
  p.resize(11, 40);
  for (const k of keys(' ')) p.key(k);
  assert.equal(p.top, 10);
  for (const k of keys('/row 33<Enter>')) p.key(k);
  assert.equal(p.top, 33);
  p.key('q');
  assert.equal(p.done, true);
});
