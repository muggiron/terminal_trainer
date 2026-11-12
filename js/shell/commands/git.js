// A simulated git: enough of the real thing to practise the everyday workflow
// (init, status, add, commit, log, diff, branch, switch, merge, clone, stash).
//
// Repository state lives on the .git directory node as `repo`:
//   { head, branches: { name: commitId|null }, commits: { id: commit }, index: { path: text },
//     remotes: { origin: url }, pushed, merging, conflicts: [], stash: [], seq }

import { def } from '../registry.js';
import { FsError, norm, dirname, basename } from '../vfs.js';
import { sgr, splitLines, unifiedHunks, diffOps, globToRe, DAYS, MONTHS, p2 } from '../util.js';
import { page } from './text.js';
import { runVi } from './editors.js';

const SUBS = ['add', 'branch', 'checkout', 'clone', 'commit', 'config', 'diff', 'init', 'log', 'merge', 'pull', 'push', 'remote', 'reset', 'restore', 'show', 'stash', 'status', 'switch', 'help'];

const hash = s => {
  let out = '';
  for (let seed = 0; seed < 5; seed++) {
    let h = 2166136261 ^ (seed * 16777619);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    out += (h >>> 0).toString(16).padStart(8, '0');
  }
  return out;
};
const short = id => id.slice(0, 7);
const gitDate = ms => {
  const d = new Date(ms);
  const off = -d.getTimezoneOffset();
  return `${DAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${d.getDate()} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())} ${d.getFullYear()} ${off < 0 ? '-' : '+'}${p2(Math.floor(Math.abs(off) / 60))}${p2(Math.abs(off) % 60)}`;
};
const relPath = (from, to) => {
  const a = from.split('/').filter(Boolean), b = to.split('/').filter(Boolean);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/') || '.';
};

export function findRepo(sh) {
  let p = sh.cwd;
  for (;;) {
    let g = null;
    try { g = sh.fs.get(p === '/' ? '/.git' : p + '/.git'); } catch { /* ignore */ }
    if (g && g.t === 'd' && g.repo) return { root: p, repo: g.repo };
    if (p === '/') return null;
    p = dirname(p);
  }
}

const headId = repo => repo.branches[repo.head] ?? null;
const treeOf = (repo, id) => (id ? repo.commits[id].tree : {});
const headTree = repo => treeOf(repo, headId(repo));

function ignoreTest(text) {
  const rules = splitLines(text || '').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  const tests = rules.map(r => {
    if (r.endsWith('/')) { const d = r.slice(0, -1).replace(/^\//, ''); return p => ('/' + p + '/').includes('/' + d + '/'); }
    const re = globToRe(r.replace(/^\//, ''));
    return p => re.test(p) || re.test(basename(p)) || p.split('/').some(seg => re.test(seg));
  });
  return p => tests.some(t => t(p));
}

function workTree(c, root) {
  const out = {};
  const pre = root === '/' ? 1 : root.length + 1;
  let ignored = () => false;
  try { ignored = ignoreTest(c.fs.read(norm('.gitignore', root), null)); } catch { /* no .gitignore */ }
  c.fs.walk(root, (p, n) => {
    if (n.t !== 'f') return;
    const rel = p.slice(pre);
    if (rel.startsWith('.git/') || ignored(rel)) return;
    out[rel] = n.data;
  });
  return out;
}

function writeWork(c, root, path, text) {
  const abs = norm(path, root);
  if (text === undefined) { try { c.fs.rm(abs, null); } catch (e) { if (!(e instanceof FsError)) throw e; } return; }
  c.fs.mkdir(dirname(abs), c.user, { p: true });
  c.fs.write(abs, text, c.user);
}

function changes(repo, work) {
  const head = headTree(repo);
  const idx = repo.index;
  const staged = [], unstaged = [], untracked = [];
  for (const p of [...new Set([...Object.keys(head), ...Object.keys(idx)])].sort()) {
    if (!(p in head)) staged.push(['new file', p]);
    else if (!(p in idx)) staged.push(['deleted', p]);
    else if (head[p] !== idx[p]) staged.push(['modified', p]);
  }
  for (const p of Object.keys(idx).sort()) {
    if (!(p in work)) unstaged.push(['deleted', p]);
    else if (work[p] !== idx[p]) unstaged.push(['modified', p]);
  }
  const dirs = new Set();
  for (const p of Object.keys(work).sort()) {
    if (p in idx) continue;
    const parts = p.split('/');
    let shown = p;
    for (let i = 1; i < parts.length; i++) {
      const d = parts.slice(0, i).join('/') + '/';
      if (!Object.keys(idx).some(k => k.startsWith(d))) { shown = d; break; }
    }
    if (!dirs.has(shown)) { dirs.add(shown); untracked.push(shown); }
  }
  return { staged, unstaged, untracked };
}

function gitConfig(c) {
  const file = `${c.sh.home}/.gitconfig`;
  const cfg = {};
  let text = '';
  try { text = c.fs.read(file, null); } catch { /* none */ }
  let sec = '';
  for (const l of splitLines(text)) {
    let m;
    if ((m = l.match(/^\s*\[(\w+)\]/))) sec = m[1];
    else if ((m = l.match(/^\s*([\w-]+)\s*=\s*(.*)$/))) cfg[`${sec}.${m[1]}`] = m[2];
  }
  const save = () => {
    const secs = {};
    for (const [k, v] of Object.entries(cfg)) { const [s, n] = k.split('.'); (secs[s] ??= []).push(`\t${n} = ${v}`); }
    c.fs.write(file, Object.entries(secs).map(([s, ls]) => `[${s}]\n${ls.join('\n')}\n`).join(''), c.user);
  };
  return { cfg, save };
}

const ancestors = (repo, id) => {
  const seen = new Set();
  const stack = id ? [id] : [];
  while (stack.length) {
    const x = stack.pop();
    if (!x || seen.has(x)) continue;
    seen.add(x);
    const cm = repo.commits[x];
    stack.push(cm.parent, cm.parent2);
  }
  return seen;
};

function diffText(c, a, b, path, color) {
  const A = a === undefined ? [] : splitLines(a), B = b === undefined ? [] : splitLines(b);
  const B1 = s => (color ? sgr('1', s) : s);
  const out = [B1(`diff --git a/${path} b/${path}`)];
  if (a === undefined) out.push(B1('new file mode 100644'));
  if (b === undefined) out.push(B1('deleted file mode 100644'));
  out.push(B1(`index ${a === undefined ? '0000000' : short(hash(a))}..${b === undefined ? '0000000' : short(hash(b))}${a !== undefined && b !== undefined ? ' 100644' : ''}`));
  out.push(B1(`--- ${a === undefined ? '/dev/null' : 'a/' + path}`), B1(`+++ ${b === undefined ? '/dev/null' : 'b/' + path}`));
  for (const l of unifiedHunks(A, B)) out.push(!color ? l : l[0] === '@' ? sgr('36', l) : l[0] === '+' ? sgr('32', l) : l[0] === '-' ? sgr('31', l) : l);
  return out.join('\n') + '\n';
}

function stat(oldTree, newTree) {
  const rows = [];
  let ins = 0, del = 0;
  for (const p of [...new Set([...Object.keys(oldTree), ...Object.keys(newTree)])].sort()) {
    if (oldTree[p] === newTree[p]) continue;
    const ops = diffOps(splitLines(oldTree[p] ?? ''), splitLines(newTree[p] ?? ''));
    const a = ops.filter(o => o.t === '+').length, d = ops.filter(o => o.t === '-').length;
    ins += a;
    del += d;
    rows.push({ p, a, d, kind: !(p in oldTree) ? 'create' : !(p in newTree) ? 'delete' : 'modify' });
  }
  const sum = ` ${rows.length} file${rows.length === 1 ? '' : 's'} changed${ins ? `, ${ins} insertion${ins === 1 ? '' : 's'}(+)` : ''}${del ? `, ${del} deletion${del === 1 ? '' : 's'}(-)` : ''}`;
  return { rows, sum };
}
const statLines = rows => {
  const w = Math.max(...rows.map(r => r.p.length));
  return rows.map(r => ` ${r.p.padEnd(w)} | ${String(r.a + r.d).padStart(2)} ${'+'.repeat(Math.min(r.a, 30))}${'-'.repeat(Math.min(r.d, 30))}`).join('\n');
};

function makeCommit(repo, msg, author, extra = {}) {
  const parent = headId(repo);
  const time = Date.now();
  repo.seq = (repo.seq || 0) + 1;
  const id = hash(JSON.stringify(repo.index) + msg + time + parent + repo.seq);
  repo.commits[id] = { id, msg, parent, parent2: extra.parent2 || null, tree: { ...repo.index }, time, author, seq: repo.seq };
  repo.branches[repo.head] = id;
  return id;
}

// Move the working tree and index from one snapshot to another, refusing to clobber local edits.
function moveTree(c, R, from, to) {
  const { repo, root } = R;
  const work = workTree(c, root);
  const blocked = [];
  for (const p of new Set([...Object.keys(from), ...Object.keys(to)])) {
    if (from[p] === to[p]) continue;
    if (work[p] !== from[p] || repo.index[p] !== from[p]) blocked.push(p);
  }
  if (blocked.length) return blocked.sort();
  for (const p of new Set([...Object.keys(from), ...Object.keys(to)])) {
    if (from[p] === to[p]) continue;
    writeWork(c, root, p, to[p]);
    if (to[p] === undefined) delete repo.index[p]; else repo.index[p] = to[p];
  }
  return null;
}

function statusText(c, R, color) {
  const { repo, root } = R;
  const { staged, unstaged, untracked } = changes(repo, workTree(c, root));
  const rel = p => relPath(c.sh.cwd, norm(p, root)) + (p.endsWith('/') ? '/' : '');
  const G = s => (color ? sgr('32', s) : s), Rd = s => (color ? sgr('31', s) : s);
  let s = `On branch ${repo.head}\n`;
  let gap = false; // real git puts a blank line before a section only when something precedes it
  const has = !!headId(repo);
  if (repo.remotes.origin && has) {
    const ahead = [...ancestors(repo, headId(repo))].filter(x => !ancestors(repo, repo.pushed).has(x)).length;
    s += ahead ? `Your branch is ahead of 'origin/${repo.head}' by ${ahead} commit${ahead === 1 ? '' : 's'}.\n  (use "git push" to publish your local commits)\n` : `Your branch is up to date with 'origin/${repo.head}'.\n`;
    gap = true;
  }
  if (!has) { s += '\nNo commits yet\n'; gap = true; }
  const section = text => { s += (gap ? '\n' : '') + text; gap = true; };
  const conflicts = repo.conflicts || [];
  if (repo.merging) section(conflicts.length ? 'You have unmerged paths.\n  (fix conflicts and run "git commit")\n  (use "git merge --abort" to abort the merge)\n' : 'All conflicts fixed but you are still merging.\n  (use "git commit" to conclude merge)\n');
  const st = staged.filter(([, p]) => !conflicts.includes(p));
  const un = unstaged.filter(([, p]) => !conflicts.includes(p));
  if (st.length) section(`Changes to be committed:\n  (use "git ${has ? 'restore --staged' : 'rm --cached'} <file>..." to unstage)\n` + st.map(([k, p]) => '\t' + G(`${(k + ':').padEnd(12)}${rel(p)}`)).join('\n') + '\n');
  if (conflicts.length) section('Unmerged paths:\n  (use "git add <file>..." to mark resolution)\n' + conflicts.map(p => '\t' + Rd(`both modified:   ${rel(p)}`)).join('\n') + '\n');
  if (un.length) section('Changes not staged for commit:\n  (use "git add <file>..." to update what will be committed)\n  (use "git restore <file>..." to discard changes in working directory)\n' + un.map(([k, p]) => '\t' + Rd(`${(k + ':').padEnd(12)}${rel(p)}`)).join('\n') + '\n');
  if (untracked.length) section('Untracked files:\n  (use "git add <file>..." to include in what will be committed)\n' + untracked.map(p => '\t' + Rd(rel(p))).join('\n') + '\n');
  if (!st.length && !conflicts.length) {
    if (un.length) section('no changes added to commit (use "git add" and/or "git commit -a")\n');
    else if (untracked.length) section('nothing added to commit but untracked files present (use "git add" to track)\n');
    else section(has ? 'nothing to commit, working tree clean\n' : 'nothing to commit (create/copy files and use "git add" to track)\n');
  }
  return s;
}

const DEMO_FILES = {
  'README.md': '# hello-world\n\nA tiny example repository for practising git.\n\n## Usage\n\n    python3 hello.py\n',
  'hello.py': 'def greet(name):\n    return f"Hello, {name}!"\n\n\nif __name__ == "__main__":\n    print(greet("world"))\n',
  '.gitignore': '__pycache__/\n*.log\n.DS_Store\n',
};

def('git', async c => {
  const sh = c.sh;
  const [sub, ...args] = c.args;
  const color = c.tty;
  const fatal = (msg, code, target, st = 128) => {
    c.err(msg + '\n');
    sh.lastErr = { cmd: 'git', code, target };
    return st;
  };
  if (!sub || sub === 'help' || sub === '--help') {
    c.println("usage: git [-v | --version] [-h | --help] <command> [<args>]\n\nThese are common Git commands used in various situations:\n\nstart a working area\n   clone     Clone a repository into a new directory\n   init      Create an empty Git repository or reinitialize an existing one\n\nwork on the current change\n   add       Add file contents to the index\n   restore   Restore working tree files\n\nexamine the history and state\n   diff      Show changes between commits, commit and working tree, etc\n   log       Show commit logs\n   show      Show various types of objects\n   status    Show the working tree status\n\ngrow, mark and tweak your common history\n   branch    List, create, or delete branches\n   commit    Record changes to the repository\n   merge     Join two or more development histories together\n   switch    Switch branches\n\ncollaborate\n   pull      Fetch from and integrate with another repository or a local branch\n   push      Update remote refs along with associated objects");
    return sub ? 0 : 1;
  }
  if (sub === '--version' || sub === '-v' || sub === 'version') { c.println('git version 2.47.0'); return 0; }

  if (sub === 'config') {
    const { cfg, save } = gitConfig(c);
    const a = args.filter(x => x !== '--global' && x !== '--local');
    if (a[0] === '--list' || a[0] === '-l') { for (const [k, v] of Object.entries(cfg)) c.println(`${k}=${v}`); return 0; }
    if (a[0] === '--get') a.shift();
    if (!a.length) return fatal('usage: git config [<options>]', 'USAGE', '', 129);
    if (a.length === 1) { if (cfg[a[0]] === undefined) return 1; c.println(cfg[a[0]]); return 0; }
    if (!/^\w+\.[\w-]+$/.test(a[0])) return fatal(`error: key does not contain a section: ${a[0]}`, 'GIT_CONFIG', a[0], 2);
    cfg[a[0]] = a.slice(1).join(' ');
    save();
    return 0;
  }

  if (sub === 'init') {
    const dir = args.find(x => !x.startsWith('-'));
    const root = dir ? c.abs(dir) : sh.cwd;
    if (dir) c.fs.mkdir(root, c.user, { p: true });
    const g = norm('.git', root);
    const ex = c.fs.get(g);
    if (ex && ex.repo) { c.println(`Reinitialized existing Git repository in ${g}/`); return 0; }
    c.fs.mkdir(g, c.user);
    c.fs.write(g + '/HEAD', 'ref: refs/heads/main\n', c.user);
    c.fs.write(g + '/config', '[core]\n\trepositoryformatversion = 0\n\tfilemode = true\n\tbare = false\n', c.user);
    c.fs.write(g + '/description', "Unnamed repository; edit this file 'description' to name the repository.\n", c.user);
    c.fs.get(g).repo = { head: 'main', branches: { main: null }, commits: {}, index: {}, remotes: {}, pushed: null, merging: null, conflicts: [], stash: [], seq: 0 };
    c.println(`Initialized empty Git repository in ${g}/`);
    return 0;
  }

  if (sub === 'clone') {
    const a = args.filter(x => !x.startsWith('-'));
    if (!a.length) return fatal('fatal: You must specify a repository to clone.', 'USAGE', '', 129);
    const url = a[0];
    const name = a[1] || basename(url).replace(/\.git$/, '');
    const root = c.abs(name);
    const ex = c.fs.get(root);
    if (ex && (ex.t !== 'd' || ex.kids.size)) return fatal(`fatal: destination path '${name}' already exists and is not an empty directory.`, 'GIT_CLONE_EXISTS', name);
    c.err(`Cloning into '${name}'...\n`);
    await sh.sleep(500);
    if (!/github\.com[/:]example\/hello-world(\.git)?\/?$/.test(url)) return fatal(`remote: Repository not found.\nfatal: repository '${url}' not found`, 'GIT_CLONE', url);
    c.fs.mkdir(root, c.user, { p: true });
    c.fs.mkdir(root + '/.git', c.user);
    c.fs.write(root + '/.git/HEAD', 'ref: refs/heads/main\n', c.user);
    const repo = { head: 'main', branches: { main: null }, commits: {}, index: {}, remotes: { origin: url }, pushed: null, merging: null, conflicts: [], stash: [], seq: 0 };
    const author = 'Ada Lovelace <ada@example.com>';
    const steps = [['Initial commit', { 'README.md': '# hello-world\n' }], ['Add greeting script', { 'hello.py': DEMO_FILES['hello.py'] }], ['Document usage and ignore caches', { 'README.md': DEMO_FILES['README.md'], '.gitignore': DEMO_FILES['.gitignore'] }]];
    for (const [msg, files] of steps) {
      Object.assign(repo.index, files);
      const id = makeCommit(repo, msg, author);
      repo.commits[id].time = Date.now() - (4 - repo.seq) * 86400e3 * 3;
    }
    repo.pushed = headId(repo);
    c.fs.get(root + '/.git').repo = repo;
    for (const [p, t] of Object.entries(repo.index)) c.fs.write(norm(p, root), t, c.user);
    c.err('remote: Enumerating objects: 12, done.\nremote: Counting objects: 100% (12/12), done.\nremote: Compressing objects: 100% (8/8), done.\nremote: Total 12 (delta 1), reused 12 (delta 1), pack-reused 0\nReceiving objects: 100% (12/12), done.\nResolving deltas: 100% (1/1), done.\n');
    return 0;
  }

  const R = findRepo(sh);
  if (!SUBS.includes(sub) && !['rm', 'mv', 'fetch', 'rebase', 'tag', 'cherry-pick', 'revert'].includes(sub)) {
    const near = SUBS.filter(s => s.startsWith(sub.slice(0, 2)) || sub.startsWith(s.slice(0, 3)));
    return fatal(`git: '${sub}' is not a git command. See 'git --help'.${near.length ? `\n\nThe most similar command${near.length > 1 ? 's are' : ' is'}\n${near.map(n => '\t' + n).join('\n')}` : ''}`, 'GIT_SUB', sub, 1);
  }
  if (!R) return fatal('fatal: not a git repository (or any of the parent directories): .git', 'GIT_NOREPO');
  const { repo, root } = R;
  repo.conflicts ??= [];
  repo.stash ??= [];
  const toRel = p => { const abs = c.abs(p); return abs === root ? '' : abs.startsWith(root === '/' ? '/' : root + '/') ? abs.slice(root === '/' ? 1 : root.length + 1) : null; };
  const identity = () => {
    const { cfg } = gitConfig(c);
    if (cfg['user.name'] && cfg['user.email']) return `${cfg['user.name']} <${cfg['user.email']}>`;
    fatal(`Author identity unknown\n\n*** Please tell me who you are.\n\nRun\n\n  git config --global user.email "you@example.com"\n  git config --global user.name "Your Name"\n\nto set your account's default identity.\nOmit --global to set the identity only in this repository.\n\nfatal: unable to auto-detect email address (got '${sh.user.name}@${sh.host}.(none)')`, 'GIT_IDENT');
    return null;
  };
  const show = async text => {
    if (c.tty && c.io.fullscreen && text.split('\n').length > c.rows - 1) { sh.tip('pager', { cmd: 'git ' + sub }); await page(c, text); }
    else c.out(text);
  };
  const refName = name => (name === 'HEAD' ? headId(repo) : repo.branches[name] ?? Object.keys(repo.commits).find(id => name.length >= 4 && id.startsWith(name)) ?? null);

  switch (sub) {
    case 'status': {
      if (args.includes('-s') || args.includes('--short')) {
        const { staged, unstaged, untracked } = changes(repo, workTree(c, root));
        const m = {};
        for (const [k, p] of staged) m[p] = [k === 'new file' ? 'A' : k === 'deleted' ? 'D' : 'M', ' '];
        for (const [k, p] of unstaged) (m[p] ??= [' ', ' '])[1] = k === 'deleted' ? 'D' : 'M';
        for (const p of Object.keys(m).sort()) c.println(`${color ? sgr('32', m[p][0]) + sgr('31', m[p][1]) : m[p].join('')} ${p}`);
        for (const p of untracked) c.println(`${color ? sgr('31', '??') : '??'} ${p}`);
        return 0;
      }
      c.out(statusText(c, R, color));
      return 0;
    }
    case 'add': {
      const all = args.some(x => x === '-A' || x === '--all');
      const specs = args.filter(x => !x.startsWith('-'));
      if (!specs.length && !all) { c.err("Nothing specified, nothing added.\nhint: Maybe you wanted to say 'git add .'?\n"); sh.lastErr = { cmd: 'git', code: 'GIT_ADD_NOTHING' }; return 0; }
      const work = workTree(c, root);
      for (const s of all && !specs.length ? [root] : specs) {
        const rel = toRel(s);
        if (rel === null) return fatal(`fatal: ${s}: '${s}' is outside repository at '${root}'`, 'GIT_OUTSIDE', s);
        const under = p => rel === '' || p === rel || p.startsWith(rel + '/');
        const hits = [...Object.keys(work), ...Object.keys(repo.index)].filter(under);
        if (!hits.length) return fatal(`fatal: pathspec '${s}' did not match any files`, 'GIT_PATHSPEC', s);
        for (const p of hits) {
          if (p in work) repo.index[p] = work[p]; else delete repo.index[p];
          repo.conflicts = repo.conflicts.filter(x => x !== p);
        }
      }
      return 0;
    }
    case 'commit': {
      let msg = null, addAll = false;
      for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === '--message' || /^-[a-z]*m$/.test(a)) { if (a.includes('a') && a !== '--message') addAll = true; msg = (msg ? msg + '\n\n' : '') + (args[++i] ?? ''); }
        else if (a === '-a' || a === '--all') addAll = true;
        else if (a.startsWith('-m')) msg = a.slice(2);
      }
      if (repo.conflicts.length) return fatal(`error: Committing is not possible because you have unmerged files.\nhint: Fix them up in the work tree, and then use 'git add/rm <file>'\nhint: as appropriate to mark resolution and make a commit.\nfatal: Exiting because of an unresolved conflict.`, 'GIT_UNMERGED');
      if (addAll) {
        const work = workTree(c, root);
        for (const p of Object.keys(repo.index)) { if (p in work) repo.index[p] = work[p]; else delete repo.index[p]; }
      }
      const before = headTree(repo);
      const st = stat(before, repo.index);
      if (!st.rows.length && !repo.merging && !args.includes('--allow-empty')) {
        c.out(statusText(c, R, false));
        sh.lastErr = { cmd: 'git', code: 'GIT_NOTHING' };
        return 1;
      }
      const author = identity();
      if (!author) return 128;
      if (msg === null) {
        if (!c.tty || !c.io.fullscreen) return fatal('error: Terminal is dumb, but EDITOR unset\nPlease supply the message using either -m or -F option.', 'GIT_NOMSG', '', 1);
        const file = norm('.git/COMMIT_EDITMSG', root);
        const list = st.rows.map(r => `#\t${r.kind === 'create' ? 'new file:   ' : r.kind === 'delete' ? 'deleted:    ' : 'modified:   '}${r.p}`).join('\n');
        c.fs.write(file, `${repo.merging ? `Merge branch '${repo.merging.name}'` : ''}\n# Please enter the commit message for your changes. Lines starting\n# with '#' will be ignored, and an empty message aborts the commit.\n#\n# On branch ${repo.head}\n# Changes to be committed:\n${list}\n#\n`, c.user);
        sh.tip('git-editor', {});
        await runVi(c, file);
        msg = splitLines(c.fs.read(file, null)).filter(l => !l.startsWith('#')).join('\n').trim();
      }
      if (!msg) return fatal('Aborting commit due to empty commit message.', 'GIT_EMPTY_MSG', '', 1);
      const root1 = !headId(repo);
      const id = makeCommit(repo, msg, author, { parent2: repo.merging?.theirs });
      repo.merging = null;
      c.println(`[${repo.head}${root1 ? ' (root-commit)' : ''} ${short(id)}] ${msg.split('\n')[0]}`);
      if (st.rows.length) {
        c.println(st.sum);
        for (const r of st.rows) if (r.kind !== 'modify') c.println(` ${r.kind} mode 100644 ${r.p}`);
      }
      return 0;
    }
    case 'log': {
      if (!headId(repo)) return fatal(`fatal: your current branch '${repo.head}' does not have any commits yet`, 'GIT_NOCOMMITS');
      const oneline = args.includes('--oneline');
      let max = Infinity;
      args.forEach((a, i) => { let m; if ((m = a.match(/^-(\d+)$/))) max = +m[1]; else if (a === '-n') max = +args[i + 1]; });
      const start = refName(args.find(a => !a.startsWith('-') && !/^\d+$/.test(a)) || 'HEAD');
      const list = [...ancestors(repo, start)].map(id => repo.commits[id]).sort((a, b) => b.seq - a.seq).slice(0, max);
      const deco = id => {
        const names = Object.keys(repo.branches).filter(b => repo.branches[b] === id);
        const parts = [];
        if (headId(repo) === id) parts.push(color ? sgr('1;36', 'HEAD -> ') + sgr('1;32', repo.head) : `HEAD -> ${repo.head}`);
        if (repo.pushed === id && repo.remotes.origin) parts.push(color ? sgr('1;31', `origin/${repo.head}`) : `origin/${repo.head}`);
        for (const b of names) if (b !== repo.head || headId(repo) !== id) parts.push(color ? sgr('1;32', b) : b);
        const y = s => (color ? sgr('33', s) : s);
        return parts.length ? ` ${y('(')}${parts.join(y(', '))}${y(')')}` : '';
      };
      const text = list.map(cm => {
        if (oneline) return `${color ? sgr('33', short(cm.id)) : short(cm.id)}${deco(cm.id)} ${cm.msg.split('\n')[0]}`;
        return `${color ? sgr('33', 'commit ' + cm.id) : 'commit ' + cm.id}${deco(cm.id)}\n${cm.parent2 ? `Merge: ${short(cm.parent)} ${short(cm.parent2)}\n` : ''}Author: ${cm.author}\nDate:   ${gitDate(cm.time)}\n\n${cm.msg.split('\n').map(l => '    ' + l).join('\n')}\n`;
      }).join('\n') + (oneline ? '\n' : '');
      await show(text);
      return 0;
    }
    case 'diff': {
      const staged = args.includes('--staged') || args.includes('--cached');
      const refs = args.filter(a => !a.startsWith('-') && refName(a) && !c.fs.get(c.abs(a)));
      const paths = args.filter(a => !a.startsWith('-') && !refs.includes(a)).map(toRel).filter(p => p !== null);
      const work = workTree(c, root);
      let from, to;
      if (refs.length === 2) { from = treeOf(repo, refName(refs[0])); to = treeOf(repo, refName(refs[1])); }
      else if (refs.length === 1) { from = treeOf(repo, refName(refs[0])); to = Object.fromEntries(Object.keys(repo.index).filter(p => p in work).map(p => [p, work[p]])); }
      else if (staged) { from = headTree(repo); to = repo.index; }
      else { from = repo.index; to = Object.fromEntries(Object.keys(repo.index).filter(p => p in work).map(p => [p, work[p]])); }
      let text = '';
      for (const p of [...new Set([...Object.keys(from), ...Object.keys(to)])].sort()) {
        if (from[p] === to[p] || (paths.length && !paths.some(x => x === '' || p === x || p.startsWith(x + '/')))) continue;
        text += diffText(c, from[p], to[p], p, color);
      }
      if (text) await show(text);
      else if (c.tty && !staged && changes(repo, work).staged.length) sh.tip('git-diff-staged', {});
      return 0;
    }
    case 'show': {
      const id = refName(args.find(a => !a.startsWith('-')) || 'HEAD');
      if (!id) return fatal(`fatal: ambiguous argument '${args[0] ?? 'HEAD'}': unknown revision or path not in the working tree.`, 'GIT_NOCOMMITS');
      const cm = repo.commits[id];
      const prev = treeOf(repo, cm.parent);
      let text = `${color ? sgr('33', 'commit ' + id) : 'commit ' + id}\nAuthor: ${cm.author}\nDate:   ${gitDate(cm.time)}\n\n${cm.msg.split('\n').map(l => '    ' + l).join('\n')}\n\n`;
      for (const p of [...new Set([...Object.keys(prev), ...Object.keys(cm.tree)])].sort()) if (prev[p] !== cm.tree[p]) text += diffText(c, prev[p], cm.tree[p], p, color);
      await show(text);
      return 0;
    }
    case 'branch': {
      const flags = args.filter(a => a.startsWith('-'));
      const names = args.filter(a => !a.startsWith('-'));
      if (flags.some(f => /^-[dD]$/.test(f) || f === '--delete')) {
        for (const n of names) {
          if (!(n in repo.branches)) return fatal(`error: branch '${n}' not found`, 'GIT_NOBRANCH', n, 1);
          if (n === repo.head) return fatal(`error: cannot delete branch '${n}' used by worktree at '${root}'`, 'GIT_BRANCH_CURRENT', n, 1);
          if (flags.includes('-d') && repo.branches[n] && !ancestors(repo, headId(repo)).has(repo.branches[n])) return fatal(`error: the branch '${n}' is not fully merged\nhint: If you are sure you want to delete it, run 'git branch -D ${n}'`, 'GIT_NOT_MERGED', n, 1);
          c.println(`Deleted branch ${n} (was ${short(repo.branches[n] || '0000000')}).`);
          delete repo.branches[n];
        }
        return 0;
      }
      if (flags.some(f => /^-[mM]$/.test(f))) {
        const [a, b] = names.length > 1 ? names : [repo.head, names[0]];
        if (!b) return fatal('fatal: branch name required', 'USAGE');
        repo.branches[b] = repo.branches[a];
        delete repo.branches[a];
        if (repo.head === a) repo.head = b;
        return 0;
      }
      if (!names.length) {
        for (const b of Object.keys(repo.branches).sort()) {
          if (!headId(repo) && b === repo.head) continue;
          const v = flags.includes('-v') && repo.branches[b] ? ` ${short(repo.branches[b])} ${repo.commits[repo.branches[b]].msg.split('\n')[0]}` : '';
          c.println(b === repo.head ? `* ${color ? sgr('32', b) : b}${v}` : `  ${b}${v}`);
        }
        return 0;
      }
      if (!headId(repo)) return fatal(`fatal: not a valid object name: '${repo.head}'`, 'GIT_NOCOMMITS');
      if (names[0] in repo.branches) return fatal(`fatal: a branch named '${names[0]}' already exists`, 'GIT_BRANCH_EXISTS', names[0]);
      if (!/^[\w./-]+$/.test(names[0])) return fatal(`fatal: '${names[0]}' is not a valid branch name`, 'GIT_BRANCH_NAME', names[0]);
      repo.branches[names[0]] = names[1] ? refName(names[1]) : headId(repo);
      if (c.tty) sh.tip('git-branch-created', { name: names[0] });
      return 0;
    }
    case 'switch': case 'checkout': {
      const create = args.findIndex(a => a === '-c' || a === '-b' || a === '--create');
      const names = args.filter(a => !a.startsWith('-'));
      if (sub === 'checkout' && (args.includes('--') || (names.length && !(names[0] in repo.branches) && create < 0 && toRel(names[0]) !== null && toRel(names[0]) in repo.index))) {
        for (const f of names) {
          const rel = toRel(f);
          if (rel === null || !(rel in repo.index)) return fatal(`error: pathspec '${f}' did not match any file(s) known to git`, 'GIT_PATHSPEC', f, 1);
          writeWork(c, root, rel, repo.index[rel]);
        }
        c.err(`Updated ${names.length} path${names.length === 1 ? '' : 's'} from the index\n`);
        return 0;
      }
      const name = names[0];
      if (!name) return fatal(sub === 'switch' ? 'fatal: missing branch or commit argument' : `Your branch is up to date.`, 'USAGE', '', sub === 'switch' ? 128 : 0);
      if (create >= 0) {
        if (name in repo.branches) return fatal(`fatal: a branch named '${name}' already exists`, 'GIT_BRANCH_EXISTS', name);
        repo.branches[name] = headId(repo);
        repo.head = name;
        c.err(`Switched to a new branch '${name}'\n`);
        return 0;
      }
      if (!(name in repo.branches)) return fatal(sub === 'switch' ? `fatal: invalid reference: ${name}` : `error: pathspec '${name}' did not match any file(s) known to git`, 'GIT_NOBRANCH', name, sub === 'switch' ? 128 : 1);
      if (name === repo.head) { c.err(`Already on '${name}'\n`); return 0; }
      const blocked = moveTree(c, R, headTree(repo), treeOf(repo, repo.branches[name]));
      if (blocked) return fatal(`error: Your local changes to the following files would be overwritten by checkout:\n${blocked.map(p => '\t' + p).join('\n')}\nPlease commit your changes or stash them before you switch branches.\nAborting`, 'GIT_DIRTY', blocked[0], 1);
      repo.head = name;
      c.err(`Switched to branch '${name}'\n`);
      return 0;
    }
    case 'merge': {
      if (args.includes('--abort')) {
        if (!repo.merging) return fatal('fatal: There is no merge to abort (MERGE_HEAD missing).', 'GIT_NOMERGE');
        const head = headTree(repo);
        for (const p of new Set([...Object.keys(head), ...Object.keys(repo.index), ...repo.conflicts])) writeWork(c, root, p, head[p]);
        repo.index = { ...head };
        repo.merging = null;
        repo.conflicts = [];
        return 0;
      }
      const name = args.find(a => !a.startsWith('-'));
      if (!name) return fatal('fatal: No remote for the current branch.', 'USAGE');
      const theirs = refName(name);
      if (!theirs) return fatal(`merge: ${name} - not something we can merge`, 'GIT_NOBRANCH', name, 1);
      const ours = headId(repo);
      if (ancestors(repo, ours).has(theirs)) { c.println('Already up to date.'); return 0; }
      const oursTree = headTree(repo), theirsTree = treeOf(repo, theirs);
      if (!ours || ancestors(repo, theirs).has(ours)) {
        const blocked = moveTree(c, R, oursTree, theirsTree);
        if (blocked) return fatal(`error: Your local changes to the following files would be overwritten by merge:\n${blocked.map(p => '\t' + p).join('\n')}\nPlease commit your changes or stash them before you merge.\nAborting`, 'GIT_DIRTY', blocked[0], 1);
        repo.branches[repo.head] = theirs;
        const st = stat(oursTree, theirsTree);
        c.println(`Updating ${short(ours || '0000000')}..${short(theirs)}\nFast-forward\n${statLines(st.rows)}\n${st.sum}`);
        return 0;
      }
      const mine = ancestors(repo, ours);
      const baseId = [...ancestors(repo, theirs)].filter(x => mine.has(x)).map(x => repo.commits[x]).sort((a, b) => b.seq - a.seq)[0]?.id;
      const base = treeOf(repo, baseId);
      const work = workTree(c, root);
      if (Object.keys(repo.index).some(p => work[p] !== repo.index[p]) || stat(oursTree, repo.index).rows.length) return fatal('error: Your local changes would be overwritten by merge.\nPlease commit your changes or stash them before you merge.\nAborting', 'GIT_DIRTY', '', 1);
      const author = identity();
      if (!author) return 128;
      const conflicts = [];
      for (const p of [...new Set([...Object.keys(base), ...Object.keys(oursTree), ...Object.keys(theirsTree)])].sort()) {
        const b = base[p], o = oursTree[p], t = theirsTree[p];
        if (o === t || b === t) continue;
        if (b === o) { writeWork(c, root, p, t); if (t === undefined) delete repo.index[p]; else repo.index[p] = t; continue; }
        conflicts.push(p);
        c.println(`Auto-merging ${p}\nCONFLICT (content): Merge conflict in ${p}`);
        writeWork(c, root, p, `<<<<<<< HEAD\n${o ?? ''}=======\n${t ?? ''}>>>>>>> ${name}\n`);
      }
      repo.merging = { theirs, name };
      if (conflicts.length) {
        repo.conflicts = conflicts;
        c.println('Automatic merge failed; fix conflicts and then commit the result.');
        sh.lastErr = { cmd: 'git', code: 'GIT_CONFLICT', target: conflicts[0] };
        return 1;
      }
      const st = stat(oursTree, repo.index);
      makeCommit(repo, `Merge branch '${name}'${repo.head === 'main' ? '' : ` into ${repo.head}`}`, author, { parent2: theirs });
      repo.merging = null;
      c.println(`Merge made by the 'ort' strategy.\n${statLines(st.rows)}\n${st.sum}`);
      return 0;
    }
    case 'restore': case 'reset': {
      const staged = args.includes('--staged') || sub === 'reset';
      const head = headTree(repo);
      if (sub === 'reset' && args.includes('--hard')) {
        for (const p of new Set([...Object.keys(head), ...Object.keys(repo.index)])) writeWork(c, root, p, head[p]);
        repo.index = { ...head };
        repo.merging = null;
        repo.conflicts = [];
        const id = headId(repo);
        if (id) c.println(`HEAD is now at ${short(id)} ${repo.commits[id].msg.split('\n')[0]}`);
        return 0;
      }
      const files = args.filter(a => !a.startsWith('-') && a !== 'HEAD');
      if (!files.length) {
        if (sub === 'restore') return fatal('fatal: you must specify path(s) to restore', 'USAGE');
        repo.index = { ...head };
        return 0;
      }
      for (const f of files) {
        const rel = toRel(f);
        const under = p => rel === '' || p === rel || p.startsWith(rel + '/');
        const src = staged ? head : repo.index;
        const hits = rel === null ? [] : [...new Set([...Object.keys(src), ...Object.keys(repo.index)])].filter(under);
        if (!hits.length) return fatal(`error: pathspec '${f}' did not match any file(s) known to git`, 'GIT_PATHSPEC', f, 1);
        for (const p of hits) {
          if (staged) { if (p in head) repo.index[p] = head[p]; else delete repo.index[p]; }
          else writeWork(c, root, p, repo.index[p]);
        }
      }
      if (sub === 'reset') { const un = changes(repo, workTree(c, root)).unstaged; if (un.length) c.println('Unstaged changes after reset:\n' + un.map(([k, p]) => `${k === 'deleted' ? 'D' : 'M'}\t${p}`).join('\n')); }
      return 0;
    }
    case 'stash': {
      const verb = args[0] || 'push';
      const head = headTree(repo);
      if (verb === 'list') { repo.stash.forEach((s, i) => c.println(`stash@{${i}}: WIP on ${s.branch}: ${s.label}`)); return 0; }
      if (verb === 'push' || verb === 'save' || verb.startsWith('-')) {
        const work = workTree(c, root);
        const saved = {};
        for (const p of new Set([...Object.keys(head), ...Object.keys(repo.index)])) if (work[p] !== head[p]) saved[p] = work[p] ?? null;
        if (!Object.keys(saved).length) { c.println('No local changes to save'); return 0; }
        const id = headId(repo);
        repo.stash.unshift({ files: saved, branch: repo.head, label: id ? `${short(id)} ${repo.commits[id].msg.split('\n')[0]}` : '(no commits)' });
        for (const p of Object.keys(saved)) writeWork(c, root, p, head[p]);
        repo.index = { ...head };
        c.println(`Saved working directory and index state WIP on ${repo.head}: ${repo.stash[0].label}`);
        return 0;
      }
      if (verb === 'pop' || verb === 'apply') {
        const s = repo.stash[0];
        if (!s) return fatal('No stash entries found.', 'GIT_NOSTASH', '', 1);
        for (const [p, t] of Object.entries(s.files)) writeWork(c, root, p, t === null ? undefined : t);
        if (verb === 'pop') repo.stash.shift();
        c.out(statusText(c, R, color));
        if (verb === 'pop') c.println(`Dropped refs/stash@{0}`);
        return 0;
      }
      if (verb === 'drop') { repo.stash.shift(); c.println('Dropped refs/stash@{0}'); return 0; }
      return fatal(`fatal: subcommand wasn't specified; 'push' can't be assumed due to unexpected token '${verb}'`, 'USAGE');
    }
    case 'remote': {
      if (args[0] === 'add') {
        if (args.length < 3) return fatal('usage: git remote add [<options>] <name> <url>', 'USAGE', '', 129);
        if (repo.remotes[args[1]]) return fatal(`error: remote ${args[1]} already exists.`, 'GIT_REMOTE_EXISTS', args[1], 3);
        repo.remotes[args[1]] = args[2];
        return 0;
      }
      if (args[0] === 'remove' || args[0] === 'rm') { delete repo.remotes[args[1]]; return 0; }
      for (const [n, u] of Object.entries(repo.remotes)) c.println(args.includes('-v') ? `${n}\t${u} (fetch)\n${n}\t${u} (push)` : n);
      return 0;
    }
    case 'push': {
      const url = repo.remotes.origin;
      if (!url) return fatal('fatal: No configured push destination.\nEither specify the URL from the command-line or configure a remote repository using\n\n    git remote add <name> <url>\n\nand then push using the remote name\n\n    git push <name>\n', 'GIT_NOREMOTE');
      const id = headId(repo);
      if (!id) return fatal(`error: src refspec ${repo.head} does not match any\nerror: failed to push some refs to '${url}'`, 'GIT_NOCOMMITS', '', 1);
      if (repo.pushed === id) { c.err('Everything up-to-date\n'); return 0; }
      await sh.sleep(600);
      c.err(`Enumerating objects: 5, done.\nCounting objects: 100% (5/5), done.\nWriting objects: 100% (3/3), 312 bytes | 312.00 KiB/s, done.\nTotal 3 (delta 0), reused 0 (delta 0), pack-reused 0\nTo ${url}\n   ${repo.pushed ? short(repo.pushed) + '..' + short(id) : '* [new branch]     '}  ${repo.head} -> ${repo.head}\n`);
      repo.pushed = id;
      return 0;
    }
    case 'pull': {
      if (!repo.remotes.origin) return fatal('There is no tracking information for the current branch.\nPlease specify which branch you want to merge with.\nSee git-pull(1) for details.\n\n    git pull <remote> <branch>\n', 'GIT_NOREMOTE', '', 1);
      await sh.sleep(400);
      c.println('Already up to date.');
      return 0;
    }
    default:
      return fatal(`git ${sub}: this command exists in real git, but is not part of the trainer.`, 'GIT_UNSUPPORTED', sub, 1);
  }
}, {
  help: true,
  complete: (sh, words, word) => {
    if (words.length === 1) return SUBS.filter(s => s.startsWith(word)).map(v => ({ v }));
    if (['switch', 'checkout', 'merge', 'branch'].includes(words[1])) {
      const R = findRepo(sh);
      if (R && !word.startsWith('-')) return Object.keys(R.repo.branches).filter(b => b.startsWith(word)).sort().map(v => ({ v }));
    }
    return null;
  },
});
