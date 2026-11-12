// In-memory filesystem with owners, permission bits and symlinks.
// Nothing here touches the real disk.

const MSG = {
  ENOENT: 'No such file or directory',
  ENOTDIR: 'Not a directory',
  EISDIR: 'Is a directory',
  EEXIST: 'File exists',
  EACCES: 'Permission denied',
  ENOTEMPTY: 'Directory not empty',
  EPERM: 'Operation not permitted',
  ELOOP: 'Too many levels of symbolic links',
  EINVAL: 'Invalid argument',
};
export const errText = code => MSG[code] || code;

export class FsError extends Error {
  constructor(code, path) {
    super(`${code}: ${path}`);
    this.code = code;
    this.path = path;
  }
}

export function norm(path, cwd = '/') {
  const out = [];
  for (const p of (path.startsWith('/') ? path : cwd + '/' + path).split('/')) {
    if (!p || p === '.') continue;
    if (p === '..') out.pop();
    else out.push(p);
  }
  return '/' + out.join('/');
}
export const dirname = p => {
  p = p.length > 1 ? p.replace(/\/+$/, '') : p;
  const i = p.lastIndexOf('/');
  return i < 0 ? '.' : i === 0 ? '/' : p.slice(0, i);
};
export const basename = p => {
  p = p.replace(/\/+$/, '');
  return p.slice(p.lastIndexOf('/') + 1) || '/';
};

export class VFS {
  constructor() {
    this.root = this.node('d', 0o755, 'root', 'root');
  }

  node(t, mode, owner, group, extra = {}) {
    return { t, mode, owner, group, mtime: Date.now(), ...(t === 'd' ? { kids: new Map() } : {}), ...extra };
  }

  // bit: 4 = read, 2 = write, 1 = execute/traverse
  can(n, user, bit) {
    if (!user || user.root) return true;
    const shift = n.owner === user.name ? 6 : n.group === user.group ? 3 : 0;
    return !!((n.mode >> shift) & bit);
  }

  // Resolve an absolute path. Returns null when the last component is missing.
  get(path, { follow = true, user = null, depth = 0 } = {}) {
    if (depth > 16) throw new FsError('ELOOP', path);
    const parts = path.split('/').filter(Boolean);
    let n = this.root;
    let cur = '';
    for (let i = 0; i < parts.length; i++) {
      if (n.t !== 'd') throw new FsError('ENOTDIR', path);
      if (user && !this.can(n, user, 1)) throw new FsError('EACCES', path);
      const k = n.kids.get(parts[i]);
      if (!k) {
        if (i < parts.length - 1) return null;
        return null;
      }
      const last = i === parts.length - 1;
      if (k.t === 'l' && (!last || follow)) {
        const target = norm(k.to, cur || '/');
        const rest = parts.slice(i + 1).join('/');
        return this.get(rest ? target + '/' + rest : target, { follow, user, depth: depth + 1 });
      }
      cur += '/' + parts[i];
      n = k;
    }
    return n;
  }

  // The path with every symbolic link resolved, or null if it does not exist.
  realpath(path, depth = 0) {
    if (depth > 16) return null;
    const parts = path.split('/').filter(Boolean);
    let n = this.root;
    let cur = '';
    for (let i = 0; i < parts.length; i++) {
      if (n.t !== 'd') return null;
      const k = n.kids.get(parts[i]);
      if (!k) return null;
      if (k.t === 'l') {
        const rest = parts.slice(i + 1).join('/');
        const target = norm(k.to, cur || '/');
        return this.realpath(rest ? target + '/' + rest : target, depth + 1);
      }
      cur += '/' + parts[i];
      n = k;
    }
    return cur || '/';
  }

  need(path, o) {
    const n = this.get(path, o);
    if (!n) throw new FsError('ENOENT', path);
    return n;
  }

  parent(path, user) {
    const d = this.need(dirname(path), { user });
    if (d.t !== 'd') throw new FsError('ENOTDIR', path);
    return d;
  }

  read(path, user) {
    if (path === '/dev/null') return '';
    const n = this.need(path, { user });
    if (n.t === 'd') throw new FsError('EISDIR', path);
    if (!this.can(n, user, 4)) throw new FsError('EACCES', path);
    return n.data;
  }

  write(path, data, user, { append = false, mode = 0o644 } = {}) {
    if (path === '/dev/null') return;
    const n = this.get(path, { user });
    if (n) {
      if (n.t === 'd') throw new FsError('EISDIR', path);
      if (!this.can(n, user, 2)) throw new FsError('EACCES', path);
      n.data = append ? n.data + data : data;
      n.mtime = Date.now();
      return;
    }
    const d = this.parent(path, user);
    const link = d.kids.get(basename(path));
    if (link && link.t === 'l') { this.write(norm(link.to, dirname(path)), data, user, { append, mode }); return; }
    if (!this.can(d, user, 2)) throw new FsError('EACCES', path);
    d.kids.set(basename(path), this.node('f', mode, user?.name || 'root', user?.group || 'root', { data }));
    d.mtime = Date.now();
  }

  mkdir(path, user, { p = false, mode = 0o755 } = {}) {
    const ex = this.get(path, { user });
    if (ex) {
      if (p && ex.t === 'd') return;
      throw new FsError('EEXIST', path);
    }
    const dn = dirname(path);
    let d = this.get(dn, { user });
    if (!d) {
      if (!p) throw new FsError('ENOENT', path);
      this.mkdir(dn, user, { p, mode });
      d = this.get(dn);
    }
    if (d.t !== 'd') throw new FsError('ENOTDIR', path);
    if (!this.can(d, user, 2)) throw new FsError('EACCES', path);
    d.kids.set(basename(path), this.node('d', mode, user?.name || 'root', user?.group || 'root'));
    d.mtime = Date.now();
  }

  rm(path, user, { r = false } = {}) {
    if (path === '/') throw new FsError('EPERM', path);
    const n = this.need(path, { follow: false, user });
    const d = this.parent(path, user);
    if (n.t === 'd' && !r && n.kids.size) throw new FsError('ENOTEMPTY', path);
    if (!this.can(d, user, 2)) throw new FsError('EACCES', path);
    if (n.t === 'd') this.#checkTree(n, user, path);
    d.kids.delete(basename(path));
    d.mtime = Date.now();
  }

  #checkTree(n, user, path) {
    if (n.kids.size && !this.can(n, user, 2)) throw new FsError('EACCES', path);
    for (const [k, v] of n.kids) if (v.t === 'd') this.#checkTree(v, user, path + '/' + k);
  }

  mv(src, dst, user) {
    const n = this.need(src, { follow: false, user });
    if (dst === src) return;
    if (dst.startsWith(src + '/')) throw new FsError('EINVAL', dst);
    const sp = this.parent(src, user);
    const dp = this.parent(dst, user);
    if (!this.can(sp, user, 2)) throw new FsError('EACCES', src);
    if (!this.can(dp, user, 2)) throw new FsError('EACCES', dst);
    const ex = dp.kids.get(basename(dst));
    if (ex) {
      if (ex.t === 'd' && n.t !== 'd') throw new FsError('EISDIR', dst);
      if (ex.t === 'd' && ex.kids.size) throw new FsError('ENOTEMPTY', dst);
      if (ex.t !== 'd' && n.t === 'd') throw new FsError('ENOTDIR', dst);
    }
    sp.kids.delete(basename(src));
    dp.kids.set(basename(dst), n);
    sp.mtime = dp.mtime = Date.now();
  }

  cp(src, dst, user, { r = false } = {}) {
    const n = this.need(src, { user });
    if (!this.can(n, user, 4)) throw new FsError('EACCES', src);
    if (n.t === 'd') {
      if (!r) throw new FsError('EISDIR', src);
      if (dst === src || dst.startsWith(src + '/')) throw new FsError('EINVAL', dst);
      if (!this.get(dst, { user })) this.mkdir(dst, user, { mode: n.mode });
      for (const k of [...n.kids.keys()]) this.cp(src + '/' + k, dst + '/' + k, user, { r });
      return;
    }
    this.write(dst, n.data, user, { mode: n.mode });
    if (n.bin) this.get(dst).bin = n.bin;
  }

  ls(path, user) {
    const n = this.need(path, { user });
    if (n.t !== 'd') throw new FsError('ENOTDIR', path);
    if (!this.can(n, user, 4)) throw new FsError('EACCES', path);
    return [...n.kids.keys()];
  }

  // ---- helpers for building fixtures (no permission checks) ----
  dir(path, o = {}) {
    let n = this.root;
    for (const part of path.split('/').filter(Boolean)) {
      if (!n.kids.has(part)) n.kids.set(part, this.node('d', o.mode ?? 0o755, o.owner ?? 'root', o.group ?? 'root', o.mtime ? { mtime: o.mtime } : {}));
      n = n.kids.get(part);
    }
    return n;
  }

  put(path, data, o = {}) {
    const d = this.dir(dirname(path), { owner: o.owner, group: o.group });
    const n = this.node('f', o.mode ?? 0o644, o.owner ?? 'root', o.group ?? 'root', { data });
    if (o.mtime) n.mtime = o.mtime;
    if (o.bin) n.bin = o.bin;
    d.kids.set(basename(path), n);
    return n;
  }

  link(path, to, o = {}) {
    const d = this.dir(dirname(path), o);
    d.kids.set(basename(path), this.node('l', 0o777, o.owner ?? 'root', o.group ?? 'root', { to }));
  }

  // Visit every node below path: fn(absPath, node)
  walk(path, fn) {
    const n = this.get(path);
    if (!n) return;
    const go = (p, node) => {
      fn(p, node);
      if (node.t === 'd') for (const [k, v] of node.kids) go(p === '/' ? '/' + k : p + '/' + k, v);
    };
    go(path, n);
  }

  toJSON() {
    const enc = n => (n.t === 'd' ? { ...n, kids: [...n.kids].map(([k, v]) => [k, enc(v)]) } : n);
    return enc(this.root);
  }

  static fromJSON(j) {
    const dec = n => (n.t === 'd' ? { ...n, kids: new Map(n.kids.map(([k, v]) => [k, dec(v)])) } : n);
    const fs = new VFS();
    fs.root = dec(j);
    return fs;
  }
}
