// Package managers: Homebrew on macOS, apt on Ubuntu Linux. Everything is simulated.

import { def } from '../registry.js';
import { sgr, columns, nearest } from '../util.js';
import { PKGS, CASKS, findPkg, pkgName, installedPkgs, installPkg, removePkg } from '../packages.js';
import { services } from './system.js';

const say = async (c, lines, ms = 220) => {
  for (const l of lines) {
    c.println(l);
    await c.sh.sleep(ms);
  }
};
const BAR = '######################################################################### 100.0%';
const kb = n => (n >= 1024 ? (n / 1024).toFixed(1) + 'MB' : n.toFixed(1) + 'KB');

// ---------- Homebrew ----------
const BREW_SUBS = ['install', 'uninstall', 'reinstall', 'list', 'search', 'info', 'update', 'upgrade', 'outdated', 'doctor', 'services', 'cleanup', 'help'];
const casksOf = fs => (fs.root.casks ??= {});

def('brew', async c => {
  const sh = c.sh;
  const [sub, ...rest] = c.args;
  const arrow = s => (c.tty ? sgr('1;34', '==>') + ' ' + sgr('1', s) : '==> ' + s);
  const fail = (msg, code, target) => {
    c.err((c.tty ? sgr('31', 'Error:') : 'Error:') + ' ' + msg + '\n');
    sh.lastErr = { cmd: 'brew', code, target };
    return 1;
  };
  if (c.user.root) return fail('Running Homebrew as root is extremely dangerous and no longer supported.\nAs Homebrew does not drop privileges on installation you would be giving all\nbuild scripts full access to your system.', 'BREW_ROOT');
  const inst = installedPkgs(c.fs);
  const casks = casksOf(c.fs);
  const names = rest.filter(a => !a.startsWith('-'));
  const needName = () => fail(`Invalid usage: This command requires at least 1 formula or cask argument.`, 'USAGE');

  switch (sub) {
    case undefined: case 'help': case '--help': case '-h':
      c.println('Example usage:\n  brew search TEXT|/REGEX/\n  brew info [FORMULA|CASK...]\n  brew install FORMULA|CASK...\n  brew update\n  brew upgrade [FORMULA|CASK...]\n  brew uninstall FORMULA|CASK...\n  brew list [FORMULA|CASK...]\n\nTroubleshooting:\n  brew config\n  brew doctor\n  brew install --verbose --debug FORMULA|CASK\n\nFurther help:\n  brew commands\n  brew help [COMMAND]\n  man brew\n  https://docs.brew.sh');
      return sub ? 0 : 1;
    case '--version': case '-v': c.println('Homebrew 4.4.5'); return 0;
    case 'shellenv':
      c.println('export HOMEBREW_PREFIX="/opt/homebrew";\nexport HOMEBREW_CELLAR="/opt/homebrew/Cellar";\nexport HOMEBREW_REPOSITORY="/opt/homebrew";');
      if (!(sh.env.PATH || '').split(':').includes('/opt/homebrew/bin')) c.println('export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:$PATH";');
      return 0;
    case 'install': case 'reinstall': {
      if (!names.length) return needName();
      let st = 0;
      for (const name of names) {
        const key = findPkg('mac', name);
        if (CASKS[name] && (rest.includes('--cask') || !key)) {
          if (casks[name] && sub === 'install') { c.println(`${c.tty ? sgr('33', 'Warning:') : 'Warning:'} Not upgrading ${name}, the latest version is already installed`); continue; }
          const k = CASKS[name];
          await say(c, [arrow(`Downloading https://formulae.brew.sh/api/cask/${name}.json`), arrow(`Downloading ${name}-${k.ver}.dmg`), BAR, arrow(`Installing Cask ${name}`), arrow(`Moving App '${k.app}' to '/Applications/${k.app}'`)]);
          c.fs.dir(`/Applications/${k.app}`, { owner: 'you', group: 'admin' });
          casks[name] = k.ver;
          c.println(`🍺  ${name} was successfully installed!`);
          continue;
        }
        if (!key) {
          const near = nearest(name, [...Object.keys(PKGS).map(k => pkgName('mac', k)), ...Object.keys(CASKS)], 3);
          c.println(`${c.tty ? sgr('33', 'Warning:') : 'Warning:'} No available formula with the name "${name}".${near ? ` Did you mean ${near}?` : ''}`);
          c.println(arrow('Searching for similarly named formulae and casks...'));
          await sh.sleep(300);
          st = fail(`No formulae or casks found for ${name}.`, 'PKG_UNKNOWN', name);
          continue;
        }
        const p = PKGS[key];
        const real = pkgName('mac', key);
        if (inst[key] && sub === 'install') {
          c.println(`${c.tty ? sgr('33', 'Warning:') : 'Warning:'} ${real} ${p.ver} is already installed and up-to-date.\nTo reinstall ${p.ver}, run:\n  brew reinstall ${real}`);
          continue;
        }
        await say(c, [
          arrow(`Fetching downloads for: ${real}`),
          arrow(`Downloading https://ghcr.io/v2/homebrew/core/${real}/manifests/${p.ver}`), BAR,
          arrow(`Fetching ${real}`),
          arrow(`Downloading https://ghcr.io/v2/homebrew/core/${real}/blobs/sha256:${(key + 'c0ffee1234567890abcdef').slice(0, 12)}`), BAR,
          arrow(`Pouring ${real}--${p.ver}.arm64_tahoe.bottle.tar.gz`),
        ]);
        installPkg(c.fs, 'mac', key);
        if (p.service) services(c.fs)[key] = { active: false, enabled: false };
        c.println(`🍺  /opt/homebrew/Cellar/${real}/${p.ver}: ${8 + key.length} files, ${kb(p.kb)}`);
        if (key === 'zoxide') c.println(`${arrow('Caveats')}\nTo set zoxide up in zsh, add this line to ~/.zshrc:\n  eval "$(zoxide init zsh)"`);
        if (key === 'nginx') c.println(`${arrow('Caveats')}\nTo start nginx now and restart at login:\n  brew services start nginx`);
      }
      return st;
    }
    case 'uninstall': case 'remove': case 'rm': {
      if (!names.length) return needName();
      let st = 0;
      for (const name of names) {
        const key = findPkg('mac', name);
        if (casks[name]) {
          delete casks[name];
          c.fs.get('/Applications')?.kids.delete(CASKS[name].app);
          c.println(`${arrow(`Uninstalling Cask ${name}`)}\n${arrow(`Removing App '/Applications/${CASKS[name].app}'`)}`);
        } else if (key && inst[key]) {
          const p = PKGS[key];
          removePkg(c.fs, 'mac', key);
          delete services(c.fs)[key];
          c.println(`Uninstalling /opt/homebrew/Cellar/${pkgName('mac', key)}/${p.ver}... (${8 + key.length} files, ${kb(p.kb)})`);
        } else st = fail(`No such keg: /opt/homebrew/Cellar/${name}`, 'PKG_NOT_INSTALLED', name);
      }
      return st;
    }
    case 'list': case 'ls': case 'leaves': {
      const f = Object.keys(inst).map(k => pkgName('mac', k)).sort();
      const k = Object.keys(casks).sort();
      if (!c.tty || sub === 'leaves') { [...f, ...(sub === 'leaves' ? [] : k)].forEach(n => c.println(n)); return 0; }
      if (f.length) c.out(arrow('Formulae') + '\n' + columns(f, c.cols));
      if (k.length) c.out((f.length ? '\n' : '') + arrow('Casks') + '\n' + columns(k, c.cols));
      return 0;
    }
    case 'search': {
      const q = (names[0] || '').toLowerCase();
      const f = Object.keys(PKGS).filter(k => !q || pkgName('mac', k).includes(q) || PKGS[k].desc.toLowerCase().includes(q)).map(k => pkgName('mac', k)).sort();
      const k = Object.keys(CASKS).filter(n => !q || n.includes(q)).sort();
      if (!f.length && !k.length) return fail(`No formulae or casks found for "${q}".`, 'PKG_UNKNOWN', q);
      if (f.length) c.out((c.tty ? arrow('Formulae') + '\n' : '') + (c.tty ? columns(f.map(n => (inst[findPkg('mac', n)] ? n + ' ✔' : n)), c.cols) : f.join('\n') + '\n'));
      if (k.length) c.out((c.tty ? (f.length ? '\n' : '') + arrow('Casks') + '\n' : '') + (c.tty ? columns(k, c.cols) : k.join('\n') + '\n'));
      return 0;
    }
    case 'info': {
      if (!names.length) { c.println(`${Object.keys(inst).length} kegs, ${Object.keys(inst).length * 143} files, ${kb(Object.keys(inst).reduce((s, k) => s + PKGS[k].kb, 0))}`); return 0; }
      const name = names[0];
      const key = findPkg('mac', name);
      if (!key && CASKS[name]) { c.println(`${arrow(`${name}: ${CASKS[name].ver}`)}\n${CASKS[name].desc}\n${casks[name] ? 'Installed' : 'Not installed'}`); return 0; }
      if (!key) return fail(`No available formula with the name "${name}".`, 'PKG_UNKNOWN', name);
      const p = PKGS[key];
      c.println(`${arrow(`${pkgName('mac', key)}: stable ${p.ver} (bottled)`)}\n${p.desc}\nhttps://formulae.brew.sh/formula/${pkgName('mac', key)}`);
      c.println(inst[key] ? `Installed\n/opt/homebrew/Cellar/${pkgName('mac', key)}/${p.ver} (${8 + key.length} files, ${kb(p.kb)}) *` : 'Not installed');
      c.println(`${arrow('Analytics')}\ninstall: ${(p.kb * 7) % 90000 + 12000} (30 days)`);
      return 0;
    }
    case 'update': await say(c, [arrow('Updating Homebrew...')], 500); c.println('Already up-to-date.'); return 0;
    case 'upgrade': await sh.sleep(300); return 0;
    case 'outdated': case 'cleanup': case 'autoremove': return 0;
    case 'doctor': await sh.sleep(400); c.println('Your system is ready to brew.'); return 0;
    case 'config': c.println('HOMEBREW_VERSION: 4.4.5\nHOMEBREW_PREFIX: /opt/homebrew\nCPU: 10-core 64-bit arm_firestorm_icestorm\nmacOS: 26.1-arm64'); return 0;
    case 'commands': c.println(arrow('Built-in commands') + '\n' + columns(BREW_SUBS.slice().sort(), c.cols)); return 0;
    case 'services': {
      const svc = services(c.fs);
      const [verb, name] = names;
      const mine = Object.keys(svc).filter(k => inst[k]);
      if (!verb || verb === 'list') {
        if (!mine.length) return 0;
        c.println('Name  Status  User File');
        for (const k of mine) c.println(`${k} ${svc[k].active ? 'started you  ~/Library/LaunchAgents/homebrew.mxcl.' + k + '.plist' : 'none'}`);
        return 0;
      }
      if (!name || !mine.includes(name)) return fail(name ? `No available formula with the name "${name}".` : 'Formula(e) missing, please provide a formula name or use --all', 'PKG_UNKNOWN', name);
      if (verb === 'start' || verb === 'restart') { svc[name].active = true; c.println(`${arrow(`Successfully started \`${name}\` (label: homebrew.mxcl.${name})`)}`); }
      else if (verb === 'stop') { svc[name].active = false; c.println(`Stopping \`${name}\`... (might take a while)\n${arrow(`Successfully stopped \`${name}\` (label: homebrew.mxcl.${name})`)}`); }
      else return fail(`Unknown command: brew services ${verb}`, 'USAGE');
      return 0;
    }
    default: return fail(`Unknown command: brew ${sub}`, 'BREW_SUB', sub);
  }
}, {
  os: 'mac', dir: { mac: '/opt/homebrew/bin' }, help: true,
  complete: (sh, words, word) => {
    if (words.length === 1) return BREW_SUBS.filter(s => s.startsWith(word)).map(v => ({ v }));
    if (['install', 'info', 'search', 'reinstall'].includes(words[1])) return [...Object.keys(PKGS).map(k => pkgName('mac', k)), ...Object.keys(CASKS)].sort().filter(s => s.startsWith(word)).map(v => ({ v }));
    if (['uninstall', 'remove', 'rm'].includes(words[1])) return Object.keys(installedPkgs(sh.fs)).map(k => pkgName('mac', k)).filter(s => s.startsWith(word)).map(v => ({ v }));
    return null;
  },
});

// The official installer, as started by: /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
def('__brew_install', async c => {
  const sh = c.sh;
  const arrow = s => (c.tty ? sgr('1;34', '==>') + ' ' + sgr('1', s) : '==> ' + s);
  if (!c.mac) { c.err('Homebrew on Linux is not part of this trainer. Use apt here.\n'); return 1; }
  c.println(arrow('Checking for `sudo` access (which may request your password)...'));
  if (!sh.sudoOk && c.io.readLine) {
    sh.tip('sudo', {});
    const pw = await c.io.readLine('Password:', { hidden: true });
    if (pw === null) return 1;
    sh.sudoOk = true;
  }
  c.println(`${arrow('This script will install:')}\n/opt/homebrew/bin/brew\n/opt/homebrew/share/doc/homebrew\n/opt/homebrew/share/man/man1/brew.1\n/opt/homebrew/share/zsh/site-functions/_brew\n/opt/homebrew/etc/bash_completion.d/brew\n/opt/homebrew\n`);
  if (c.io.readLine) {
    const a = await c.io.readLine('Press RETURN/ENTER to continue or any other key to abort:');
    if (a === null || a.trim()) { c.println('Installation aborted.'); return 1; }
  }
  await say(c, [
    arrow(`/usr/bin/sudo /usr/sbin/chown -R ${sh.user.name}:admin /opt/homebrew`),
    arrow('Downloading and installing Homebrew...'),
    'remote: Enumerating objects: 289475, done.',
    'remote: Counting objects: 100% (412/412), done.',
    'remote: Compressing objects: 100% (201/201), done.',
    'Receiving objects: 100% (289475/289475), 92.41 MiB | 21.33 MiB/s, done.',
    'Resolving deltas: 100% (215331/215331), done.',
    arrow('Updating Homebrew...'),
  ], 350);
  c.fs.dir('/opt/homebrew/bin', { owner: 'you', group: 'admin' });
  c.fs.put('/opt/homebrew/bin/brew', '\x7fELF', { mode: 0o755, bin: 'brew', owner: 'you', group: 'admin' });
  const home = sh.home;
  c.println(`${arrow('Installation successful!')}\n\n${arrow('Homebrew has enabled anonymous aggregate formulae and cask analytics.')}\nRead the analytics documentation (and how to opt-out) here:\n  https://docs.brew.sh/Analytics\nNo analytics data has been sent yet (nor will any be during this install run).\n\n${arrow('Next steps:')}\n- Run these commands in your terminal to add Homebrew to your ${c.tty ? sgr('1', 'PATH') : 'PATH'}:\n    echo >> ${home}/.zprofile\n    echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ${home}/.zprofile\n    eval "$(/opt/homebrew/bin/brew shellenv)"\n- Run ${c.tty ? sgr('1', 'brew help') : 'brew help'} to get started\n- Further documentation:\n    https://docs.brew.sh`);
  sh.tip('brew-next-steps', {});
}, { builtin: true, hidden: true });

// ---------- apt ----------
const APT_SUBS = ['install', 'remove', 'update', 'upgrade', 'search', 'show', 'list', 'autoremove', 'purge'];
const READING = ['Reading package lists... Done', 'Building dependency tree... Done', 'Reading state information... Done'];

def(['apt', 'apt-get'], async c => {
  const sh = c.sh;
  const yes = c.args.some(a => a === '-y' || a === '--yes');
  const [sub, ...rest] = c.args.filter(a => a !== '-y' && a !== '--yes');
  const names = rest.filter(a => !a.startsWith('-'));
  const inst = installedPkgs(c.fs);
  const fail = (msg, code, target) => {
    c.err(msg + '\n');
    sh.lastErr = { cmd: 'apt', code, target };
    return 100;
  };
  const needRoot = () => {
    if (c.user.root) return false;
    fail(sub === 'update'
      ? 'Reading package lists... Done\nE: Could not open lock file /var/lib/apt/lists/lock - open (13: Permission denied)\nE: Unable to lock directory /var/lib/apt/lists/\nW: Problem unlinking the file /var/cache/apt/pkgcache.bin - RemoveCaches (13: Permission denied)'
      : 'E: Could not open lock file /var/lib/dpkg/lock-frontend - open (13: Permission denied)\nE: Unable to acquire the dpkg frontend lock (/var/lib/dpkg/lock-frontend), are you root?', 'APT_ROOT', [sub, ...names].join(' '));
    return true;
  };
  const summary = (up, inst2, rem) => `${up} upgraded, ${inst2} newly installed, ${rem} to remove and 0 not upgraded.`;

  switch (sub) {
    case undefined: case 'help':
      c.println('apt 2.7.14 (amd64)\nUsage: apt [options] command\n\napt is a commandline package manager and provides commands for\nsearching and managing as well as querying information about packages.\n\nMost used commands:\n  list - list packages based on package names\n  search - search in package descriptions\n  show - show package details\n  install - install packages\n  remove - remove packages\n  autoremove - automatically remove all unused packages\n  update - update list of available packages\n  upgrade - upgrade the system by installing/upgrading packages\n\nSee apt(8) for more information about the available commands.');
      return 0;
    case 'update':
      if (needRoot()) return 100;
      await say(c, ['Hit:1 http://archive.ubuntu.com/ubuntu noble InRelease', 'Get:2 http://security.ubuntu.com/ubuntu noble-security InRelease [126 kB]', 'Get:3 http://archive.ubuntu.com/ubuntu noble-updates InRelease [126 kB]', 'Fetched 252 kB in 1s (391 kB/s)'], 260);
      c.println(READING.join('\n') + '\nAll packages are up to date.');
      c.fs.root.aptUpdated = true;
      return 0;
    case 'install': {
      if (needRoot()) return 100;
      await say(c, READING, 120);
      if (!names.length) { c.println(summary(0, 0, 0)); return 0; }
      const todo = [];
      for (const name of names) {
        const key = findPkg('linux', name);
        if (!key) return fail(`E: Unable to locate package ${name}`, 'PKG_UNKNOWN', name);
        if (inst[key]) c.println(`${name} is already the newest version (${PKGS[key].aptVer}).`);
        else todo.push(key);
      }
      if (!todo.length) { c.println(summary(0, 0, 0)); return 0; }
      const total = todo.reduce((s, k) => s + PKGS[k].kb, 0);
      c.println(`The following NEW packages will be installed:\n  ${todo.map(k => pkgName('linux', k)).join(' ')}\n${summary(0, todo.length, 0)}\nNeed to get ${total} kB of archives.\nAfter this operation, ${Math.round(total * 2.6)} kB of additional disk space will be used.`);
      for (const [i, key] of todo.entries()) {
        const n = pkgName('linux', key), v = PKGS[key].aptVer;
        await say(c, [`Get:${i + 1} http://archive.ubuntu.com/ubuntu noble/universe amd64 ${n} amd64 ${v} [${PKGS[key].kb} kB]`], 300);
      }
      c.println(`Fetched ${total} kB in 0s (${Math.round(total * 3.1)} kB/s)`);
      for (const key of todo) {
        const n = pkgName('linux', key), v = PKGS[key].aptVer;
        await say(c, [`Selecting previously unselected package ${n}.`, '(Reading database ... 201345 files and directories currently installed.)', `Preparing to unpack .../${n}_${v}_amd64.deb ...`, `Unpacking ${n} (${v}) ...`, `Setting up ${n} (${v}) ...`], 160);
        installPkg(c.fs, 'linux', key);
        if (PKGS[key].service) services(c.fs)[key] = { active: true, enabled: true };
        if (PKGS[key].aptBins) sh.tip('apt-renamed', { pkg: n, bin: Object.keys(PKGS[key].aptBins)[0], usual: Object.keys(PKGS[key].bins)[0] });
      }
      c.println('Processing triggers for man-db (2.12.0-4build2) ...');
      return 0;
    }
    case 'remove': case 'purge': case 'autoremove': {
      if (needRoot()) return 100;
      await say(c, READING, 120);
      const todo = [];
      for (const name of names) {
        const key = findPkg('linux', name);
        if (!key) return fail(`E: Unable to locate package ${name}`, 'PKG_UNKNOWN', name);
        if (!inst[key]) c.println(`Package '${name}' is not installed, so not removed`);
        else todo.push(key);
      }
      if (!todo.length) { c.println(summary(0, 0, 0)); return 0; }
      c.println(`The following packages will be REMOVED:\n  ${todo.map(k => pkgName('linux', k)).join(' ')}\n${summary(0, 0, todo.length)}\nAfter this operation, ${Math.round(todo.reduce((s, k) => s + PKGS[k].kb, 0) * 2.6)} kB disk space will be freed.`);
      if (!yes && c.io.readLine) {
        const a = await c.io.readLine('Do you want to continue? [Y/n] ');
        if (a === null || /^n/i.test(a.trim())) { c.println('Abort.'); return 1; }
      }
      for (const key of todo) {
        await say(c, ['(Reading database ... 201402 files and directories currently installed.)', `Removing ${pkgName('linux', key)} (${PKGS[key].aptVer}) ...`], 200);
        removePkg(c.fs, 'linux', key);
        delete services(c.fs)[key];
      }
      c.println('Processing triggers for man-db (2.12.0-4build2) ...');
      return 0;
    }
    case 'upgrade': case 'full-upgrade': case 'dist-upgrade':
      if (needRoot()) return 100;
      await say(c, [...READING, 'Calculating upgrade... Done'], 150);
      c.println(summary(0, 0, 0));
      return 0;
    case 'search': {
      const q = (names[0] || '').toLowerCase();
      c.println('Sorting... Done\nFull Text Search... Done');
      for (const k of Object.keys(PKGS).sort()) {
        const n = pkgName('linux', k);
        if (q && !n.includes(q) && !PKGS[k].desc.toLowerCase().includes(q)) continue;
        c.println(`${c.tty ? sgr('32', n) : n}/noble ${PKGS[k].aptVer} amd64${inst[k] ? ' [installed]' : ''}\n  ${PKGS[k].desc}\n`);
      }
      return 0;
    }
    case 'show': {
      const key = names[0] && findPkg('linux', names[0]);
      if (!key) return fail(`N: Unable to locate package ${names[0] ?? ''}\nE: No packages found`, 'PKG_UNKNOWN', names[0]);
      const p = PKGS[key];
      c.println(`Package: ${pkgName('linux', key)}\nVersion: ${p.aptVer}\nPriority: optional\nSection: universe/utils\nOrigin: Ubuntu\nInstalled-Size: ${Math.round(p.kb * 2.6)} kB\nDownload-Size: ${p.kb} kB\nAPT-Manual-Installed: ${inst[key] ? 'yes' : 'no'}\nAPT-Sources: http://archive.ubuntu.com/ubuntu noble/universe amd64 Packages\nDescription: ${p.desc}\n`);
      return 0;
    }
    case 'list': {
      c.println('Listing... Done');
      const only = rest.includes('--installed');
      for (const k of Object.keys(PKGS).sort()) {
        if (only && !inst[k]) continue;
        if (names.length && !names.includes(pkgName('linux', k))) continue;
        const n = pkgName('linux', k);
        c.println(`${c.tty ? sgr('32', n) : n}/noble${inst[k] ? ',now' : ''} ${PKGS[k].aptVer} amd64${inst[k] ? ' [installed]' : ''}`);
      }
      return 0;
    }
    default: return fail(`E: Invalid operation ${sub}`, 'APT_SUB', sub);
  }
}, {
  os: 'linux',
  complete: (sh, words, word) => {
    if (words.length === 1) return APT_SUBS.filter(s => s.startsWith(word)).map(v => ({ v }));
    if (['install', 'show', 'search'].includes(words[1])) return Object.keys(PKGS).map(k => pkgName('linux', k)).sort().filter(s => s.startsWith(word)).map(v => ({ v }));
    if (['remove', 'purge'].includes(words[1])) return Object.keys(installedPkgs(sh.fs)).map(k => pkgName('linux', k)).filter(s => s.startsWith(word)).map(v => ({ v }));
    return null;
  },
});
