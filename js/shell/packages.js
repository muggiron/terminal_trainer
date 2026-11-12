// Catalogue of installable software for brew (macOS) and apt (Linux).
// bins maps the program file name to the command implementation it runs.
// Some packages are named differently, or install differently named programs, on Ubuntu;
// these are real-world quirks worth knowing about.

export const PKGS = {
  tree: { desc: 'Display directories as trees (with optional color/HTML output)', ver: '2.2.1', aptVer: '2.1.1-2ubuntu3', bins: { tree: 'tree' }, kb: 188 },
  ripgrep: { desc: 'Search tool like grep and The Silver Searcher', ver: '14.1.1', aptVer: '14.1.0-1', bins: { rg: 'rg' }, kb: 5800 },
  fd: { apt: 'fd-find', desc: 'Simple, fast and user-friendly alternative to find', ver: '10.2.0', aptVer: '9.0.0-1', bins: { fd: 'fd' }, aptBins: { fdfind: 'fd' }, kb: 2900 },
  bat: { desc: 'Clone of cat(1) with syntax highlighting and Git integration', ver: '0.25.0', aptVer: '0.24.0-1build1', bins: { bat: 'bat' }, aptBins: { batcat: 'bat' }, kb: 5300 },
  eza: { desc: 'Modern, maintained replacement for ls', ver: '0.20.14', aptVer: '0.18.2-1', bins: { eza: 'eza' }, kb: 1300 },
  fzf: { desc: 'Command-line fuzzy finder written in Go', ver: '0.57.0', aptVer: '0.44.1-1', bins: { fzf: 'fzf' }, kb: 4100 },
  jq: { desc: 'Lightweight and flexible command-line JSON processor', ver: '1.7.1', aptVer: '1.7.1-3build1', bins: { jq: 'jq' }, kb: 1400 },
  tldr: { brew: 'tlrc', desc: 'Simplified and community-driven man pages', ver: '1.9.3', aptVer: '0.9.2-4', bins: { tldr: 'tldr' }, kb: 1900 },
  htop: { desc: 'Improved top (interactive process viewer)', ver: '3.3.0', aptVer: '3.3.0-4build1', bins: { htop: 'htop' }, kb: 420 },
  zoxide: { desc: 'Shell extension to navigate your filesystem faster', ver: '0.9.6', aptVer: '0.9.3-1', bins: { zoxide: 'zoxide' }, kb: 1100 },
  wget: { desc: 'Internet file retriever', ver: '1.25.0', aptVer: '1.21.4-1ubuntu4', bins: { wget: 'wget' }, kb: 4500, linuxPre: true },
  cowsay: { desc: 'Configurable talking characters in ASCII art', ver: '3.8.4', aptVer: '3.03+dfsg2-8', bins: { cowsay: 'cowsay' }, kb: 80 },
  nginx: { desc: 'HTTP(S) server and reverse proxy', ver: '1.27.3', aptVer: '1.24.0-2ubuntu7', bins: { nginx: 'nginx' }, kb: 1500, service: true },
};

export const CASKS = {
  firefox: { desc: 'Web browser', app: 'Firefox.app', ver: '132.0' },
  'visual-studio-code': { desc: 'Open-source code editor', app: 'Visual Studio Code.app', ver: '1.95.1' },
  iterm2: { desc: 'Terminal emulator as alternative to Apple\'s Terminal app', app: 'iTerm.app', ver: '3.5.10' },
  vlc: { desc: 'Multimedia player', app: 'VLC.app', ver: '3.0.21' },
};

// Name of a package as the given system's package manager knows it.
export const pkgName = (os, key) => (os === 'mac' ? PKGS[key].brew : PKGS[key].apt) || key;

// Find a package by the name typed by the user. Returns the catalogue key or null.
export function findPkg(os, name) {
  if (PKGS[name] && pkgName(os, name) === name) return name;
  for (const k of Object.keys(PKGS)) if (pkgName(os, k) === name) return k;
  // Homebrew keeps "tldr" as an old name for tlrc
  if (os === 'mac' && PKGS[name]) return name;
  return null;
}

export const pkgBins = (os, key) => (os === 'linux' && PKGS[key].aptBins) || PKGS[key].bins;

// Which package provides a program called `cmd`? Returns { key, name, bin } or null.
export function providerOf(os, cmd) {
  for (const k of Object.keys(PKGS)) {
    if (cmd in pkgBins(os, k)) return { key: k, name: pkgName(os, k), bin: cmd };
    // e.g. typing `fd` on Ubuntu, where the program is installed as `fdfind`
    if (cmd in PKGS[k].bins) return { key: k, name: pkgName(os, k), bin: Object.keys(pkgBins(os, k))[0], renamed: true };
  }
  return null;
}

export const pkgBinDir = os => (os === 'mac' ? '/opt/homebrew/bin' : '/usr/bin');

export function installedPkgs(fs) {
  return (fs.root.pkgs ??= {});
}

export function installPkg(fs, os, key) {
  const dir = pkgBinDir(os);
  for (const [file, impl] of Object.entries(pkgBins(os, key))) fs.put(`${dir}/${file}`, '\x7fELF', { mode: 0o755, bin: impl, owner: os === 'mac' ? 'you' : 'root', group: os === 'mac' ? 'admin' : 'root' });
  installedPkgs(fs)[key] = os === 'mac' ? PKGS[key].ver : PKGS[key].aptVer;
}

export function removePkg(fs, os, key) {
  const d = fs.get(pkgBinDir(os));
  for (const file of Object.keys(pkgBins(os, key))) d?.kids.delete(file);
  delete installedPkgs(fs)[key];
}
