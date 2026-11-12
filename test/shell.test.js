// Behaviour of the simulated shell: parsing, expansion, redirection, pipes,
// permissions, OS differences, completion and the coach's explanations.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explain } from '../js/shell/index.js';
import { parse, needsMore, tokenize } from '../js/shell/parser.js';
import { VFS, norm } from '../js/shell/vfs.js';
import { shellFor } from './helpers.js';

test('parser: quoting, operators and incomplete input', () => {
  const words = src => tokenize(src).map(t => (t.type === 'op' ? t.v : t.parts.map(p => p.s).join('')));
  assert.deepEqual(words(`echo "a b" 'c d' e\\ f`), ['echo', 'a b', 'c d', 'e f']);
  assert.deepEqual(words('ls -l | wc -l > out.txt 2>&1'), ['ls', '-l', '|', 'wc', '-l', '>', 'out.txt', '2>&1']);
  assert.equal(parse('a && b || c; d &').items.length, 2);
  assert.equal(needsMore('echo "open'), 'dquote');
  assert.equal(needsMore("echo 'open"), 'quote');
  assert.equal(needsMore('ls |'), 'pipe');
  assert.equal(needsMore('echo done'), null);
  assert.throws(() => parse('| ls'));
});

test('vfs: paths, permissions and symlinks', () => {
  assert.equal(norm('../b/./c', '/a/x'), '/a/b/c');
  const fs = new VFS();
  const you = { name: 'you', group: 'staff', root: false };
  fs.dir('/home/you', { owner: 'you', group: 'staff' });
  fs.put('/etc/secret', 'x', { mode: 0o600 });
  fs.write('/home/you/a.txt', 'hi', you);
  assert.equal(fs.read('/home/you/a.txt', you), 'hi');
  assert.throws(() => fs.read('/etc/secret', you), /EACCES/);
  assert.throws(() => fs.write('/etc/new', 'x', you), /EACCES/);
  fs.link('/home/you/link', 'a.txt', { owner: 'you' });
  assert.equal(fs.read('/home/you/link', you), 'hi');
  assert.equal(VFS.fromJSON(JSON.parse(JSON.stringify(fs.toJSON()))).read('/home/you/a.txt', you), 'hi');
});

test('expansion: variables, tilde, globs, braces, substitution, arithmetic', async () => {
  const { run } = await shellFor('linux');
  assert.equal((await run('echo $HOME ~ "$USER" \'$USER\'')).text, '/home/you /home/you you $USER\n');
  assert.equal((await run('cd Downloads; echo *.jpg')).text, 'IMG_0001.jpg IMG_0002.jpg IMG_0003.jpg\n');
  assert.equal((await run('echo {a,b}{1..2}')).text, 'a1 a2 b1 b2\n');
  assert.equal((await run('echo "n=$(ls *.jpg | wc -l)" $((2 + 3 * 4))')).text, 'n=3 14\n');
  assert.equal((await run('X=5; echo $X; false; echo $?')).text, '5\n1\n');
});

test('redirection and pipes', async () => {
  const { run, sh } = await shellFor('mac');
  await run('echo one > f.txt; echo two >> f.txt');
  assert.equal(sh.fs.read('/Users/you/f.txt'), 'one\ntwo\n');
  assert.equal((await run('cat < f.txt | tr a-z A-Z | sort -r')).text, 'TWO\nONE\n');
  assert.equal((await run('ls nope 2> err.txt; cat err.txt')).text, 'ls: nope: No such file or directory\n');
  assert.equal((await run('ls nope > /dev/null 2>&1; echo $?')).text, '1\n');
  assert.equal((await run('true && echo yes || echo no; false && echo yes || echo no')).text, 'yes\nno\n');
});

test('text tools agree with the real ones', async () => {
  const { run } = await shellFor('linux');
  await run('cd Downloads');
  assert.equal((await run('cut -d, -f2 data.csv | sort | uniq -c | sort -rn | head -n 1')).text, '      3 Berlin\n');
  assert.equal((await run('grep -c Berlin data.csv')).text, '3\n');
  assert.equal((await run("awk -F, 'NR > 1 && $3 < 30 {print $1}' data.csv")).text, 'Clara\nFelix\n');
  assert.equal((await run("sed -n '2p' data.csv | tr , ' ' | wc -w")).text, '4\n');
  assert.equal((await run('wc -l < data.csv')).text, '9\n');
  assert.equal((await run('find . -name "*.csv" -type f')).text, './data.csv\n');
  assert.equal((await run('seq 3 | xargs echo')).text, '1 2 3\n');
});

test('macOS and Linux word their errors differently', async () => {
  const mac = await shellFor('mac');
  const linux = await shellFor('linux');
  assert.equal((await mac.run('nope')).text, 'zsh: command not found: nope\n');
  assert.equal((await linux.run('nope')).text, 'nope: command not found\n');
  assert.equal((await mac.run('cd nope')).text, 'cd: no such file or directory: nope\n');
  assert.equal((await linux.run('cd nope')).text, 'bash: cd: nope: No such file or directory\n');
  assert.equal((await mac.run('rm Documents')).text, 'rm: Documents: is a directory\n');
  assert.equal((await linux.run('rm Documents')).text, "rm: cannot remove 'Documents': Is a directory\n");
  // BSD tools want options first; GNU tools accept them anywhere
  assert.match((await mac.run('ls Documents -l')).text, /ls: -l: No such file/);
  assert.match((await linux.run('ls Documents -l')).text, /^total /);
  assert.match((await mac.run('echo *.nomatch')).text, /zsh: no matches found/);
  assert.equal((await linux.run('echo *.nomatch')).text, '*.nomatch\n');
});

test('permissions, sudo and scripts', async () => {
  const { run, sh } = await shellFor('linux');
  assert.equal((await run('cat /etc/shadow')).exit, 1);
  assert.equal((await run('sudo cat /etc/shadow')).exit, 0);
  assert.equal((await run('cd projects/scripts; ./hello.sh')).exit, 126);
  assert.match((await run('chmod +x hello.sh && ./hello.sh')).text, /Hello from a script!/);
  await run('chmod 640 hello.sh');
  assert.equal(sh.fs.get('/home/you/projects/scripts/hello.sh').mode, 0o640);
  await run('touch /etc/x');
  assert.match((await run('sudo !!')).text, /^sudo touch \/etc\/x\n/); // !! is the previous line
  assert.equal(sh.fs.get('/etc/x').owner, 'root');
});

test('symbolic links: follow, resolve, break', async () => {
  const { run, sh } = await shellFor('mac');
  await run('ln -s ~/projects/website site; ln -s Documents/notes.txt quick');
  assert.match((await run('ls -l')).text, /lrwxr-xr-x .* site -> \/Users\/you\/projects\/website/);
  assert.equal((await run('cd site; pwd; pwd -P; cd')).text, '/Users/you/site\n/Users/you/projects/website\n');
  assert.equal((await run('readlink quick; realpath quick')).text, 'Documents/notes.txt\n/Users/you/Documents/notes.txt\n');
  await run('echo "- butter" >> quick; rm quick');
  assert.match(sh.fs.read('/Users/you/Documents/notes.txt'), /- butter\n$/); // written through the link, link removal keeps it
  assert.equal((await run('cd /tmp; pwd -P; cd')).text, '/private/tmp\n'); // on macOS /tmp itself is a link
  const broken = await run('touch draft.txt; ln -s draft.txt latest; rm draft.txt; cat latest');
  assert.match(broken.text, /cat: latest: No such file or directory/);
  assert.match(explain(broken).what, /broken link/);
  assert.equal((await run('ln -s x /usr/local/bin/x')).exit, 1); // system folder: needs sudo
  await run('chmod +x projects/scripts/hello.sh; sudo ln -s ~/projects/scripts/hello.sh /usr/local/bin/hello');
  assert.match((await run('hello')).text, /Hello from a script!/);
});

test('chown hands a root-owned file back', async () => {
  const { run } = await shellFor('linux');
  const denied = await run('sudo touch ~/oops.txt; echo hi > ~/oops.txt');
  assert.equal(denied.exit, 1);
  assert.match(explain(denied).example, /sudo chown you ~\/oops.txt/);
  assert.equal((await run('chown you ~/oops.txt')).exit, 1); // changing owners needs sudo
  assert.equal((await run('sudo chown you ~/oops.txt && echo hi > ~/oops.txt && cat ~/oops.txt')).text, 'hi\n');
});

test('PATH decides which commands are found', async () => {
  const { run } = await shellFor('mac');
  assert.equal((await run('which ls')).text, '/bin/ls\n');
  assert.equal((await run('rg x')).exit, 127);
  assert.equal((await run('brew install ripgrep > /dev/null; which rg')).text, '/opt/homebrew/bin/rg\n');
  assert.equal((await run('export PATH=/nowhere; ls')).exit, 127);
  assert.equal((await run('cd /; pwd')).text, '/\n'); // builtins still work
});

test('jobs: background, suspend and kill', async () => {
  const { run, sh } = await shellFor('linux', { speed: 1 });
  assert.match((await run('sleep 100 &')).text, /^\[1\] \d+\n$/);
  assert.match((await run('jobs')).text, /\[1\]\+\s+Running\s+sleep 100 &/);
  await run('kill %1');
  assert.match(sh.reap(), /Terminated\s+sleep 100/);
  const p = sh.run('sleep 100');
  await new Promise(r => setTimeout(r, 10));
  sh.signal('INT');
  assert.equal((await p).exit, 130);
});

test('tab completion', async () => {
  const { sh, run } = await shellFor('mac');
  const names = r => r.cands.map(c => c.v);
  assert.deepEqual(names(sh.complete('cd Doc')), ['Documents']);
  assert.deepEqual(names(sh.complete('cat Documents/n')), ['notes.txt', 'numbers.txt']);
  assert.ok(names(sh.complete('wh')).includes('whoami'));
  assert.deepEqual(names(sh.complete('cd D')), ['Desktop', 'Documents', 'Downloads']); // folders only
  assert.deepEqual(names(sh.complete('brew ins')), ['install']);
  assert.deepEqual(names(sh.complete('ls Downloads/My')), ['My Summer Trip']);
  await run('cd projects/website && git init && git config --global user.name a && git config --global user.email b && git add . && git commit -m x && git branch feature');
  assert.deepEqual(names(sh.complete('git switch f')), ['feature']);
});

test('git: commit, branch, merge and conflict', async () => {
  const { run } = await shellFor('linux');
  await run('cd projects/website; git init; git config --global user.name T; git config --global user.email t@e.x');
  assert.match((await run('git add . && git commit -m "one"')).text, /\[main \(root-commit\) [0-9a-f]{7}\] one/);
  await run('git switch -c other; echo other > style.css; git commit -am two; git switch main; echo main > style.css; git commit -am three');
  const merge = await run('git merge other');
  assert.match(merge.text, /CONFLICT \(content\): Merge conflict in style.css/);
  assert.match((await run('cat style.css')).text, /<<<<<<< HEAD\nmain\n=======\nother\n>>>>>>> other/);
  assert.match((await run('echo fixed > style.css; git add style.css; git commit -m merged; git log --oneline')).text, /merged\n.*three\n.*two\n.*one\n$/s);
  assert.match((await run('git status')).text, /nothing to commit, working tree clean/);
});

test('the coach explains common mistakes', async () => {
  const coach = async (os, line) => explain(await (await shellFor(os)).run(line));
  assert.match((await coach('mac', 'cd..')).example, /^cd \.\.$/);
  assert.match((await coach('mac', 'sl')).fix, /Did you mean `ls`/);
  assert.match((await coach('linux', 'cat Documents/note.txt')).what, /closest name is `notes.txt`/);
  assert.match((await coach('linux', 'cd documents')).what, /case-sensitive/);
  assert.match((await coach('mac', 'cd Downloads/My Summer Trip')).example, /cd "Downloads\/My Summer Trip"/);
  assert.match((await coach('linux', 'mkdir a/b/c')).example, /mkdir -p a\/b\/c/);
  assert.match((await coach('linux', 'rm Documents')).example, /rm -r Documents/);
  assert.match((await coach('linux', 'apt install tree')).example, /sudo apt install tree/);
  assert.match((await coach('mac', 'apt install tree')).fix, /brew/);
  assert.match((await coach('linux', 'brew install tree')).what, /Ubuntu Linux, which uses `apt`/);
  assert.match((await coach('mac', 'sudo echo x >> /etc/hosts')).fix, /sudo tee/);
  assert.match((await coach('mac', "sed -i 's/a/b/' Documents/notes.txt")).example, /sed -i ''/);
  assert.match((await coach('linux', 'find . -name *.jpg -o x; cd Downloads; find . -name *.jpg')).what, /not quoted/);
  assert.match((await coach('mac', 'git status')).example, /git init/);
  assert.match((await coach('linux', 'dir')).fix, /`ls`/);
  // a command that simply finds nothing is not a mistake
  assert.equal(await coach('linux', 'grep zebra Documents/notes.txt'), null);
});

test('ssh opens a session on the remote machine and exit returns', async () => {
  const { run, sh } = await shellFor('mac');
  await run('ssh you@server.example.com');
  assert.equal(sh.host, 'web01');
  assert.equal((await run('pwd; uname')).text, '/home/you\nLinux\n');
  assert.match((await run('exit')).text, /Connection to server.example.com closed/);
  assert.equal(sh.host, 'MacBook-Pro');
  assert.equal(sh.cwd, '/Users/you');
});
