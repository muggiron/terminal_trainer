// Command registry. Each command file calls def() to register implementations.
//
// meta:
//   builtin: true   -> part of the shell itself (works without PATH)
//   bin: true       -> a builtin that also exists as a program file (echo, pwd, ...)
//   os: 'mac'|'linux' -> only exists on that system
//   pkg: 'name'     -> only available after installing that package
//   dir: { mac, linux } -> folder the program lives in
//   help: true      -> supports --help even on macOS
//   hidden: true    -> not listed by `help`

export const commands = {};

export function def(names, fn, meta = {}) {
  for (const name of [].concat(names)) commands[name] = { name, fn, ...meta };
}

// Thrown through a running command when the user presses Ctrl+C / Ctrl+Z.
export class Signal extends Error {
  constructor(sig, remain = 0) {
    super(sig);
    this.sig = sig;
    this.remain = remain;
  }
}

// Thrown by `exit`.
export class Exit extends Error {
  constructor(code = 0) {
    super('exit');
    this.code = code;
  }
}
