// Public entry point of the shell engine. Importing this file registers every command.

import './commands/files.js';
import './commands/text.js';
import './commands/system.js';
import './commands/editors.js';
import './commands/pkg.js';
import './commands/net.js';
import './commands/git.js';
import './commands/modern.js';

import { Shell } from './shell.js';
import { buildFs } from './fixtures.js';

export { Shell } from './shell.js';
export { VFS } from './vfs.js';
export { buildFs, buildRemote } from './fixtures.js';
export { Signal, commands } from './registry.js';
export { needsMore } from './parser.js';
export { explain, tipText, viExplain } from './coach.js';

// Create a ready-to-use shell: builds the filesystem and reads the startup files.
export async function createShell({ os = 'mac', fs, io, onEvent, speed } = {}) {
  const sh = new Shell({ os, fs: fs || buildFs(os), io, onEvent, speed });
  await sh.init();
  return sh;
}
