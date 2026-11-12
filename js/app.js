// Application shell: wires the terminal to the lessons, the sandbox, the review
// drills, the reference panel and the settings.

import { createShell, buildFs, VFS, explain, tipText, viExplain } from './shell/index.js';
import { installedPkgs } from './shell/packages.js';
import { Terminal, esc } from './ui/terminal.js';
import { buildCourse } from './lessons/lessons.js';
import { buildDrills } from './lessons/drills.js';
import { REF, CATS, noteFor, SYNTAX, SHORTCUTS, VIKEYS, NANOKEYS } from './data/reference.js';
import { loadState, saveState, clearState, gradeDrill, pickDrills } from './store.js';

const $ = id => document.getElementById(id);
const root = document.documentElement;

// Tiny markup for lesson texts: `code`, **bold**, *emphasis*, [[Key]].
function md(s) {
  return String(s).split('`').map((seg, i) => (i % 2
    ? `<code>${esc(seg)}</code>`
    : esc(seg).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*\s][^*]*)\*/g, '<em>$1</em>').replace(/\[\[([^\]]+)\]\]/g, '<kbd>$1</kbd>'))).join('');
}
const noteHtml = n => `<p>${md(n.what)}</p>${n.fix ? `<p>${md(n.fix)}</p>` : ''}${n.example ? `<pre><code>${esc(n.example)}</code></pre>` : ''}`;

let state = loadState();
const save = () => saveState(state);

let term;
let shell = null;      // the shell of the current session
let mainFs = null;     // its local filesystem (the shell may be inside an ssh session)
let session = 0;       // increases whenever a new session starts; stale async work checks it
let course = [];
let lesson = null;
let stepIdx = 0;
let misses = 0;
let hintLevel = 0;
let nudged = false;
let panelView = 'lesson';
let review = null;
let viWhy = '';
let viWhyFresh = false;
let refTab = 'commands';

const allLessons = () => course.flatMap(t => t.lessons.map(l => ({ ...l, track: t.title })));
const findLesson = id => allLessons().find(l => l.id === id);
const doneMap = () => state.done[state.os];
const lessonDone = () => !!lesson && stepIdx >= lesson.steps.length;
const nextLessonOf = id => { const all = allLessons(); const i = all.findIndex(l => l.id === id); return all[i + 1] || null; };
const osName = () => (state.os === 'mac' ? 'macOS' : 'Linux');

// ---------- sessions ----------
async function newShell(fs) {
  const sh = await createShell({ os: state.os, io: term, onEvent, fs });
  mainFs = sh.fs;
  return sh;
}

const banner = () => (state.os === 'mac' ? `Last login: ${new Date().toString().slice(0, 24)} on ttys000` : '');

async function startLesson(id) {
  const token = ++session;
  course = buildCourse(state.os);
  lesson = findLesson(id) || allLessons().find(l => !doneMap()[l.id]) || allLessons()[0];
  state.lesson[state.os] = lesson.id;
  save();
  stepIdx = 0; misses = 0; hintLevel = 0; nudged = false;
  panelView = 'lesson';
  review = null;
  term.reset();
  const sh = await newShell();
  if (lesson.setup) await lesson.setup(sh);
  if (token !== session) return;
  shell = sh;
  term.start(sh, banner());
  renderPanel();
  renderTask();
}

async function startSandbox() {
  const token = ++session;
  review = null;
  term.reset();
  let fs = null;
  try { if (state.sandbox[state.os]) fs = VFS.fromJSON(state.sandbox[state.os]); } catch { fs = null; }
  const sh = await newShell(fs || buildFs(state.os));
  if (token !== session) return;
  shell = sh;
  term.start(sh, banner());
  renderPanel();
  renderTask();
}

async function setMode(mode) {
  state.mode = mode;
  save();
  for (const b of document.querySelectorAll('.modes button')) b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
  if (mode === 'learn') await startLesson(state.lesson[state.os]);
  else if (mode === 'sandbox') await startSandbox();
  else await reviewIntro();
}

async function setOs(os) {
  state.os = os;
  root.dataset.os = os;
  for (const b of document.querySelectorAll('.os button')) b.setAttribute('aria-pressed', String(b.dataset.os === os));
  course = buildCourse(os);
  await setMode(state.mode);
  renderRef();
}

// ---------- events from the shell and the terminal ----------
function onEvent(ev) {
  if (ev.sh && ev.sh !== shell) return;
  if (ev.type === 'tip') showTip(ev);
  else if (ev.type === 'exit') showTip({ id: 'exit', data: {}, sh: shell });
  else if (ev.type === 'cmd') {
    if (state.coach) { const ex = explain(ev); if (ex) term.note('coach', 'Coach', noteHtml(ex)); }
  } else if (ev.type === 'vi') {
    if (ev.what === 'error') { viWhy = viExplain(ev.code) || ''; viWhyFresh = true; }
    else if (ev.what === 'key') { if (viWhyFresh) viWhyFresh = false; else viWhy = ''; }
    else if (ev.what === 'open' || ev.what === 'quit') viWhy = '';
  }
  if (state.mode === 'learn') lessonProgress(ev);
  else if (state.mode === 'review') reviewProgress(ev);
  else if (ev.type === 'cmd') persistSandbox();
}

function showTip(ev) {
  const t = tipText(ev);
  if (!t) return;
  if (t.once) {
    if (state.tips[ev.id]) return;
    state.tips[ev.id] = 1;
    save();
  }
  term.note('tip', 'Good to know', noteHtml(t));
  if (ev.id === 'say' && globalThis.speechSynthesis) {
    try { speechSynthesis.speak(new SpeechSynthesisUtterance(ev.data.text)); } catch { /* speech not available */ }
  }
}

function persistSandbox() {
  if (!mainFs) return;
  state.sandbox[state.os] = mainFs.toJSON();
  save();
}

// Lines typed at the prompt that belong to the trainer, not to the shell.
async function onLine(text) {
  const t = text.trim();
  if (state.mode === 'learn') {
    if (t === 'hint') { showHint(true); return true; }
    if (t === 'next' && lessonDone()) { const n = nextLessonOf(lesson.id); if (n) { startLesson(n.id); return true; } }
  }
  if (state.mode === 'review' && review && !review.done && t === 'skip') { skipDrill(true); return true; }
  return false;
}

// ---------- lessons ----------
function lessonProgress(ev) {
  const step = lesson?.steps[stepIdx];
  if (!step) return;
  let ok = false;
  try { ok = !!step.check(ev); } catch (e) { console.error(e); }
  if (ok) { completeStep(step); return; }
  if (ev.type !== 'cmd' || ev.err || !ev.line.trim()) return;
  misses++;
  const typed = ev.cmds[0]?.name;
  const wanted = step.sol.trim().split(/\s+/)[0];
  if (typed && typed === wanted && !nudged) {
    nudged = true;
    term.note('tip', 'Almost', `<p>Right command, but this step asks for something slightly different.</p><p>${md(step.hint || `Compare with the task above, or type \`hint\`.`)}</p>`);
  } else if (misses % 3 === 0) {
    term.note('tip', 'Still on this step', `<p>${md(step.say)}</p><p>${md('Type `hint` (or press the Hint button) if you are stuck.')}</p>`);
  }
}

function completeStep(step) {
  stepIdx++;
  misses = 0; hintLevel = 0; nudged = false;
  const last = stepIdx >= lesson.steps.length;
  let html = step.done ? `<p>${md(step.done)}</p>` : '';
  if (last) {
    doneMap()[lesson.id] = Date.now();
    save();
    const n = nextLessonOf(lesson.id);
    html += `<p><strong>You finished “${esc(lesson.title)}”.</strong> ${n ? md('Type `next` for the next lesson, or keep experimenting here.') : 'That was the last lesson. Well done!'}</p>`;
  }
  term.note('done', last ? 'Lesson complete' : `Step ${stepIdx} done`, html || '<p>Done.</p>');
  renderPanel();
  renderTask();
}

function showHint(inTerminal) {
  const step = lesson?.steps[stepIdx];
  if (!step) return;
  hintLevel = Math.min(2, hintLevel + (step.hint ? 1 : 2));
  renderTask();
  if (inTerminal) term.note('tip', hintLevel < 2 ? 'Hint' : 'One way to do it', hintLevel < 2 ? `<p>${md(step.hint)}</p>` : `<pre><code>${esc(step.sol)}</code></pre>`);
}

// ---------- review ----------
function drillPool() {
  const all = buildDrills(state.os);
  const mine = all.filter(d => doneMap()[d.lesson]);
  return mine.length >= 6 ? mine : all.filter(d => doneMap()[d.lesson] || ['look', 'move', 'create', 'copy', 'read'].includes(d.lesson));
}

async function reviewIntro() {
  const token = ++session;
  review = null;
  term.reset();
  const sh = await newShell();
  if (token !== session) return;
  shell = sh;
  term.start(sh, banner());
  renderPanel();
  renderTask();
}

async function startReview() {
  const token = ++session;
  review = { items: pickDrills(state, drillPool(), 8), i: 0, results: [], attempts: 0, start: Date.now(), done: false };
  term.reset();
  await loadDrill(token, true);
}

async function loadDrill(token, first) {
  const d = review.items[review.i];
  review.attempts = 0;
  const sh = await newShell();
  if (d.setup) await d.setup(sh);
  if (token !== session) return;
  shell = sh;
  const label = `Question ${review.i + 1} of ${review.items.length}`;
  if (first) { term.note('tip', label, `<p>${md(d.q)}</p>`); term.start(sh); }
  else { term.swap(sh); term.note('tip', label, `<p>${md(d.q)}</p>`); }
  renderPanel();
  renderTask();
}

// Move on to the next question. Returns a promise while the next question is being prepared.
function advanceReview() {
  review.i++;
  if (review.i < review.items.length) return loadDrill(session, false);
  review.done = true;
  review.secs = Math.round((Date.now() - review.start) / 1000);
  const right = review.results.filter(r => r.ok).length;
  term.note('done', 'Review finished', `<p><strong>${right} of ${review.items.length}</strong> correct on the first try, in ${Math.floor(review.secs / 60)}:${String(review.secs % 60).padStart(2, '0')} minutes.</p>`);
  renderPanel();
  renderTask();
  return null;
}

function reviewProgress(ev) {
  if (!review || review.done || ev.type !== 'cmd') return;
  const d = review.items[review.i];
  let ok = false;
  try { ok = !!d.check(ev); } catch (e) { console.error(e); }
  if (ok) {
    const firstTry = review.attempts === 0;
    review.results.push({ d, ok: firstTry });
    gradeDrill(state, d.id, firstTry);
    save();
    term.note('done', firstTry ? 'Correct' : 'That works', firstTry ? '<p>First try.</p>' : '<p>This task will come back soon for another go.</p>');
    const work = advanceReview();
    if (work) term.defer(work); // the terminal waits for the next question before prompting
  } else if (ev.line.trim()) {
    review.attempts++;
    if (review.attempts === 1) term.note('miss', 'Not quite', `<p>One way to do it:</p><pre><code>${esc(d.a)}</code></pre><p>${md('Type it to continue, or type `skip`.')}</p>`);
  }
}

// Give up on the current question. Called from the prompt (`skip`) or from the Skip button.
function skipDrill(fromPrompt) {
  const d = review.items[review.i];
  review.results.push({ d, ok: false });
  gradeDrill(state, d.id, false);
  save();
  term.note('miss', 'Skipped', `<p>One way to do it:</p><pre><code>${esc(d.a)}</code></pre>`);
  const work = advanceReview();
  if (!work) return;
  if (fromPrompt) term.defer(work);
  else work.then(() => term.refreshPrompt());
}

// ---------- the task strip above the terminal ----------
function renderTask() {
  const box = $('task');
  box.className = 'task';
  if (state.mode === 'sandbox') {
    box.innerHTML = `<span class="eyebrow">Sandbox · ${osName()}</span><p class="task-say">Free practice. Try anything: your changes are kept between visits, and nothing here touches your real files.</p>`;
    return;
  }
  if (state.mode === 'review') {
    if (!review) box.innerHTML = '<span class="eyebrow">Review</span><p class="task-say">Short drills without step-by-step help. Press <strong>Start review</strong> in the panel when you are ready.</p>';
    else if (review.done) {
      box.classList.add('complete');
      box.innerHTML = `<span class="eyebrow">Review finished</span><p class="task-say">${review.results.filter(r => r.ok).length} of ${review.items.length} correct on the first try.</p><div class="task-actions"><button type="button" class="btn primary" data-act="review-start">Another round</button></div>`;
    } else box.innerHTML = `<span class="eyebrow">Question ${review.i + 1} of ${review.items.length}</span><p class="task-say">${md(review.items[review.i].q)}</p><div class="task-actions"><button type="button" class="btn" data-act="review-skip">Skip</button></div>`;
    return;
  }
  if (!lesson) { box.innerHTML = ''; return; }
  if (lessonDone()) {
    const n = nextLessonOf(lesson.id);
    box.classList.add('complete');
    box.innerHTML = `<span class="eyebrow">Lesson complete</span><p class="task-say">You finished “${esc(lesson.title)}”. ${n ? `Next: ${esc(n.title)}.` : 'You have reached the end of the course.'}</p><div class="task-actions">${n ? `<button type="button" class="btn primary" data-act="next">Next lesson</button>` : ''}<button type="button" class="btn" data-act="restart">Repeat</button></div>`;
    return;
  }
  const step = lesson.steps[stepIdx];
  let html = `<span class="eyebrow">Step ${stepIdx + 1} of ${lesson.steps.length} · ${esc(lesson.title)}</span><p class="task-say">${md(step.say)}</p><div class="task-actions"><button type="button" class="btn" data-act="hint" title="You can also type: hint">${hintLevel === 0 ? 'Hint' : hintLevel === 1 ? 'Show a solution' : 'Solution shown'}</button></div>`;
  if (step.copy) html += `<div class="copyable" style="grid-column:1/-1"><code>${esc(step.copy)}</code><button type="button" class="btn" data-copy="${esc(step.copy)}">Copy</button></div>`;
  if (hintLevel === 1 && step.hint) html += `<div class="task-hint"><b>Hint:</b> ${md(step.hint)}</div>`;
  if (hintLevel === 2) html += `<div class="task-hint"><b>One way to do it:</b> <code>${esc(step.sol)}</code></div>`;
  box.innerHTML = html;
}

// ---------- the side panel ----------
function renderPanel() {
  const p = $('panel');
  p.setAttribute('aria-label', state.mode === 'learn' ? 'Lesson' : state.mode === 'sandbox' ? 'Sandbox' : 'Review');
  if (state.mode === 'sandbox') { p.innerHTML = sandboxHtml(); return; }
  if (state.mode === 'review') { p.innerHTML = reviewHtml(); return; }
  p.innerHTML = panelView === 'course' ? courseHtml() : lessonHtml();
  p.scrollTop = 0;
}

function lessonHtml() {
  if (!lesson) return '';
  const steps = lesson.steps.map((s, i) => {
    const cls = i < stepIdx ? 'done' : i === stepIdx ? 'current' : 'todo';
    return `<li class="${cls}"${i === stepIdx ? ' aria-current="step"' : ''}><span class="mark" aria-hidden="true">${i < stepIdx ? '✓' : i + 1}</span><div><p>${md(s.say)}</p>${i < stepIdx && s.done ? `<p class="explain">${md(s.done)}</p>` : ''}</div></li>`;
  }).join('');
  const n = nextLessonOf(lesson.id);
  return `<div class="panel-top"><span class="eyebrow">${esc(lesson.track)} · ${osName()}</span><button type="button" class="linkish" data-act="course">All lessons</button></div>
    <h2>${esc(lesson.title)}</h2>
    <div class="intro">${lesson.intro.map(t => `<p>${md(t)}</p>`).join('')}</div>
    <ol class="steps">${steps}</ol>
    <div class="panel-foot"><button type="button" class="btn" data-act="restart">Restart lesson</button>${n ? `<button type="button" class="btn${lessonDone() ? ' primary' : ''}" data-act="next">${lessonDone() ? 'Next lesson' : 'Skip to next'}</button>` : ''}</div>`;
}

function courseHtml() {
  const all = allLessons();
  const doneCount = all.filter(l => doneMap()[l.id]).length;
  const tracks = course.map(t => `<section class="track"><h3>${esc(t.title)}</h3><ul class="lesson-list">${t.lessons.map(l => `<li class="${doneMap()[l.id] ? 'done' : ''}"><button type="button" data-lesson="${l.id}"${lesson && l.id === lesson.id ? ' aria-current="true"' : ''}><span class="dot" aria-hidden="true">${doneMap()[l.id] ? '✓' : ''}</span><span>${esc(l.title)}${doneMap()[l.id] ? '<span class="sr-only"> (done)</span>' : ''}</span><span class="len">${l.steps.length} steps</span></button></li>`).join('')}</ul></section>`).join('');
  return `<div class="panel-top"><span class="eyebrow">Course · ${osName()}</span>${lesson ? '<button type="button" class="linkish" data-act="lesson">Back to lesson</button>' : ''}</div>
    <h2>All lessons</h2>
    <p class="fine">${doneCount} of ${all.length} lessons done. Every lesson is unlocked; the order is a suggestion.</p>
    <div class="progress" role="progressbar" aria-label="Course progress" aria-valuemin="0" aria-valuemax="${all.length}" aria-valuenow="${doneCount}"><i style="width:${(doneCount / all.length) * 100}%"></i></div>
    ${tracks}`;
}

function sandboxHtml() {
  const mac = state.os === 'mac';
  const ideas = ['ls -la', 'cd Documents', 'cat notes.txt', 'echo "hello" > test.txt', 'vi test.txt', 'grep -rn TODO ~/projects', 'ls ~ | wc -l', mac ? 'brew install tree' : 'sudo apt install tree', 'top', 'man ls', 'help'];
  return `<div class="panel-top"><span class="eyebrow">Sandbox · ${osName()}</span></div>
    <h2>Free practice</h2>
    <div class="intro"><p>An open terminal with no task. Everything is simulated, so you can break things without consequences. Your files here are kept between visits.</p><p>When a command fails, the coach explains why, just like in the lessons.</p></div>
    <h3>Things to try</h3>
    <div class="chips">${ideas.map(c => `<button type="button" class="chip" data-insert="${esc(c)}">${esc(c)}</button>`).join('')}</div>
    <h3>If you get stuck</h3>
    <div class="intro"><p>${md('[[Ctrl+C]] stops a running command or clears the line.')}</p><p>${md('[[q]] leaves pagers such as `less` and `man`.')}</p><p>${md('In vi, press [[Esc]] and type `:q!` to leave without saving.')}</p><p>${md('[[Ctrl+D]] ends keyboard input for commands like `cat`.')}</p></div>
    <div class="panel-foot"><button type="button" class="btn" data-act="sandbox-reset">Reset sandbox files</button></div>`;
}

function reviewHtml() {
  if (!review) {
    const pool = drillPool();
    const fresh = pool.filter(d => !state.drills[d.id]).length;
    return `<div class="panel-top"><span class="eyebrow">Review · ${osName()}</span></div>
      <h2>Quick drills</h2>
      <div class="intro"><p>Eight short tasks, without step-by-step help. Tasks you miss come back sooner, tasks you get right come back later. That is how commands move into long-term memory.</p>
      <p class="fine">${pool.length} tasks available from the lessons you have finished${fresh ? `, ${fresh} of them new` : ''}. Finishing more lessons adds more.</p></div>
      <div class="panel-foot"><button type="button" class="btn primary" data-act="review-start">Start review</button></div>`;
  }
  const rows = review.results.map(r => `<li><span class="${r.ok ? 'ok' : 'no'}">${r.ok ? '✓' : '✗'}</span> ${md(r.d.q)}<br><code>${esc(r.d.a)}</code></li>`).join('');
  if (review.done) {
    const right = review.results.filter(r => r.ok).length;
    return `<div class="panel-top"><span class="eyebrow">Review · ${osName()}</span></div>
      <h2>${right} of ${review.items.length} on the first try</h2>
      <p class="fine">Time: ${Math.floor(review.secs / 60)}:${String(review.secs % 60).padStart(2, '0')} minutes. Missed tasks will show up again in the next round.</p>
      <ul class="results">${rows}</ul>
      <div class="panel-foot"><button type="button" class="btn primary" data-act="review-start">Another round</button></div>`;
  }
  return `<div class="panel-top"><span class="eyebrow">Review · ${osName()}</span></div>
    <h2>Question ${review.i + 1} of ${review.items.length}</h2>
    <div class="intro"><p>${md(review.items[review.i].q)}</p><p class="fine">${md('Type the command in the terminal. Each question starts with a fresh set of files. Type `skip` to move on.')}</p></div>
    ${rows ? `<h3>So far</h3><ul class="results">${rows}</ul>` : ''}`;
}

// ---------- reference panel ----------
function renderRef() {
  const body = $('ref-body');
  document.querySelector('.ref-search').hidden = refTab !== 'commands';
  for (const b of document.querySelectorAll('.ref-tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === refTab));
  const table = rows => `<table class="ref-table"><tbody>${rows.join('')}</tbody></table>`;
  if (refTab === 'syntax') { body.innerHTML = table(SYNTAX.map(([s, d, ex]) => `<tr><td>${esc(s)}</td><td>${esc(d)}<small>${esc(ex)}</small></td></tr>`)); return; }
  if (refTab === 'keys') { body.innerHTML = `<p class="fine" style="margin:8px 0">These work at the prompt of a real terminal too.</p>` + table(SHORTCUTS.map(([k, d]) => `<tr><td>${esc(k)}</td><td>${esc(d)}</td></tr>`)); return; }
  if (refTab === 'vi') {
    body.innerHTML = VIKEYS.map(([title, rows]) => `<h3>${esc(title)}</h3>` + table(rows.map(([k, d]) => `<tr><td>${esc(k)}</td><td>${esc(d)}</td></tr>`))).join('') + '<h3>nano, for comparison</h3>' + table(NANOKEYS.map(([k, d]) => `<tr><td>${esc(k)}</td><td>${esc(d)}</td></tr>`));
    return;
  }
  const q = $('ref-q').value.trim().toLowerCase();
  const hits = REF.filter(r => (!r.os || r.os === state.os) && (!q || r.name.includes(q) || r.sum.toLowerCase().includes(q) || r.opts.some(o => o[1].toLowerCase().includes(q)) || r.ex.some(e => e[1].toLowerCase().includes(q))));
  if (!hits.length) { body.innerHTML = `<p class="empty">No command matches “${esc(q)}”. Try a simpler word, such as “copy” or “search”.</p>`; return; }
  const pkgs = shell ? installedPkgs(mainFs || shell.fs) : {};
  const pm = state.os === 'mac' ? 'brew install' : 'sudo apt install';
  body.innerHTML = CATS.map(cat => {
    const rows = hits.filter(r => r.cat === cat);
    if (!rows.length) return '';
    return `<h3>${esc(cat)}</h3>` + rows.map(r => {
      const note = noteFor(r, state.os);
      const needs = r.pkg && !pkgs[r.pkg];
      return `<details${q && hits.length <= 3 ? ' open' : ''}><summary><b>${esc(r.name)}</b><span>${esc(r.sum)}</span></summary><div class="ref-card">
        ${needs ? `<span class="tag">Install first: ${esc(pm)} ${esc(r.pkg === 'fd' && state.os === 'linux' ? 'fd-find' : r.pkg)}</span>` : ''}
        <code class="syn">${esc(r.syn)}</code>
        ${r.opts.length ? `<dl>${r.opts.map(([k, d]) => `<dt>${esc(k)}</dt><dd>${esc(d)}</dd>`).join('')}</dl>` : ''}
        ${r.ex.map(([c, d]) => `<div class="ex"><button type="button" class="chip" data-insert="${esc(c)}" title="Put this command into the terminal">${esc(c)}</button><small>${esc(d)}</small></div>`).join('')}
        ${note ? `<p class="fine">${md(note)}</p>` : ''}
      </div></details>`;
    }).join('');
  }).join('');
}

function toggleRef(open) {
  const ref = $('ref');
  const show = open ?? ref.hidden;
  ref.hidden = !show;
  $('layout').classList.toggle('with-ref', show);
  $('btn-ref').setAttribute('aria-expanded', String(show));
  if (show) { renderRef(); $('ref-q').focus(); } else term.focus();
}

// ---------- helper strip under vi, nano, less ----------
function renderAssist(help) {
  const box = $('assist');
  if (!help || !state.assist) { if (!box.hidden) box.hidden = true; return; }
  const html = `<span class="mode">${esc(help.mode)}</span>${help.hint ? `<span>${esc(help.hint)}</span>` : ''}<span class="keys">${help.keys.map(([k, d]) => (k ? `<kbd>${esc(k)}</kbd> ${esc(d)}` : esc(d))).join(' · ')}</span>${viWhy ? `<span class="why">${md(viWhy)}</span>` : ''}`;
  if (box.dataset.html !== html) { box.innerHTML = html; box.dataset.html = html; }
  if (box.hidden) box.hidden = false;
}

function updateTitle(sh) {
  const home = sh.home;
  const where = sh.cwd === home ? '~' : sh.cwd.startsWith(home + '/') ? '~' + sh.cwd.slice(home.length) : sh.cwd;
  $('term-title').textContent = state.os === 'mac' ? `${sh.user.name} — ${sh.zsh ? '-zsh' : `ssh ${sh.host}`} — ${term.cols}×${term.rows}` : `${sh.user.name}@${sh.host}: ${where}`;
}

// ---------- settings ----------
function applyTheme() {
  const dark = state.theme === 'dark' || (state.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  root.dataset.theme = dark ? 'dark' : 'light';
  for (const b of document.querySelectorAll('#theme-seg button')) b.setAttribute('aria-pressed', String(b.dataset.themeOpt === state.theme));
}

function applyFont() {
  root.style.setProperty('--term-size', state.fontSize + 'px');
  $('font-size').value = state.fontSize;
  $('font-size-out').textContent = state.fontSize + ' px';
  term?.measure();
}

function bindSettings() {
  $('btn-settings').addEventListener('click', () => { $('reset-msg').textContent = ''; $('settings').showModal(); });
  $('settings').addEventListener('close', () => term.focus());
  $('theme-seg').addEventListener('click', e => {
    const opt = e.target.closest('button')?.dataset.themeOpt;
    if (!opt) return;
    state.theme = opt;
    save();
    applyTheme();
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
  $('font-size').addEventListener('input', e => { state.fontSize = +e.target.value; save(); applyFont(); });
  $('opt-assist').checked = state.assist;
  $('opt-assist').addEventListener('change', e => { state.assist = e.target.checked; save(); });
  $('opt-coach').checked = state.coach;
  $('opt-coach').addEventListener('change', e => { state.coach = e.target.checked; save(); });
  $('btn-reset-sandbox').addEventListener('click', () => resetSandbox());
  $('btn-reset-progress').addEventListener('click', async () => {
    if (!confirm('Reset all progress, review history and sandbox files? This cannot be undone.')) return;
    const keep = { os: state.os, theme: state.theme, fontSize: state.fontSize, assist: state.assist, coach: state.coach };
    clearState();
    state = { ...loadState(), ...keep };
    save();
    $('reset-msg').textContent = 'Progress has been reset.';
    await setMode('learn');
  });
}

async function resetSandbox() {
  state.sandbox = { mac: null, linux: null };
  save();
  $('reset-msg').textContent = 'Sandbox files are back to their starting state.';
  if (state.mode === 'sandbox') await startSandbox();
}

// ---------- wiring ----------
function insertIntoTerminal(text) {
  if (term.mode !== 'line') { term.focus(); return; }
  term.type(text);
  term.focus();
}

async function copyText(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = 'Copied. Now paste it';
  } catch {
    insertIntoTerminal(text); // clipboard blocked: put it on the command line directly
    btn.textContent = 'Inserted';
  }
  term.focus();
}

function bind() {
  document.querySelector('.modes').addEventListener('click', e => { const m = e.target.closest('button')?.dataset.mode; if (m && m !== state.mode) setMode(m).then(() => term.focus()); });
  document.querySelector('.os').addEventListener('click', e => { const os = e.target.closest('button')?.dataset.os; if (os && os !== state.os) { save(); setOs(os).then(() => term.focus()); } });
  $('btn-ref').addEventListener('click', () => toggleRef());
  $('btn-ref-close').addEventListener('click', () => toggleRef(false));
  $('ref').addEventListener('keydown', e => { if (e.key === 'Escape') toggleRef(false); });
  document.querySelector('.ref-tabs').addEventListener('click', e => { const t = e.target.closest('button')?.dataset.tab; if (t) { refTab = t; renderRef(); } });
  $('ref-q').addEventListener('input', renderRef);

  // One click handler for all buttons that are created dynamically.
  document.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.insert) { insertIntoTerminal(b.dataset.insert); return; }
    if (b.dataset.copy) { copyText(b.dataset.copy, b); return; }
    if (b.dataset.lesson) { startLesson(b.dataset.lesson).then(() => term.focus()); return; }
    const focusAfter = p => Promise.resolve(p).then(() => term.focus());
    switch (b.dataset.act) {
      case 'hint': showHint(false); term.focus(); break;
      case 'next': { const n = nextLessonOf(lesson.id); if (n) focusAfter(startLesson(n.id)); break; }
      case 'restart': focusAfter(startLesson(lesson.id)); break;
      case 'course': panelView = 'course'; renderPanel(); $('panel').focus(); break;
      case 'lesson': panelView = 'lesson'; renderPanel(); break;
      case 'sandbox-reset': if (confirm('Put the sandbox files back to their starting state?')) focusAfter(resetSandbox()); break;
      case 'review-start': focusAfter(startReview()); break;
      case 'review-skip': if (review && !review.done && term.mode === 'line') skipDrill(false); term.focus(); break;
      default:
    }
  });

  // F6 cycles the focus between the terminal and the panels (the terminal itself captures Tab).
  document.addEventListener('keydown', e => {
    if (e.key !== 'F6') return;
    e.preventDefault();
    const stops = [term.ta, $('panel'), ...($('ref').hidden ? [] : [$('ref-body')]), $('btn-ref')];
    const i = stops.findIndex(el => el === document.activeElement || el.contains(document.activeElement));
    stops[(i + 1) % stops.length].focus();
  });
}

async function boot() {
  root.dataset.os = state.os;
  for (const b of document.querySelectorAll('.os button')) b.setAttribute('aria-pressed', String(b.dataset.os === state.os));
  applyTheme();
  term = new Terminal($('terminal'), { onKey: onEvent, onLine, onAssist: renderAssist, onPrompt: updateTitle });
  applyFont();
  bind();
  bindSettings();
  course = buildCourse(state.os);
  await setMode(state.mode);
  term.focus();
  // Handy for exploring and for automated checks.
  globalThis.trainer = { term, get shell() { return shell; }, get state() { return state; }, startLesson, setMode, setOs };
}

boot();
