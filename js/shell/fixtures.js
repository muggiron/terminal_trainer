// Builds the starting filesystem for each operating system, plus the pretend
// remote server used by ssh and scp.

import { VFS } from './vfs.js';
import { commands } from './registry.js';
import { PKGS, installPkg } from './packages.js';

const DAY = 864e5;
const ago = days => Date.now() - days * DAY;

const NOTES = 'Shopping list\n- milk\n- eggs\n- bread\n- coffee\n\nRemember to call Anna on Friday.\n';
const TODO = 'TODO: book train tickets\nDONE: pay electricity bill\nTODO: reply to Martin\nTODO: back up photos\nDONE: renew library card\nTODO: fix the bike\n';
const FRUITS = 'banana\napple\ncherry\napple\ndate\nbanana\napple\nelderberry\ncherry\n';
const NUMBERS = '10\n9\n100\n25\n3\n42\n';
const CSV = 'name,city,age,salary\nAnna,Berlin,31,52000\nBen,Hamburg,45,61000\nClara,Munich,28,48000\nDavid,Berlin,39,58000\nEva,Cologne,52,73000\nFelix,Hamburg,23,39000\nGreta,Berlin,34,55000\nHugo,Munich,41,64000\n';
const PANCAKES = 'Pancakes\n========\n\n200 g flour\n2 eggs\n300 ml milk\n1 pinch of salt\n\nMix everything, rest for 20 minutes, fry in butter.\n';
const PASTA = 'Pasta al pomodoro\n=================\n\n400 g spaghetti\n1 can of tomatoes\n2 cloves of garlic\nolive oil, basil, salt\n\nCook the pasta. Simmer the sauce for 15 minutes. Combine.\n';

function report() {
  const out = ['# Quarterly report', '', 'This file is long on purpose: use it to practise `less`, `head` and `tail`.', ''];
  const topics = ['Summary', 'Sales', 'Costs', 'Team', 'Customers', 'Risks', 'Next steps'];
  topics.forEach((t, i) => {
    out.push(`## ${i + 1}. ${t}`, '');
    for (let k = 1; k <= 5; k++) out.push(`${t} line ${k}: the numbers for week ${i * 5 + k} look ${['solid', 'stable', 'promising', 'mixed', 'better than expected'][(i + k) % 5]}.`);
    out.push('');
  });
  out.push('End of report.');
  return out.join('\n') + '\n';
}

function serverLog() {
  const events = [
    ['INFO ', 'Server started on port 8080'], ['INFO ', 'Connected to database'], ['INFO ', 'GET /index.html 200 12ms'],
    ['WARN ', 'Slow query (1532 ms): SELECT * FROM orders'], ['INFO ', 'GET /about.html 200 8ms'], ['ERROR', 'Failed to send email to anna@example.com: timeout'],
    ['INFO ', 'User ben logged in'], ['INFO ', 'GET /products 200 31ms'], ['WARN ', 'Disk usage at 81%'], ['ERROR', 'Payment gateway returned 502'],
    ['INFO ', 'User clara logged in'], ['INFO ', 'POST /orders 201 44ms'], ['INFO ', 'GET /index.html 200 9ms'], ['ERROR', 'Database connection lost, retrying'],
    ['INFO ', 'Connected to database'], ['WARN ', 'Slow query (2210 ms): SELECT * FROM customers'], ['INFO ', 'User ben logged out'], ['INFO ', 'GET /contact.html 404 3ms'],
    ['ERROR', 'Failed to send email to hugo@example.com: mailbox full'], ['INFO ', 'Nightly backup finished'], ['WARN ', 'Disk usage at 86%'], ['INFO ', 'GET /index.html 200 11ms'],
    ['INFO ', 'User eva logged in'], ['ERROR', 'Out of memory in worker 3'], ['INFO ', 'Worker 3 restarted'], ['INFO ', 'GET /products 200 28ms'],
  ];
  return events.map(([lvl, msg], i) => `2026-11-10 ${String(8 + Math.floor(i / 4)).padStart(2, '0')}:${String((i * 13) % 60).padStart(2, '0')}:${String((i * 37) % 60).padStart(2, '0')} ${lvl} ${msg}`).join('\n') + '\n';
}

function accessLog() {
  const ips = ['192.168.1.10', '192.168.1.22', '10.0.0.5', '192.168.1.10', '172.16.0.9', '192.168.1.10', '10.0.0.5', '192.168.1.22', '192.168.1.10', '10.0.0.5', '203.0.113.7', '192.168.1.10'];
  const pages = ['/index.html', '/about.html', '/products', '/contact.html', '/index.html', '/login'];
  return ips.map((ip, i) => `${ip} GET ${pages[i % pages.length]} ${i % 5 === 3 ? 404 : 200}`).join('\n') + '\n';
}

const BASHRC = "# ~/.bashrc: executed by bash for interactive shells.\n\n# enable color support of ls and grep\nalias ls='ls --color=auto'\nalias grep='grep --color=auto'\n\n# some more ls aliases\nalias ll='ls -alF'\nalias la='ls -A'\nalias l='ls -CF'\n";

function addBins(fs, os) {
  for (const [name, ent] of Object.entries(commands)) {
    if (ent.hidden || ent.pkg || (ent.os && ent.os !== os)) continue;
    if (ent.builtin && !ent.bin) continue;
    if (['.', 'nvim', 'reset', 'logout'].includes(name) || (os === 'linux' && (name === 'zsh' || name === 'pico'))) continue;
    const dir = ent.dir?.[os] || '/usr/bin';
    const homebrew = dir.startsWith('/opt/homebrew');
    fs.put(`${dir}/${name}`, '\x7fELF', { mode: 0o755, bin: name, owner: homebrew ? 'you' : 'root', group: homebrew ? 'admin' : os === 'mac' ? 'wheel' : 'root', mtime: ago(200) });
  }
}

function homeFiles(fs, home, user, group) {
  const o = { owner: user, group };
  const dir = (p, days = 30, mode) => { const n = fs.dir(`${home}/${p}`, { ...o, mtime: ago(days) }); if (mode !== undefined) n.mode = mode; return n; };
  const put = (p, data, days = 10, mode = 0o644) => fs.put(`${home}/${p}`, data, { ...o, mode, mtime: ago(days) });

  dir('Documents', 3);
  put('Documents/notes.txt', NOTES, 2);
  put('Documents/todo.txt', TODO, 5);
  put('Documents/report.md', report(), 21);
  put('Documents/fruits.txt', FRUITS, 14);
  put('Documents/numbers.txt', NUMBERS, 14);
  dir('Documents/recipes', 40);
  put('Documents/recipes/pancakes.txt', PANCAKES, 40);
  put('Documents/recipes/pasta.txt', PASTA, 55);

  dir('Downloads', 1);
  put('Downloads/data.csv', CSV, 1);
  put('Downloads/IMG_0001.jpg', '\xff\xd8\xff\xe0 JFIF (pretend photo 1)\n', 60);
  put('Downloads/IMG_0002.jpg', '\xff\xd8\xff\xe0 JFIF (pretend photo 2)\n', 60);
  put('Downloads/IMG_0003.jpg', '\xff\xd8\xff\xe0 JFIF (pretend photo 3)\n', 59);
  put('Downloads/invoice-2026.pdf', '%PDF-1.7 (pretend invoice)\n', 12);
  put('Downloads/old-notes.txt', 'These notes are outdated.\n', 300);
  dir('Downloads/My Summer Trip', 90);
  put('Downloads/My Summer Trip/day 1.txt', 'Arrived in Lisbon. Sunny.\n', 90);
  put('Downloads/My Summer Trip/day 2.txt', 'Took the tram to Belém.\n', 89);

  dir('projects', 7);
  dir('projects/website', 7);
  put('projects/website/index.html', '<!doctype html>\n<html>\n  <head>\n    <title>My Website</title>\n    <link rel="stylesheet" href="style.css">\n  </head>\n  <body>\n    <h1>Hello!</h1>\n    <!-- TODO: add a contact page -->\n    <script src="js/app.js"></script>\n  </body>\n</html>\n', 7);
  put('projects/website/style.css', 'body {\n  font-family: sans-serif;\n  color: #333;\n}\n\nh1 {\n  color: teal;\n}\n', 9);
  put('projects/website/README.md', '# My Website\n\nA small practice site.\n\nTODO: write a proper description.\n', 8);
  dir('projects/website/js', 7);
  put('projects/website/js/app.js', '// TODO: greet the visitor by name\nconsole.log("Website loaded");\n', 7);
  dir('projects/logs', 2);
  put('projects/logs/server.log', serverLog(), 2);
  put('projects/logs/access.log', accessLog(), 2);
  dir('projects/scripts', 15);
  put('projects/scripts/hello.sh', '#!/bin/bash\n# A tiny script. It needs permission to run: chmod +x hello.sh\necho "Hello from a script!"\necho "Today is $(date +%F)."\n', 15);
  put('projects/scripts/backup.sh', '#!/bin/bash\necho "Backing up Documents..."\ncp -r ~/Documents ~/Documents-backup\necho "Done."\n', 15);
  for (const d of ['Desktop', 'Music', 'Pictures', 'Public']) dir(d, 120);
}

export function buildFs(os = 'mac') {
  const fs = new VFS();
  const mac = os === 'mac';
  const rootGroup = mac ? 'wheel' : 'root';
  const R = { owner: 'root', group: rootGroup, mtime: ago(200) };
  fs.root.group = rootGroup;
  fs.root.mtime = ago(200);
  const user = 'you';
  const group = mac ? 'staff' : user;
  const home = mac ? `/Users/${user}` : `/home/${user}`;
  const U = { owner: user, group };

  if (mac) {
    for (const d of ['/Applications/Safari.app', '/Applications/Utilities', '/Library', '/System/Library', '/Volumes', '/bin', '/cores', '/dev', '/opt', '/private/etc', '/private/tmp', '/private/var/log', '/sbin', '/usr/bin', '/usr/lib', '/usr/libexec', '/usr/local/bin', '/usr/sbin', '/usr/share', '/Users/Shared']) fs.dir(d, R);
    fs.link('/etc', 'private/etc', R);
    fs.link('/tmp', 'private/tmp', R);
    fs.link('/var', 'private/var', R);
    fs.get('/private/tmp').mode = 0o777;
    fs.dir('/private/var/root', { ...R, mode: 0o700 });
    fs.put('/private/etc/hosts', '##\n# Host Database\n#\n# localhost is used to configure the loopback interface\n# when the system is booting.  Do not change this entry.\n##\n127.0.0.1\tlocalhost\n255.255.255.255\tbroadcasthost\n::1             localhost\n', R);
    fs.put('/private/etc/shells', '# List of acceptable shells for chpass(1).\n\n/bin/bash\n/bin/sh\n/bin/zsh\n', R);
    fs.put('/private/etc/paths', '/usr/local/bin\n/usr/bin\n/bin\n/usr/sbin\n/sbin\n', R);
    fs.put('/private/var/log/system.log', 'Nov 12 08:00:01 MacBook-Pro syslogd[142]: ASL Sender Statistics\nNov 12 08:14:22 MacBook-Pro loginwindow[188]: Login Window Started\n', { ...R, group: 'admin', mode: 0o640 });
    fs.dir('/opt/homebrew', { owner: user, group: 'admin', mtime: ago(100) });
    for (const d of ['bin', 'Cellar', 'etc', 'share']) fs.dir(`/opt/homebrew/${d}`, { owner: user, group: 'admin', mtime: ago(100) });
  } else {
    for (const d of ['/boot', '/dev', '/etc/apt', '/home', '/media', '/mnt', '/opt', '/proc', '/run', '/srv', '/sys', '/tmp', '/usr/bin', '/usr/lib', '/usr/local/bin', '/usr/local/sbin', '/usr/sbin', '/usr/share', '/var/log', '/var/lib/dpkg', '/var/www/html']) fs.dir(d, R);
    fs.link('/bin', 'usr/bin', R);
    fs.link('/sbin', 'usr/sbin', R);
    fs.link('/lib', 'usr/lib', R);
    fs.get('/tmp').mode = 0o777;
    fs.dir('/root', { ...R, mode: 0o700 });
    fs.put('/etc/hosts', '127.0.0.1\tlocalhost\n127.0.1.1\tubuntu\n\n# The following lines are desirable for IPv6 capable hosts\n::1     ip6-localhost ip6-loopback\n', R);
    fs.put('/etc/hostname', 'ubuntu\n', R);
    fs.put('/etc/os-release', 'PRETTY_NAME="Ubuntu 24.04.1 LTS"\nNAME="Ubuntu"\nVERSION_ID="24.04"\nVERSION="24.04.1 LTS (Noble Numbat)"\nVERSION_CODENAME=noble\nID=ubuntu\nID_LIKE=debian\n', R);
    fs.put('/etc/passwd', `root:x:0:0:root:/root:/bin/bash\ndaemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin\nwww-data:x:33:33:www-data:/var/www:/usr/sbin/nologin\n${user}:x:1000:1000:${user},,,:/home/${user}:/bin/bash\n`, R);
    fs.put('/etc/shadow', 'root:!:19900:0:99999:7:::\nyou:$y$j9T$pretend$hash:19900:0:99999:7:::\n', { ...R, group: 'shadow', mode: 0o640 });
    fs.put('/etc/apt/sources.list', '# Ubuntu sources have moved to /etc/apt/sources.list.d/ubuntu.sources\n', R);
    fs.put('/var/log/syslog', '2026-11-12T08:00:01.000+00:00 ubuntu systemd[1]: Started cron.service - Regular background program processing daemon.\n2026-11-12T08:14:22.000+00:00 ubuntu sshd[802]: Server listening on 0.0.0.0 port 22.\n', { ...R, group: 'adm', mode: 0o640 });
    fs.put('/var/www/html/index.html', '<h1>It works!</h1>\n', R);
  }
  fs.put('/dev/null', '', { ...R, mode: 0o666 });

  fs.dir(home, { ...U, mtime: ago(1) });
  homeFiles(fs, home, user, group);
  if (mac) {
    for (const d of ['Library', 'Movies']) fs.dir(`${home}/${d}`, { ...U, mtime: ago(150) });
    fs.dir(`${home}/.Trash`, { ...U, mode: 0o700, mtime: ago(4) });
    fs.dir(`${home}/.zsh_sessions`, { ...U, mode: 0o700, mtime: ago(1) });
    fs.put(`${home}/.zsh_history`, ': 1731400000:0;ls\n: 1731400012:0;cd Documents\n', { ...U, mode: 0o600, mtime: ago(1) });
    fs.put(`${home}/.CFUserTextEncoding`, '0x0:0x0\n', { ...U, mtime: ago(150) });
    fs.put(`${home}/.zprofile`, '\neval "$(/opt/homebrew/bin/brew shellenv)"\n', { ...U, mtime: ago(100) });
  } else {
    for (const d of ['Templates', 'Videos']) fs.dir(`${home}/${d}`, { ...U, mtime: ago(150) });
    for (const d of ['.cache', '.config', '.local']) fs.dir(`${home}/${d}`, { ...U, mode: 0o700, mtime: ago(20) });
    fs.put(`${home}/.bashrc`, BASHRC, { ...U, mtime: ago(150) });
    fs.put(`${home}/.profile`, '# ~/.profile: executed by the command interpreter for login shells.\n\n# if running bash, include .bashrc if it exists\n', { ...U, mtime: ago(150) });
    fs.put(`${home}/.bash_history`, 'ls\ncd Documents\n', { ...U, mode: 0o600, mtime: ago(1) });
    fs.put(`${home}/.bash_logout`, '# ~/.bash_logout: executed by bash when login shell exits.\n', { ...U, mtime: ago(150) });
  }

  addBins(fs, os);
  fs.root.pkgs = {};
  if (!mac) for (const [k, p] of Object.entries(PKGS)) if (p.linuxPre) installPkg(fs, 'linux', k);
  return fs;
}

// The machine behind `ssh you@server.example.com`: a small Ubuntu web server.
export function buildRemote() {
  const fs = new VFS();
  const R = { owner: 'root', group: 'root', mtime: ago(90) };
  for (const d of ['/dev', '/etc', '/home', '/opt', '/root', '/tmp', '/usr/bin', '/usr/sbin', '/usr/local/bin', '/var/log/nginx', '/var/www/html']) fs.dir(d, R);
  fs.link('/bin', 'usr/bin', R);
  fs.link('/sbin', 'usr/sbin', R);
  fs.get('/tmp').mode = 0o777;
  fs.get('/root').mode = 0o700;
  fs.put('/dev/null', '', { ...R, mode: 0o666 });
  fs.put('/etc/hostname', 'web01\n', R);
  fs.put('/etc/hosts', '127.0.0.1\tlocalhost\n127.0.1.1\tweb01\n', R);
  fs.put('/etc/os-release', 'PRETTY_NAME="Ubuntu 24.04.1 LTS"\nNAME="Ubuntu"\nVERSION_ID="24.04"\nID=ubuntu\n', R);
  fs.put('/var/www/html/index.html', '<!doctype html>\n<html>\n  <body>\n    <h1>web01 is running</h1>\n  </body>\n</html>\n', { owner: 'www-data', group: 'www-data', mtime: ago(30) });
  fs.put('/var/log/nginx/access.log', accessLog(), { ...R, group: 'adm', mode: 0o640, mtime: ago(0) });
  const D = { owner: 'deploy', group: 'deploy', mtime: ago(12) };
  fs.dir('/home/deploy', D);
  fs.dir('/home/deploy/app', D);
  fs.put('/home/deploy/app/server.js', 'const http = require("http");\nhttp.createServer((req, res) => res.end("ok")).listen(8080);\n', D);
  fs.put('/home/deploy/app/config.yml', 'port: 8080\nenvironment: production\nlog_level: info\n', D);
  addBins(fs, 'linux');
  fs.root.pkgs = {};
  return fs;
}
