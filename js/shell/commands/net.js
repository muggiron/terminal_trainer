// Network and archive commands. There is no real network: a small pretend
// internet (NET) answers ping, curl, wget, ssh and scp.

import { def, Signal } from '../registry.js';
import { FsError, norm, basename, dirname } from '../vfs.js';
import { parse } from '../parser.js';
import { human, modeStr, lsDate, bytes, p2 } from '../util.js';
import { buildRemote } from '../fixtures.js';

const EXAMPLE_HTML = '<!doctype html>\n<html>\n<head>\n    <title>Example Domain</title>\n    <meta charset="utf-8" />\n</head>\n<body>\n<div>\n    <h1>Example Domain</h1>\n    <p>This domain is for use in illustrative examples in documents. You may use this\n    domain in literature without prior coordination or asking for permission.</p>\n    <p><a href="https://www.iana.org/domains/example">More information...</a></p>\n</div>\n</body>\n</html>\n';
const USERS = [
  { id: 1, name: 'Ada Lovelace', email: 'ada@example.com', city: 'London', active: true },
  { id: 2, name: 'Linus Torvalds', email: 'linus@example.com', city: 'Portland', active: true },
  { id: 3, name: 'Grace Hopper', email: 'grace@example.com', city: 'New York', active: false },
  { id: 4, name: 'Ken Thompson', email: 'ken@example.com', city: 'New Orleans', active: true },
  { id: 5, name: 'Margaret Hamilton', email: 'margaret@example.com', city: 'Boston', active: false },
];

export const packArchive = (kind, entries, gz = false) => `\x1f${kind}:` + JSON.stringify({ gz, entries });
export function unpackArchive(data) {
  const m = data.match(/^\x1f(TAR|ZIP):/);
  if (!m) return null;
  try { return { kind: m[1], ...JSON.parse(data.slice(m[0].length)) }; } catch { return null; }
}

const PROJECT_TGZ = packArchive('TAR', [
  { p: 'demo-project/', t: 'd', m: 0o755 },
  { p: 'demo-project/README.md', t: 'f', m: 0o644, d: '# Demo project\n\nUnpacked from project.tar.gz.\n' },
  { p: 'demo-project/src/', t: 'd', m: 0o755 },
  { p: 'demo-project/src/main.py', t: 'f', m: 0o644, d: 'print("Hello from the demo project")\n' },
  { p: 'demo-project/run.sh', t: 'f', m: 0o755, d: '#!/bin/bash\necho "Running the demo"\n' },
], true);

const page = body => ({ '/': [body, 'text/html; charset=UTF-8'] });
export const NET = {
  'example.com': { ip: '93.184.215.14', paths: page(EXAMPLE_HTML) },
  'www.example.com': { ip: '93.184.215.14', paths: page(EXAMPLE_HTML) },
  'api.example.com': {
    ip: '93.184.215.20',
    paths: {
      '/users': [JSON.stringify(USERS) + '\n', 'application/json'],
      '/users/1': [JSON.stringify(USERS[0]) + '\n', 'application/json'],
      '/status': ['{"status":"ok","uptime":86400,"version":"2.4.1"}\n', 'application/json'],
    },
  },
  'files.example.com': {
    ip: '93.184.215.21',
    paths: {
      '/notes.txt': ['Downloaded notes\n================\nThe terminal is just another way to talk to your computer.\nEvery command is a small program.\n', 'text/plain'],
      '/data.csv': ['city,country,population\nBerlin,Germany,3645000\nMadrid,Spain,3223000\nRome,Italy,2873000\nParis,France,2161000\nVienna,Austria,1897000\n', 'text/csv'],
      '/project.tar.gz': [PROJECT_TGZ, 'application/gzip'],
    },
  },
  'raw.githubusercontent.com': { ip: '185.199.108.133', paths: { '/Homebrew/install/HEAD/install.sh': ['#!/bin/bash\n# Homebrew installer (simulated by Terminal Trainer)\n__brew_install\n', 'text/plain'] } },
  'ifconfig.me': { ip: '34.160.111.145', paths: { '/': ['203.0.113.42\n', 'text/plain'] } },
  'google.com': { ip: '142.250.185.78', paths: page('<HTML><HEAD><TITLE>301 Moved</TITLE></HEAD><BODY>\n<H1>301 Moved</H1>\nThe document has moved\n<A HREF="https://www.google.com/">here</A>.\n</BODY></HTML>\n') },
  'github.com': { ip: '140.82.121.4', paths: page('<html><body>GitHub</body></html>\n') },
  '8.8.8.8': { ip: '8.8.8.8', paths: {} },
  '1.1.1.1': { ip: '1.1.1.1', paths: {} },
  'server.example.com': { ip: '203.0.113.10', paths: page('<h1>web01</h1>\n'), ssh: 'web01' },
  '203.0.113.10': { ip: '203.0.113.10', paths: {}, ssh: 'web01' },
  localhost: { ip: '127.0.0.1', paths: {}, refused: true },
  '127.0.0.1': { ip: '127.0.0.1', paths: {}, refused: true },
};
const NOT_FOUND = '<!doctype html>\n<html><head><title>404 Not Found</title></head>\n<body><h1>404 Not Found</h1></body></html>\n';

function parseUrl(u) {
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(u) ? u : 'http://' + u);
    return { host: url.hostname, path: url.pathname || '/', scheme: url.protocol.replace(':', ''), full: url.href };
  } catch {
    return null;
  }
}
function fetchFake(u) {
  const url = parseUrl(u);
  if (!url) return { error: 'bad', host: u };
  const site = NET[url.host];
  if (!site) return { error: 'resolve', host: url.host, url };
  if (site.refused) return { error: 'refused', host: url.host, url };
  const hit = site.paths[url.path];
  return hit ? { status: 200, body: hit[0], type: hit[1], url, site } : { status: 404, body: NOT_FOUND, type: 'text/html', url, site };
}

def('ping', async c => {
  const p = c.opts({ val: 'ciWt', bool: 'qn', permute: true });
  if (!p) return 2;
  const host = p.rest[0];
  if (!host) return c.missing('host operand');
  const site = NET[host];
  if (!site) {
    c.err(c.mac ? `ping: cannot resolve ${host}: Unknown host\n` : `ping: ${host}: Name or service not known\n`);
    c.sh.lastErr = { cmd: 'ping', code: 'NET_HOST', target: host };
    return c.mac ? 68 : 2;
  }
  const count = p.o.c ? parseInt(p.o.c, 10) : Infinity;
  if (count === Infinity && c.tty) c.sh.tip('ping-forever', {});
  c.println(c.mac ? `PING ${host} (${site.ip}): 56 data bytes` : `PING ${host} (${site.ip}) 56(84) bytes of data.`);
  const base = site.ip.startsWith('127') ? 0.05 : 9 + (site.ip.length % 7) * 2;
  const times = [];
  let stopped = false;
  try {
    for (let i = 0; i < count; i++) {
      await c.sh.sleep(i === 0 ? 150 : 1000);
      const t = base + Math.random() * 3;
      times.push(t);
      c.println(c.mac ? `64 bytes from ${site.ip}: icmp_seq=${i} ttl=56 time=${t.toFixed(3)} ms` : `64 bytes from ${site.ip}: icmp_seq=${i + 1} ttl=56 time=${t.toFixed(1)} ms`);
    }
  } catch (e) {
    if (!(e instanceof Signal) || e.sig !== 'INT') throw e;
    stopped = true;
  }
  const n = times.length;
  const avg = n ? times.reduce((a, b) => a + b, 0) / n : 0;
  const mn = n ? Math.min(...times) : 0, mx = n ? Math.max(...times) : 0;
  c.println(`\n--- ${host} ping statistics ---`);
  if (c.mac) c.println(`${n} packets transmitted, ${n} packets received, 0.0% packet loss\nround-trip min/avg/max/stddev = ${mn.toFixed(3)}/${avg.toFixed(3)}/${mx.toFixed(3)}/0.412 ms`);
  else c.println(`${n} packets transmitted, ${n} received, 0% packet loss, time ${Math.max(0, n - 1) * 1001}ms\nrtt min/avg/max/mdev = ${mn.toFixed(3)}/${avg.toFixed(3)}/${mx.toFixed(3)}/0.412 ms`);
  return stopped ? 130 : 0;
}, { dir: { mac: '/sbin' } });

const meter = n => `  % Total    % Received % Xferd  Average Speed   Time    Time     Time  Current\n                                 Dload  Upload   Total   Spent    Left  Speed\n100 ${String(n).padStart(5)}  100 ${String(n).padStart(5)}    0     0  ${String(n * 7).padStart(5)}      0 --:--:-- --:--:-- --:--:-- ${String(n * 7 + 12).padStart(5)}\n`;

def('curl', async c => {
  const p = c.opts({
    bool: 'sSLOIfvkiN', val: 'oXHdAuw', permute: true,
    long: { silent: 'bool', location: 'bool', output: 'val', head: 'bool', fail: 'bool', 'remote-name': 'bool', version: 'bool', request: 'val', header: 'val', data: 'val', 'show-error': 'bool' },
  });
  if (!p) return 2;
  const o = p.o;
  if (o.version) { c.println('curl 8.7.1 (trainer) libcurl/8.7.1\nProtocols: http https'); return 0; }
  if (!p.rest.length) {
    c.err("curl: try 'curl --help' or 'curl --manual' for more information\n");
    c.sh.lastErr = { cmd: 'curl', code: 'USAGE' };
    return 2;
  }
  const silent = o.s || o.silent;
  let st = 0;
  for (const u of p.rest) {
    const r = fetchFake(u);
    await c.sh.sleep(250);
    if (r.error) {
      if (!silent || o.S || o['show-error']) c.err(r.error === 'refused' ? `curl: (7) Failed to connect to ${r.host} port ${r.url.scheme === 'https' ? 443 : 80} after 0 ms: Couldn't connect to server\n` : r.error === 'bad' ? `curl: (3) URL rejected: Malformed input to a URL function\n` : `curl: (6) Could not resolve host: ${r.host}\n`);
      c.sh.lastErr = { cmd: 'curl', code: r.error === 'refused' ? 'NET_REFUSED' : 'NET_HOST', target: r.host };
      st = r.error === 'refused' ? 7 : 6;
      continue;
    }
    if (o.I || o.head) {
      c.println(`HTTP/2 ${r.status} \ncontent-type: ${r.type}\ncontent-length: ${bytes(r.body)}\ndate: ${new Date().toUTCString()}\nserver: trainer\n`);
      continue;
    }
    if (r.status === 404 && (o.f || o.fail)) {
      c.err('curl: (22) The requested URL returned error: 404\n');
      c.sh.lastErr = { cmd: 'curl', code: 'HTTP_404', target: u };
      st = 22;
      continue;
    }
    let file = o.o ?? o.output;
    if (o.O || o['remote-name']) {
      file = basename(r.url.path);
      if (!file || file === '/') { c.err('curl: Remote file name has no length\n'); c.sh.lastErr = { cmd: 'curl', code: 'CURL_O', target: u }; st = 23; continue; }
    }
    if (file) {
      if (!c.guard(file, a => c.fs.write(a, r.body, c.user), { msg: `curl: (23) Failure writing output to destination: ${file}` })) { st = 23; continue; }
      if (!silent) c.err(meter(bytes(r.body)));
    } else {
      if (!silent && !c.tty) c.err(meter(bytes(r.body)));
      c.out(r.body);
    }
    if (r.status === 404 && c.tty) c.sh.tip('http-404', { url: u });
  }
  return st;
}, { help: true });

def('wget', async c => {
  const p = c.opts({ bool: 'qcv', val: 'OP', permute: true, long: { quiet: 'bool', version: 'bool' } });
  if (!p) return 2;
  if (!p.rest.length) {
    c.err("wget: missing URL\nUsage: wget [OPTION]... [URL]...\n\nTry `wget --help' for more options.\n");
    c.sh.lastErr = { cmd: 'wget', code: 'USAGE' };
    return 1;
  }
  const quiet = p.o.q || p.o.quiet;
  const log = s => { if (!quiet) c.err(s); };
  const stamp = () => { const d = new Date(); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`; };
  let st = 0;
  for (const u of p.rest) {
    const r = fetchFake(u);
    const full = parseUrl(u)?.full ?? u;
    log(`--${stamp()}--  ${full}\n`);
    await c.sh.sleep(250);
    if (r.error) {
      log(r.error === 'refused' ? `Connecting to ${r.host}... failed: Connection refused.\n` : `Resolving ${r.host} (${r.host})... failed: ${c.mac ? 'nodename nor servname provided, or not known' : 'Name or service not known'}.\nwget: unable to resolve host address ‘${r.host}’\n`);
      c.sh.lastErr = { cmd: 'wget', code: r.error === 'refused' ? 'NET_REFUSED' : 'NET_HOST', target: r.host };
      st = 4;
      continue;
    }
    log(`Resolving ${r.url.host} (${r.url.host})... ${r.site.ip}\nConnecting to ${r.url.host} (${r.url.host})|${r.site.ip}|:${r.url.scheme === 'https' ? 443 : 80}... connected.\nHTTP request sent, awaiting response... `);
    if (r.status === 404) {
      log(`404 Not Found\n${stamp()} ERROR 404: Not Found.\n\n`);
      c.sh.lastErr = { cmd: 'wget', code: 'HTTP_404', target: u };
      st = 8;
      continue;
    }
    const n = bytes(r.body);
    let file = p.o.O ?? (basename(r.url.path) === '/' ? 'index.html' : basename(r.url.path));
    log(`200 OK\nLength: ${n} (${human(n, false)}) [${r.type.split(';')[0]}]\n`);
    if (file === '-') { c.out(r.body); continue; }
    if (p.o.P) file = p.o.P.replace(/\/$/, '') + '/' + file;
    log(`Saving to: ‘${file}’\n\n`);
    if (!c.guard(file, a => c.fs.write(a, r.body, c.user), { msg: `${file}: Permission denied\n\nCannot write to ‘${file}’ (Permission denied).` })) { st = 3; continue; }
    await c.sh.sleep(300);
    log(`${file.slice(0, 19).padEnd(19)} 100%[===================>] ${human(n, false).padStart(7)}  --.-KB/s    in 0s      \n\n${stamp()} (12.3 MB/s) - ‘${file}’ saved [${n}/${n}]\n\n`);
  }
  return st;
}, { pkg: 'wget', help: true });

// ---------- ssh / scp ----------
function remoteFor(c, host) {
  const site = NET[host];
  if (!site || !site.ssh) {
    const known = !!site;
    c.err(known ? `ssh: connect to host ${host} port 22: Connection refused\n` : c.mac ? `ssh: Could not resolve hostname ${host}: nodename nor servname provided, or not known\n` : `ssh: Could not resolve hostname ${host}: Name or service not known\n`);
    c.sh.lastErr = { cmd: c.name, code: known ? 'NET_REFUSED' : 'SSH_HOST', target: host };
    return null;
  }
  return (c.sh.remotes[site.ssh] ??= buildRemote());
}

async function sshAuth(c, user, host) {
  const sh = c.sh;
  if (!c.io.readLine) return true;
  const kh = `${sh.home}/.ssh/known_hosts`;
  let known = '';
  try { known = c.fs.read(kh, c.user); } catch { /* no file yet */ }
  if (!known.split('\n').some(l => l.startsWith(host + ' '))) {
    c.err(`The authenticity of host '${host} (${NET[host].ip})' can't be established.\nED25519 key fingerprint is SHA256:Xk3mPq9vTrLw2ZbYc8NdHs5JfA1uGe7oRiKx0VtMnCQ.\nThis key is not known by any other names.\n`);
    sh.tip('ssh-fingerprint', {});
    let q = 'Are you sure you want to continue connecting (yes/no/[fingerprint])? ';
    for (;;) {
      const a = await c.io.readLine(q);
      if (a === null || a.trim() === 'no') { c.err('Host key verification failed.\n'); sh.lastErr = { cmd: c.name, code: 'SSH_VERIFY' }; return false; }
      if (a.trim() === 'yes') break;
      q = "Please type 'yes', 'no' or the fingerprint: ";
    }
    try {
      c.fs.mkdir(`${sh.home}/.ssh`, c.user, { p: true, mode: 0o700 });
      c.fs.write(kh, `${host} ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPretendKeyForTheTrainer\n`, c.user, { append: true, mode: 0o600 });
    } catch (e) { if (!(e instanceof FsError)) throw e; }
    c.err(`Warning: Permanently added '${host}' (ED25519) to the list of known hosts.\n`);
  }
  sh.tip('sudo', { ssh: true });
  for (let i = 0; i < 3; i++) {
    const pw = await c.io.readLine(`${user}@${host}'s password: `, { hidden: true });
    if (pw === null) return false;
    if (pw.length) return true;
    if (i < 2) c.err('Permission denied, please try again.\n');
  }
  c.err(`${user}@${host}: Permission denied (publickey,password).\n`);
  sh.lastErr = { cmd: c.name, code: 'SSH_AUTH' };
  return false;
}

function ensureRemoteHome(rfs, user) {
  const home = `/home/${user}`;
  if (!rfs.get(home)) {
    rfs.dir(home, { owner: user, group: user });
    rfs.put(`${home}/welcome.txt`, `Welcome to web01, ${user}.\n`, { owner: user, group: user });
  }
  return home;
}

def('ssh', async c => {
  const sh = c.sh;
  const a = [];
  for (let i = 0; i < c.args.length; i++) {
    if (/^-[pilLo]$/.test(c.args[i])) i++;
    else if (!c.args[i].startsWith('-') || a.length) a.push(c.args[i]);
  }
  if (!a.length) {
    c.err('usage: ssh [-46AaCfGgKkMNnqsTtVvXxYy] [-p port] [-i identity_file] destination [command [argument ...]]\n');
    sh.lastErr = { cmd: 'ssh', code: 'USAGE' };
    return 255;
  }
  const [user, host] = a[0].includes('@') ? a[0].split('@') : [sh.user.name, a[0]];
  const rfs = remoteFor(c, host);
  if (!rfs) return 255;
  if (!(await sshAuth(c, user, host))) return 255;
  ensureRemoteHome(rfs, user);
  const session = { os: 'linux', fs: rfs, user, host: NET[host].ssh, exitMsg: `logout\nConnection to ${host} closed.` };
  if (a.length > 1) {
    sh.push(session);
    try {
      return await sh.runList(parse(a.slice(1).join(' ')), c.sio);
    } finally {
      Object.assign(sh, sh.stack.pop());
    }
  }
  c.println(`Welcome to Ubuntu 24.04.1 LTS (GNU/Linux 6.8.0-48-generic x86_64)\n\n * Documentation:  https://help.ubuntu.com\n\nLast login: ${new Date(Date.now() - 86400e3).toString().slice(0, 24)} from 198.51.100.7`);
  sh.push(session);
  await sh.init();
  sh.tip('ssh-in', { host });
  return 0;
});

def('scp', async c => {
  const sh = c.sh;
  const p = c.opts({ bool: 'rpqvC', val: 'Pi', permute: true });
  if (!p) return 1;
  if (p.rest.length < 2) {
    c.err('usage: scp [-346ABCOpqRrsTv] [-P port] [-i identity_file] source ... target\n');
    sh.lastErr = { cmd: 'scp', code: 'USAGE' };
    return 1;
  }
  const spec = s => {
    const m = s.match(/^(?:([^@:/]+)@)?([^:/]+):(.*)$/);
    return m ? { user: m[1] || sh.user.name, host: m[2], path: m[3] } : { path: s };
  };
  const dst = spec(p.rest.at(-1));
  const srcs = p.rest.slice(0, -1).map(spec);
  const remote = dst.host ? dst : srcs.find(s => s.host);
  if (!remote) { c.err('scp: copying between two local paths: use cp instead\n'); sh.lastErr = { cmd: 'scp', code: 'SCP_LOCAL' }; return 1; }
  const rfs = remoteFor(c, remote.host);
  if (!rfs) return 255;
  if (!(await sshAuth(c, remote.user, remote.host))) return 255;
  const rhome = ensureRemoteHome(rfs, remote.user);
  const ruser = { name: remote.user, group: remote.user, root: false };
  const side = s => (s.host ? { fs: rfs, user: ruser, abs: norm(s.path.replace(/^~\/?/, '') || '.', rhome) } : { fs: c.fs, user: c.user, abs: c.abs(s.path) });
  const D = side(dst);
  let st = 0;
  for (const s of srcs) {
    const S = side(s);
    try {
      const n = S.fs.need(S.abs, { user: S.user });
      if (n.t === 'd' && !p.o.r) { c.err(`scp: ${s.host ? '' : 'local '}"${s.path}" is not a regular file\nscp: failed to ${dst.host ? 'upload' : 'download'} file ${s.path}\n`); sh.lastErr = { cmd: 'scp', code: 'CP_DIR', target: s.path }; st = 1; continue; }
      const dn = D.fs.get(D.abs, { user: D.user });
      const target = dn && dn.t === 'd' ? norm(basename(S.abs), D.abs) : D.abs;
      const copy = (node, to) => {
        if (node.t === 'd') {
          if (!D.fs.get(to)) D.fs.mkdir(to, D.user);
          for (const [k, v] of node.kids) copy(v, to + '/' + k);
        } else {
          if (!S.fs.can(node, S.user, 4)) throw new FsError('EACCES', s.path);
          D.fs.write(to, node.data, D.user, { mode: node.mode });
          const size = String(bytes(node.data)).padStart(5);
          if (!p.o.q) c.println(`${basename(to).slice(0, 44).padEnd(44)} 100% ${size}   ${(bytes(node.data) / 23).toFixed(1).padStart(6)}KB/s   00:00    `);
        }
      };
      copy(n, target);
    } catch (e) {
      if (!(e instanceof FsError)) throw e;
      c.err(`scp: ${s.path}: ${{ ENOENT: 'No such file or directory', EACCES: 'Permission denied', ENOTDIR: 'Not a directory' }[e.code] || e.code}\n`);
      sh.lastErr = { cmd: 'scp', code: e.code, target: s.path, remote: !!s.host };
      st = 1;
    }
  }
  return st;
});

def('ifconfig', c => c.println('lo0: flags=8049<UP,LOOPBACK,RUNNING,MULTICAST> mtu 16384\n\tinet 127.0.0.1 netmask 0xff000000\n\tinet6 ::1 prefixlen 128\nen0: flags=8863<UP,BROADCAST,SMART,RUNNING,SIMPLEX,MULTICAST> mtu 1500\n\tether a4:83:e7:2b:19:c0\n\tinet6 fe80::1c2a:5bff:fe3d:9a41%en0 prefixlen 64 secured scopeid 0xb\n\tinet 192.168.1.23 netmask 0xffffff00 broadcast 192.168.1.255\n\tstatus: active'), { os: 'mac', dir: { mac: '/sbin' } });
def('ip', c => {
  const sub = c.args.find(a => !a.startsWith('-'));
  if (!sub) { c.err('Usage: ip [ OPTIONS ] OBJECT { COMMAND | help }\nwhere  OBJECT := { address | link | route ... }\n'); c.sh.lastErr = { cmd: 'ip', code: 'USAGE' }; return 255; }
  if ('address'.startsWith(sub)) c.println('1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN group default qlen 1000\n    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00\n    inet 127.0.0.1/8 scope host lo\n       valid_lft forever preferred_lft forever\n2: enp3s0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP group default qlen 1000\n    link/ether a4:83:e7:2b:19:c0 brd ff:ff:ff:ff:ff:ff\n    inet 192.168.1.23/24 brd 192.168.1.255 scope global dynamic noprefixroute enp3s0\n       valid_lft 85432sec preferred_lft 85432sec');
  else if ('route'.startsWith(sub)) c.println('default via 192.168.1.1 dev enp3s0 proto dhcp metric 100\n192.168.1.0/24 dev enp3s0 proto kernel scope link src 192.168.1.23 metric 100');
  else if ('link'.startsWith(sub)) c.println('1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 state UNKNOWN mode DEFAULT\n2: enp3s0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 state UP mode DEFAULT');
  else { c.err(`Object "${sub}" is unknown, try "ip help".\n`); return 1; }
}, { os: 'linux' });

// ---------- archives ----------
function collect(c, paths, onMissing) {
  const entries = [];
  for (const t of paths) {
    let root = null;
    try { root = c.fs.get(c.abs(t), { user: c.user }); } catch { /* reported below */ }
    if (!root) { onMissing(t); continue; }
    const walk = (label, n) => {
      if (n.t === 'd') {
        entries.push({ p: label.replace(/\/*$/, '/'), t: 'd', m: n.mode });
        for (const [k, v] of [...n.kids].sort((a, b) => (a[0] < b[0] ? -1 : 1))) walk(label.replace(/\/*$/, '/') + k, v);
      } else if (n.t === 'f') entries.push({ p: label, t: 'f', m: n.mode, d: n.data });
    };
    walk(t.replace(/^\/+/, ''), root);
  }
  return entries;
}

function extract(c, entries, dest, onEach) {
  for (const e of entries) {
    const abs = norm(e.p, dest);
    if (e.t === 'd') c.fs.mkdir(abs, c.user, { p: true, mode: e.m });
    else {
      c.fs.mkdir(dirname(abs), c.user, { p: true });
      c.fs.write(abs, e.d, c.user, { mode: e.m });
      const n = c.fs.get(abs);
      if (n) n.mode = e.m;
    }
    onEach(e);
  }
}

def('tar', c => {
  const sh = c.sh;
  const a = c.args.slice();
  const fail = (msg, code, target) => { c.err(msg + '\n'); sh.lastErr = { cmd: 'tar', code, target }; return c.mac ? 1 : 2; };
  let flags = '', file = null, dest = null;
  const rest = [];
  const take = ch => {
    flags += ch;
    if (ch === 'f') file = a.shift() ?? null;
    if (ch === 'C') dest = a.shift() ?? null;
  };
  if (a.length && !a[0].startsWith('--')) for (const ch of a.shift().replace(/^-/, '')) take(ch);
  while (a.length) {
    const x = a.shift();
    if (x.startsWith('-') && x.length > 1 && !x.startsWith('--')) for (const ch of x.slice(1)) take(ch);
    else if (!x.startsWith('--')) rest.push(x);
  }
  const mode = ['c', 'x', 't'].find(m => flags.includes(m));
  if (!mode) return fail(c.mac ? 'tar: Must specify one of -c, -r, -t, -u, -x' : "tar: You must specify one of the '-Acdtrux', '--delete' or '--test-label' options\nTry 'tar --help' or 'tar --usage' for more information.", 'TAR_MODE');
  if (!file) return fail(c.mac ? "tar: Error opening archive: Failed to open '/dev/sa0'" : mode === 'c' ? "tar: Refusing to write archive contents to terminal (missing -f option?)\ntar: Error is not recoverable: exiting now" : 'tar: Refusing to read archive contents from terminal (missing -f option?)\ntar: Error is not recoverable: exiting now', 'TAR_F');
  const verbose = flags.includes('v');
  if (mode === 'c') {
    if (!rest.length) return fail(c.mac ? 'tar: no files or directories specified' : "tar: Cowardly refusing to create an empty archive\nTry 'tar --help' or 'tar --usage' for more information.", 'TAR_EMPTY');
    let bad = false;
    const entries = collect(c, rest, t => { c.err(c.mac ? `tar: ${t}: Cannot stat: No such file or directory\n` : `tar: ${t}: Cannot stat: No such file or directory\n`); sh.lastErr = { cmd: 'tar', code: 'ENOENT', target: t }; bad = true; });
    if (rest.some(t => t.startsWith('/'))) c.err(c.mac ? 'tar: Removing leading \'/\' from member names\n' : "tar: Removing leading `/' from member names\n");
    if (verbose) for (const e of entries) c.sio[c.mac ? 'err' : 'out']((c.mac ? 'a ' : '') + e.p + '\n');
    if (!c.guard(file, p => c.fs.write(p, packArchive('TAR', entries, flags.includes('z')), c.user))) return 2;
    if (bad) { c.err(c.mac ? 'tar: Error exit delayed from previous errors.\n' : 'tar: Exiting with failure status due to previous errors\n'); return c.mac ? 1 : 2; }
    return 0;
  }
  let data;
  try { data = c.fs.read(c.abs(file), c.user); } catch (e) {
    if (!(e instanceof FsError)) throw e;
    return fail(c.mac ? `tar: Error opening archive: Failed to open '${file}'` : `tar: ${file}: Cannot open: ${e.code === 'EACCES' ? 'Permission denied' : 'No such file or directory'}\ntar: Error is not recoverable: exiting now`, e.code, file);
  }
  const ar = unpackArchive(data);
  if (!ar || ar.kind !== 'TAR') return fail(c.mac ? 'tar: Error opening archive: Unrecognized archive format' : 'tar: This does not look like a tar archive\ntar: Exiting with failure status due to previous errors', 'TAR_FORMAT', file);
  const wanted = e => !rest.length || rest.some(r => e.p === r || e.p.startsWith(r.replace(/\/*$/, '/')));
  if (mode === 't') {
    for (const e of ar.entries.filter(wanted)) c.println(verbose ? `${modeStr({ t: e.t, mode: e.m })}  0 ${c.user.name} ${c.user.group} ${String(e.t === 'f' ? bytes(e.d) : 0).padStart(6)} ${lsDate(Date.now())} ${e.p}` : e.p);
    return 0;
  }
  const target = dest ? c.abs(dest) : sh.cwd;
  if (dest && c.fs.get(target)?.t !== 'd') return fail(`tar: ${dest}: Cannot open: No such file or directory\ntar: Error is not recoverable: exiting now`, 'ENOENT', dest);
  try {
    extract(c, ar.entries.filter(wanted), target, e => { if (verbose) c.sio[c.mac ? 'err' : 'out']((c.mac ? 'x ' : '') + e.p + '\n'); });
  } catch (e) {
    if (!(e instanceof FsError)) throw e;
    return fail(`tar: ${e.path}: Cannot open: Permission denied`, 'EACCES', e.path);
  }
}, { help: true });

def('zip', c => {
  const p = c.opts({ bool: 'rqv9', permute: true });
  if (!p) return 1;
  if (p.rest.length < 2) {
    c.err(p.rest.length ? '\nzip error: Nothing to do! (' + p.rest[0] + ')\n' : 'Copyright (c) 1990-2008 Info-ZIP - Type \'zip "-L"\' for software license.\nZip 3.0. Usage:\nzip [-options] zipfile list\n');
    c.sh.lastErr = { cmd: 'zip', code: 'USAGE' };
    return 12;
  }
  const [name, ...paths] = p.rest;
  const file = /\.zip$/i.test(name) ? name : name + '.zip';
  const entries = collect(c, paths, t => { c.err(`\tzip warning: name not matched: ${t}\n`); c.sh.lastErr = { cmd: 'zip', code: 'ENOENT', target: t }; })
    .filter(e => p.o.r || e.t === 'f' || paths.some(t => e.p === t.replace(/\/*$/, '/')));
  if (!entries.length) { c.err(`\nzip error: Nothing to do! (${file})\n`); return 12; }
  if (!p.o.q) for (const e of entries) c.println(`  adding: ${e.p} (${e.t === 'd' ? 'stored 0%' : `deflated ${20 + (e.p.length * 7) % 50}%`})`);
  if (!p.o.r && paths.some(t => c.fs.get(c.abs(t))?.t === 'd')) c.sh.tip('zip-r', {});
  if (!c.guard(file, a => c.fs.write(a, packArchive('ZIP', entries), c.user))) return 15;
}, { help: true });

def('unzip', c => {
  const p = c.opts({ bool: 'loqn', val: 'd', permute: true });
  if (!p) return 1;
  if (!p.rest.length) { c.err('UnZip 6.00 of 20 April 2009, by Info-ZIP.\nUsage: unzip [-Z] [-opts[modifiers]] file[.zip] [list] [-x xlist] [-d exdir]\n'); c.sh.lastErr = { cmd: 'unzip', code: 'USAGE' }; return 10; }
  const file = p.rest[0];
  let data;
  try { data = c.fs.read(c.abs(file), c.user); } catch (e) {
    if (!(e instanceof FsError)) throw e;
    c.err(`unzip:  cannot find or open ${file}, ${file}.zip or ${file}.ZIP.\n`);
    c.sh.lastErr = { cmd: 'unzip', code: e.code, target: file };
    return 9;
  }
  const ar = unpackArchive(data);
  if (!ar || ar.kind !== 'ZIP') {
    c.err(`Archive:  ${file}\n  End-of-central-directory signature not found.  Either this file is not\n  a zipfile, or it constitutes one disk of a multi-part archive.\nunzip:  cannot find zipfile directory in one of ${file} or\n        ${file}.zip, and cannot find ${file}.ZIP, period.\n`);
    c.sh.lastErr = { cmd: 'unzip', code: 'ZIP_FORMAT', target: file };
    return 9;
  }
  c.println(`Archive:  ${file}`);
  if (p.o.l) {
    c.println('  Length      Date    Time    Name\n---------  ---------- -----   ----');
    let total = 0;
    const d = new Date();
    for (const e of ar.entries) { const n = e.t === 'f' ? bytes(e.d) : 0; total += n; c.println(`${String(n).padStart(9)}  ${p2(d.getMonth() + 1)}-${p2(d.getDate())}-${d.getFullYear()} ${p2(d.getHours())}:${p2(d.getMinutes())}   ${e.p}`); }
    c.println(`---------                     -------\n${String(total).padStart(9)}                     ${ar.entries.length} file${ar.entries.length === 1 ? '' : 's'}`);
    return 0;
  }
  const dest = p.o.d ? c.abs(p.o.d) : c.sh.cwd;
  try {
    if (p.o.d) c.fs.mkdir(dest, c.user, { p: true });
    extract(c, ar.entries, dest, e => { if (!p.o.q) c.println(`${e.t === 'd' ? '   creating' : '  inflating'}: ${p.o.d ? p.o.d.replace(/\/*$/, '/') : ''}${e.p}`); });
  } catch (e) {
    if (!(e instanceof FsError)) throw e;
    c.err(`error:  cannot create ${e.path}\n        Permission denied\n`);
    c.sh.lastErr = { cmd: 'unzip', code: 'EACCES', target: e.path };
    return 50;
  }
}, { help: true });
