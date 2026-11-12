// Plays through every lesson and every review drill on both systems,
// the way a learner would, and checks that each step is recognised.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createShell } from '../js/shell/index.js';
import { buildCourse } from '../js/lessons/lessons.js';
import { buildDrills } from '../js/lessons/drills.js';
import { makeIo, keys } from './helpers.js';

const K = (key, extra = {}) => ({ ev: { type: 'key', key, ...extra } });
const users = 'curl -s https://api.example.com/users';

// One scripted solution per lesson. A string is a command line; { run, keys } types
// keys into a full-screen program; { run, signal } presses Ctrl+C / Ctrl+Z while it
// runs; { ev } is a keyboard shortcut handled by the terminal itself.
function solutions(os) {
  const mac = os === 'mac';
  const rc = mac ? '~/.zshrc' : '~/.bashrc';
  const inst = mac ? 'brew install' : 'sudo apt install';
  const fd = mac ? 'fd' : 'fdfind';
  const bat = mac ? 'bat' : 'batcat';
  return {
    look: ['pwd', 'ls', 'ls -l', 'ls -a', 'ls -la', 'ls Documents', 'clear'],
    move: ['cd Documents', 'ls', 'cd recipes', 'cd ..', 'cd ~/projects/website', 'cd', 'cd -', 'cd /', 'ls', 'cd'],
    tab: [K('tab', { after: 'cd Documents/' }), 'cd Documents/', K('tab', { listed: true }), 'cat notes.txt', K('up'), K('ctrl-c', { running: false }), 'whoami'],
    help: [{ run: 'man ls', keys: ' q' }, 'ls --help', 'man -k copy', 'which ls', 'type cd', 'help'],
    create: ['mkdir practice', 'cd practice', 'touch notes.txt', 'echo hello', 'echo hello > greeting.txt', 'cat greeting.txt', 'echo world >> greeting.txt', 'mkdir -p projects/2026/reports', 'ls -R'],
    copy: ['ls', 'cp report.txt report-backup.txt', 'mv old.txt archive.txt', 'mkdir docs', 'mv archive.txt docs/', 'cp -r photos photos-backup', 'rm report-backup.txt', 'rm -r photos-backup', 'mkdir tmp', 'rmdir tmp'],
    read: ['cat notes.txt', 'wc -l report.md', 'head report.md', 'tail -n 5 report.md', { run: 'less report.md', keys: ' /Risks<Enter>q' }, 'cat notes.txt todo.txt', 'cat -n todo.txt'],
    links: ['ln -s ~/projects/website site', 'ls -l', 'cd site', 'pwd -P', 'cd', 'ln -s Documents/notes.txt quicknotes', 'cat quicknotes', 'echo "- butter" >> quicknotes', 'cat Documents/notes.txt', 'readlink quicknotes', 'rm quicknotes', 'ls Documents', 'touch draft.txt', 'ln -s draft.txt latest', 'rm draft.txt', 'cat latest', 'chmod +x projects/scripts/hello.sh', 'sudo ln -s ~/projects/scripts/hello.sh /usr/local/bin/hello', 'hello'],
    wild: ['ls *.jpg', 'echo *.txt', 'ls IMG_000?.jpg', 'mkdir photos', 'mv *.jpg photos/', 'cd My Summer Trip', 'cd "My Summer Trip"', 'cat "day 1.txt"', 'echo "Home: $HOME"', "echo 'Home: $HOME'"],
    keys: [K('ctrl-a', { line: 'echo one two three' }), K('ctrl-e'), K('ctrl-w', { line: 'echo one two three', after: 'echo one two ' }), K('ctrl-u'), { run: 'sleep 30', signal: 'INT' }, 'ls Documents', 'pwd', K('search-accept'), '!!', 'history', K('ctrl-l')],
    redirect: ['ls -l > listing.txt', 'cat listing.txt', 'echo oops > listing.txt', 'echo "second line" >> listing.txt', 'ls nothere > out.txt', 'ls nothere 2> errors.txt', 'wc -l < todo.txt', 'rm listing.txt out.txt errors.txt'],
    pipe: ['ls ~ | wc -l', 'grep ERROR server.log', 'grep ERROR server.log | wc -l', 'cut -d" " -f1 access.log', 'cut -d" " -f1 access.log | sort', 'cut -d" " -f1 access.log | sort | uniq -c', 'cut -d" " -f1 access.log | sort | uniq -c | sort -rn', 'cut -d" " -f1 access.log | sort | uniq -c | sort -rn | head -n 2', 'grep ERROR server.log | tee errors.txt'],
    find: ['find . -name "*.txt"', 'find . -type d -name recipes', 'grep -r TODO projects', 'grep -rni todo projects', 'grep -rl TODO projects', 'grep -v DONE Documents/todo.txt', 'find Documents -type f | wc -l'],
    sedawk: ['cat data.csv', 'sort -t, -k3 -n data.csv', "sed 's/Berlin/Potsdam/' data.csv", "sed -n '2,4p' data.csv", "awk -F, '{print $1, $2}' data.csv", "awk -F, '$3 > 40' data.csv", "awk -F, 'NR > 1 {sum += $4} END {print sum}' data.csv", mac ? "sed -i '' 's/Felix/Fritz/' data.csv" : "sed -i 's/Felix/Fritz/' data.csv"],
    nano: [{ run: 'nano shopping.txt', keys: 'apples<C-o><Enter><C-x>' }, 'cat shopping.txt', { run: 'nano shopping.txt', keys: '<Down>pears<Enter><C-x>y<Enter>' }],
    vi1: [{ run: 'vi notes.txt', keys: 'ihello <Esc>:w<Enter>:q<Enter>' }, { run: 'vi notes.txt', keys: 'ix<Esc>:q<Enter>:q!<Enter>' }, { run: 'vi todo.txt', keys: 'GoTODO: learn vi<Esc>:wq<Enter>' }],
    vi2: [{ run: 'vi report.md', keys: 'jjj5jGgg:10<Enter>www$0/Risks<Enter>n<C-f>:q<Enter>' }],
    vi3: [{ run: 'vi draft.txt', keys: '/gg<Enter>x/the the<Enter>dw/DELETE<Enter>dduddGpggyyp/lunch<Enter>cwdinner<Esc>oone more line<Esc>:wq<Enter>' }],
    vi4: [{ run: 'vi config.txt', keys: ':set number<Enter>:%s/blue/green/g<Enter>:4<Enter>Vjjdu/8080<Enter>cw9090<Esc>/false<Enter>.:wq<Enter>' }],
    perm: ['ls -l', 'cat hello.sh', './hello.sh', 'chmod +x hello.sh', './hello.sh', 'chmod u-w backup.sh', 'echo test >> backup.sh', 'chmod 755 backup.sh'],
    sudo: ['ls -l /etc/hosts', 'echo "127.0.0.1 mysite.test" >> /etc/hosts', 'sudo whoami', { run: 'sudo vi /etc/hosts', keys: 'Go127.0.0.1 mysite.test<Esc>:wq<Enter>' }, 'touch /etc/trainer.conf', 'sudo !!', 'ls -l /etc/trainer.conf', 'sudo rm /etc/trainer.conf', 'sudo touch ~/oops.txt', 'echo hi > ~/oops.txt', 'sudo chown you ~/oops.txt', 'ls -l ~/oops.txt', 'echo hi > ~/oops.txt'],
    env: ['echo $HOME', 'echo $PATH', 'GREETING=hello', 'echo $GREETING', 'export EDITOR=vim', 'mkdir ~/bin', 'cp ~/projects/scripts/hello.sh ~/bin/hello', 'chmod +x ~/bin/hello', 'hello', 'export PATH="$HOME/bin:$PATH"', 'hello', 'which hello'],
    rc: ["alias projects='cd ~/projects'", 'projects', 'alias', `echo "alias projects='cd ~/projects'" >> ${rc}`, `cat ${rc}`, { run: `vi ${rc}`, keys: 'Goexport EDITOR=vim<Esc>:wq<Enter>' }, `source ${rc}`, 'echo $EDITOR'],
    proc: ['ps', 'ps aux', { run: 'top', keys: 'q' }, 'ps aux | grep python', 'kill 6100', 'kill 6200', 'kill -9 6200', { run: 'sleep 600', signal: 'TSTP' }, 'jobs', { run: 'bg', slow: true }, { run: 'sleep 900 &', slow: true }, { run: 'fg %1', signal: 'INT' }, 'kill %2'],
    pkg: mac
      ? ['brew --version', '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"', 'brew --version', "echo >> ~/.zprofile; echo 'eval \"$(/opt/homebrew/bin/brew shellenv)\"' >> ~/.zprofile", 'eval "$(/opt/homebrew/bin/brew shellenv)"', 'brew --version', 'brew search tree', 'brew install tree', 'tree projects', 'brew list', 'brew info tree', 'brew update', 'brew uninstall tree']
      : ['apt search tree', 'apt install tree', 'sudo apt update', 'sudo apt install tree', 'tree projects', 'apt list --installed', 'apt show tree', 'sudo apt upgrade', 'sudo apt remove tree'],
    modern1: [`${inst} ripgrep`, 'rg TODO projects', 'rg -il todo projects', `${inst} ${mac ? 'fd' : 'fd-find'}`, `${fd} notes`, `${fd} -e md`, `${inst} bat`, `${bat} Documents/notes.txt`, `${inst} eza`, 'eza -la', 'eza -T -L 2 projects'],
    modern2: [`${inst} jq fzf tldr zoxide htop`, 'tldr tar', `${users} | jq .`, `${users} | jq '.[].name'`, `${users} | jq -r '.[] | select(.active) | .name'`, { run: 'fzf', keys: 'pan<Enter>' }, { run: 'cat $(fzf)', keys: 'pan<Enter>' }, `eval "$(zoxide init ${mac ? 'zsh' : 'bash'})"`, 'cd ~/projects/website', 'cd', 'z web', { run: 'htop', keys: 'q' }],
    net: ['ping -c 3 example.com', { run: 'ping example.com', signal: 'INT' }, 'curl https://example.com', 'curl -I https://example.com', 'curl -O https://files.example.com/notes.txt', 'curl -o cities.csv https://files.example.com/data.csv', ...(mac ? ['brew install wget'] : []), 'wget https://files.example.com/project.tar.gz', mac ? 'ifconfig' : 'ip a'],
    remote: ['tar -czf docs.tar.gz Documents', 'tar -tzf docs.tar.gz', 'ssh you@server.example.com', 'ls', 'cat welcome.txt', 'mkdir backups', 'exit', 'scp docs.tar.gz you@server.example.com:~/backups/', 'ssh you@server.example.com ls backups', 'scp you@server.example.com:~/welcome.txt .', 'mkdir restore', 'tar -xzf docs.tar.gz -C restore', 'zip -r docs.zip Documents'],
    git1: ['git status', 'git init', 'git status', 'git config --global user.name "Your Name"', 'git config --global user.email "you@example.com"', 'git add .', 'git commit -m "First version"', 'echo "More text" >> README.md', 'git status', 'git diff', 'git add README.md', 'git commit -m "Extend readme"', 'git log --oneline'],
    git2: ['git branch', 'git switch -c contact-page', 'echo "<h1>Contact</h1>" > contact.html', 'git add contact.html', 'git commit -m "Add contact page"', 'git switch main', 'ls', 'git merge contact-page', 'git branch -d contact-page', 'cd', 'git clone https://github.com/example/hello-world.git', 'cd hello-world', 'git log --oneline', 'git remote -v'],
  };
}

async function act(sh, io, a) {
  if (typeof a === 'string') a = { run: a };
  if (a.ev) { sh.onEvent({ ...a.ev, sh }); return; }
  io.keys = a.keys ? keys(a.keys) : [];
  const fast = sh.speed;
  if (a.signal || a.slow) sh.speed = 1; // keep the command running long enough to interrupt it
  const p = sh.run(a.run);
  if (a.signal) {
    await new Promise(r => setTimeout(r, 5));
    for (let i = 0; i < 50 && !sh.signal(a.signal); i++) await new Promise(r => setTimeout(r, 5));
  }
  await p;
  sh.speed = fast;
}

for (const os of ['mac', 'linux']) {
  const course = buildCourse(os);
  const sol = solutions(os);

  for (const track of course) {
    for (const lesson of track.lessons) {
      test(`${os}: lesson "${lesson.title}" can be completed`, async () => {
        assert.ok(sol[lesson.id], `no scripted solution for lesson ${lesson.id}`);
        let step = 0;
        const io = makeIo();
        const sh = await createShell({
          os, io, speed: 1e6,
          onEvent: ev => {
            const s = lesson.steps[step];
            if (s && ev.type !== 'tip' && s.check({ sh, ...ev })) step++;
          },
        });
        if (lesson.setup) await lesson.setup(sh);
        for (const a of sol[lesson.id]) await act(sh, io, a);
        assert.equal(step, lesson.steps.length, `stuck at step ${step + 1}: ${lesson.steps[step]?.say}\n--- terminal ---\n${io.buf.slice(-600)}`);
      });
    }
  }

  test(`${os}: every lesson step has text, a solution and a check`, () => {
    const ids = new Set();
    for (const lesson of course.flatMap(t => t.lessons)) {
      assert.ok(!ids.has(lesson.id), `duplicate lesson id ${lesson.id}`);
      ids.add(lesson.id);
      assert.ok(lesson.intro.length && lesson.steps.length, lesson.id);
      for (const s of lesson.steps) assert.ok(s.say && s.sol && typeof s.check === 'function', `${lesson.id}: ${s.say}`);
    }
  });

  test(`${os}: the model answer of every review drill is accepted`, async () => {
    const lessons = new Set(course.flatMap(t => t.lessons.map(l => l.id)));
    for (const d of buildDrills(os)) {
      assert.ok(lessons.has(d.lesson), `drill ${d.id} points to unknown lesson ${d.lesson}`);
      let ok = false;
      const io = makeIo();
      const sh = await createShell({ os, io, speed: 1e6, onEvent: ev => { if (ev.type === 'cmd' && d.check({ sh, ...ev })) ok = true; } });
      if (d.setup) await d.setup(sh);
      await act(sh, io, d.id === 'man' ? { run: d.a, keys: 'q' } : d.a);
      assert.ok(ok, `drill ${d.id}: "${d.a}" was not accepted\n${io.buf.slice(-400)}`);
    }
  });
}
