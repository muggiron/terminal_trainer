// The coach: turns a failed command into a plain-language explanation of what
// went wrong and how it is usually done. The terminal output itself stays
// exactly like a real shell; the coach's note is shown separately below it.
//
// explain(ev)  -> { what, fix?, example? } | null   for a finished command
// tipText(ev)  -> { what, example?, once? } | null  for teaching moments
// viExplain(code) -> string | null                  for vi error codes
//
// Text in `backticks` is rendered as code by the UI.

import { REFMAP, noteFor } from '../data/reference.js';
import { commands } from './registry.js';
import { nearest } from './util.js';
import { providerOf, PKGS, findPkg, pkgName, installedPkgs } from './packages.js';
import { basename, dirname, norm } from './vfs.js';

const WINDOWS = { dir: 'ls', cls: 'clear', copy: 'cp', move: 'mv', del: 'rm', md: 'mkdir', rd: 'rmdir', ren: 'mv', tasklist: 'ps aux', taskkill: 'kill', where: 'which', notepad: 'nano', ipconfig: null, more: null };
const OTHER_PM = ['dnf', 'yum', 'pacman', 'zypper', 'apk', 'snap', 'port', 'choco', 'winget'];

const q = s => (/[\s'"$]/.test(s) ? `"${s}"` : s);

function known(sh) {
  const names = new Set(Object.keys(commands).filter(k => !commands[k].hidden && (!commands[k].os || commands[k].os === sh.os)));
  for (const k of Object.keys(PKGS)) for (const b of Object.keys(PKGS[k].bins)) names.add(b);
  return [...names];
}

// Look around the filesystem for what the user probably meant.
function pathHint(sh, target) {
  const abs = norm(sh.tilde(target), sh.cwd);
  const dir = dirname(abs);
  const base = basename(abs);
  let parent = null;
  try { parent = sh.fs.get(dir); } catch { /* not a folder */ }
  if (!parent || parent.t !== 'd') return { type: 'nodir', dir: dirname(target) };
  const names = [...parent.kids.keys()];
  const ci = names.find(n => n.toLowerCase() === base.toLowerCase());
  if (ci) return { type: 'case', name: ci };
  const near = nearest(base, names, 2);
  if (near) return { type: 'typo', name: near };
  const pre = names.filter(n => n.toLowerCase().startsWith(base.toLowerCase()));
  if (pre.length === 1) return { type: 'typo', name: pre[0] };
  let found = null;
  sh.fs.walk(sh.home, (p, n) => {
    if (!found && basename(p) === base && p !== abs && p.split('/').length < sh.home.split('/').length + 5) found = p;
  });
  if (found) return { type: 'elsewhere', path: found.startsWith(sh.home) ? '~' + found.slice(sh.home.length) : found };
  return { type: 'none' };
}

function notFound(sh, name, line) {
  const mac = sh.os === 'mac';
  const pm = mac ? 'brew install' : 'sudo apt install';
  if (/^cd\.\.+$/.test(name) || /^cd[~/-]/.test(name)) return { what: `The shell read \`${name}\` as one single command name. \`cd\` and where to go are two separate words.`, fix: 'Put a space between the command and its argument.', example: 'cd ' + name.slice(2) };
  const glued = name.match(/^([a-z]+)(-[A-Za-z]+)$/);
  if (glued && commands[glued[1]]) return { what: `\`${name}\` was read as one word. Options are separate words.`, fix: 'Put a space between the command and its options.', example: `${glued[1]} ${glued[2]}` };
  if (name !== name.toLowerCase() && commands[name.toLowerCase()]) return { what: `Commands are case-sensitive: \`${name}\` and \`${name.toLowerCase()}\` are different names.`, fix: 'Command names are almost always lowercase.', example: line.replace(name, name.toLowerCase()) };
  if (name in WINDOWS) {
    const alt = WINDOWS[name] ?? (name === 'ipconfig' ? (mac ? 'ifconfig' : 'ip a') : 'less');
    return { what: `\`${name}\` is a Windows command. ${mac ? 'macOS' : 'Linux'} uses different names.`, fix: `The equivalent here is \`${alt}\`.`, example: alt };
  }
  if (name === 'brew') {
    if (!mac) return { what: 'Homebrew (`brew`) is the package manager of macOS. This is Ubuntu Linux, which uses `apt`.', fix: 'Install software with apt, using sudo.', example: 'sudo apt install tree' };
    if (sh.fs.get('/opt/homebrew/bin/brew')) return { what: 'Homebrew is installed, but its folder `/opt/homebrew/bin` is not in your `PATH`, so the shell cannot find `brew`.', fix: 'Run the "Next steps" lines the installer printed. This one fixes the current terminal:', example: 'eval "$(/opt/homebrew/bin/brew shellenv)"' };
    return { what: 'Homebrew is not installed yet. It does not ship with macOS.', fix: 'Install it with the one-line command from brew.sh (copy and paste it):', example: '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"' };
  }
  if (name === 'apt' || name === 'apt-get') return { what: '`apt` is the package manager of Ubuntu and Debian Linux. macOS uses Homebrew.', fix: 'Install software with `brew` (no sudo).', example: 'brew install tree' };
  if (OTHER_PM.includes(name)) return { what: `\`${name}\` is the package manager of a different system. ${mac ? 'On macOS it is Homebrew.' : 'This is Ubuntu, which uses apt.'}`, fix: mac ? 'Use `brew`.' : 'Use `apt` with sudo.', example: mac ? 'brew install tree' : 'sudo apt install tree' };
  const cross = { open: ['xdg-open', 'linux'], 'xdg-open': ['open', 'mac'], pbcopy: [null, 'linux'], pbpaste: [null, 'linux'], sw_vers: ['lsb_release -a', 'linux'], lsb_release: ['sw_vers', 'mac'], systemctl: ['brew services', 'mac'], free: ['top', 'mac'], ip: ['ifconfig', 'mac'], ifconfig: ['ip a', 'linux'], say: [null, 'linux'], zsh: ['bash', 'linux'] }[name];
  if (cross && cross[1] === sh.os) return { what: `\`${name}\` exists on ${mac ? 'Linux' : 'macOS'}, not on ${mac ? 'macOS' : 'this Linux system'}.`, fix: cross[0] ? `The counterpart here is \`${cross[0]}\`.` : 'There is no built-in counterpart here.', example: cross[0] || undefined };
  if (name === 'z') return { what: '`z` is created by zoxide\'s shell setup. Installing the package alone is not enough.', fix: `Add the setup line to your shell config (${mac ? '~/.zshrc' : '~/.bashrc'}), or run it now:`, example: `eval "$(zoxide init ${mac ? 'zsh' : 'bash'})"` };
  const prov = providerOf(sh.os, name);
  if (prov) {
    if (prov.renamed && installedPkgs(sh.fs)[prov.key]) return { what: `On Ubuntu the package \`${prov.name}\` installs this tool under the name \`${prov.bin}\`, because another program already uses \`${name}\`.`, fix: `Call it as \`${prov.bin}\`, or create an alias.`, example: `alias ${name}='${prov.bin}'` };
    return { what: `\`${name}\` is not part of the system. It comes from the package \`${prov.name}\`, which is not installed.${prov.renamed ? ` (On Ubuntu the program is then called \`${prov.bin}\`.)` : ''}`, fix: 'Install the package first.', example: `${pm} ${prov.name}` };
  }
  try {
    const here = sh.fs.get(norm(name, sh.cwd));
    if (here && here.t === 'f') return { what: `There is a file called \`${name}\` in this folder, but the shell only looks for commands in the folders listed in \`PATH\`. The current folder is not one of them.`, fix: 'To run a program or script from the current folder, put `./` in front. (It also needs execute permission.)', example: './' + name };
  } catch { /* ignore */ }
  if (commands[name] && !commands[name].builtin && !commands[name].pkg && (!commands[name].os || commands[name].os === sh.os)) return { what: `\`${name}\` exists on this system, but the shell could not find it: your \`PATH\` (the list of folders it searches) is currently \`${sh.env.PATH || '(empty)'}\`.`, fix: 'Restore the standard folders. When adding to PATH, always keep the old value with `$PATH`.', example: `export PATH="${mac ? '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin' : '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'}"` };
  const near = nearest(name, known(sh), 2);
  if (near) return { what: `There is no command called \`${name}\`. It looks like a typo.`, fix: `Did you mean \`${near}\`? Pressing Tab after the first letters completes command names for you.`, example: line.replace(name, near) };
  return { what: `The shell looked through every folder in your \`PATH\` and found no program called \`${name}\`.`, fix: 'Check the spelling. `help` lists the commands of this trainer, and the Reference panel explains each one.', example: 'help' };
}

const RULES = {
  NOTFOUND: x => notFound(x.sh, x.t, x.line),

  ENOENT: x => {
    const { sh, e, t, mac } = x;
    if (e.coach === 'MKDIR_PARENT') return { what: `\`mkdir\` creates only the last folder of a path. The folder above it (\`${dirname(e.wanted)}\`) does not exist yet.`, fix: 'Add `-p` to create all missing parent folders in one go.', example: `mkdir -p ${q(e.wanted)}` };
    if (e.coach === 'FD_PATH') return { what: `\`fd\` takes the search pattern first and the folder second. \`${t}\` was read as a folder to search in, and it does not exist.`, fix: 'Usage: `fd PATTERN [FOLDER]`.', example: `fd ${t}` };
    if (mac && t && t.startsWith('-') && ['ls', 'rm', 'cp', 'mv', 'mkdir', 'cat', 'touch', 'rmdir'].includes(e.cmd)) return { what: `On macOS, options must come before file names. Because \`${t}\` came after a name, \`${e.cmd}\` treated it as a file called "${t}".`, fix: 'Put the options directly after the command. (Linux tools accept both orders.)', example: `${e.cmd} ${t} …` };
    if (x.rec) {
      const plain = x.rec.args.filter(a => !a.startsWith('-'));
      if (plain.length >= 2) {
        const joined = plain.join(' ');
        try { if (sh.fs.get(norm(sh.tilde(joined), sh.cwd))) return { what: `The name \`${joined}\` contains spaces. The shell splits a command at spaces, so it passed ${plain.length} separate names: ${plain.map(p => `\`${p}\``).join(', ')}.`, fix: 'Put quotes around names with spaces, or let Tab complete the name (it adds `\\` before each space).', example: `${e.cmd} "${joined}"` }; } catch { /* ignore */ }
      }
    }
    if (e.cmd === 'shell' && e.redirect) return { what: `The output could not be written: the folder \`${dirname(t)}\` does not exist. \`>\` creates files, but not folders.`, fix: 'Create the folder first.', example: `mkdir -p ${q(dirname(t))}` };
    let own = null;
    try { own = sh.fs.get(norm(sh.tilde(t || ''), sh.cwd), { follow: false }); } catch { /* ignore */ }
    if (own && own.t === 'l') return { what: `\`${t}\` exists, but it is a symbolic link that points to \`${own.to}\`, and that target is gone. This is called a broken link.`, fix: 'Check where a link points with `ls -l`. Remove the broken link with `rm`, or recreate the target.', example: `ls -l ${q(t)}` };
    const h = pathHint(sh, t || '');
    const where = sh.cwd === sh.home ? 'your home folder' : `\`${sh.cwd}\``;
    const redo = name => x.line.replace(basename(t), name);
    if (h.type === 'case') return { what: `There is no \`${basename(t)}\` here, but there is \`${h.name}\`. File names are case-sensitive${mac ? ' in the shell' : ''}: upper and lower case letters are different.`, fix: 'Type the name exactly, or type the first letters and press Tab.', example: redo(h.name) };
    if (h.type === 'typo') return { what: `There is nothing called \`${basename(t)}\` in that folder. The closest name is \`${h.name}\`.`, fix: 'Probably a typo. Typing the first letters and pressing Tab completes names and avoids this.', example: redo(h.name) };
    if (h.type === 'nodir') return { what: `The folder part of the path, \`${h.dir}\`, does not exist, so nothing inside it can be found.`, fix: 'Check each part of the path with `ls`, starting from the left.', example: 'ls' };
    if (h.type === 'elsewhere') return { what: `\`${basename(t)}\` is not in the folder you are in (${where}). A relative path is looked up from your current folder.`, fix: `It exists at \`${h.path}\`. Use that path, or \`cd\` there first.`, example: x.line.replace(t, q(h.path)) };
    return { what: `Nothing called \`${t}\` exists in ${t && t.includes('/') ? 'that location' : where}.`, fix: 'Run `ls` to see what is here, and use Tab to complete names.', example: 'ls' };
  },

  ENOTDIR: ({ e, t }) => (e.cmd === 'cd'
    ? { what: `\`${t}\` is a file, not a folder. \`cd\` can only go into folders.`, fix: 'To look at a file, print it with `cat` or page through it with `less`.', example: `cat ${q(t)}` }
    : e.cmd === 'rmdir'
      ? { what: `\`${t}\` is a file. \`rmdir\` only removes (empty) folders.`, fix: 'Files are removed with `rm`.', example: `rm ${q(t)}` }
      : { what: `Part of the path \`${t}\` is a file, but it is used as if it were a folder.`, fix: 'Check the path piece by piece with `ls -l`.', example: 'ls -l' }),

  EISDIR: ({ e, t }) => {
    if (e.coach === 'GREP_DIR') return { what: `\`${t}\` is a folder. Without an option, \`grep\` only reads files.`, fix: 'Add `-r` to search every file inside a folder.', example: `grep -r PATTERN ${q(t)}` };
    if (e.cmd === 'shell' && e.redirect) return { what: `\`${t}\` is a folder. Output can only be redirected into a file.`, fix: 'Give a file name inside the folder.', example: `… > ${t.replace(/\/*$/, '')}/output.txt` };
    if (e.cmd === 'shell') return { what: `\`${t}\` is a folder, and folders cannot be run as commands.`, fix: 'Use `cd` to go into it or `ls` to look inside.', example: `cd ${q(t)}` };
    if (['cat', 'head', 'tail', 'less', 'more', 'wc', 'sort', 'bat'].includes(e.cmd)) return { what: `\`${t}\` is a folder. \`${e.cmd}\` reads the contents of files.`, fix: 'To see what is inside a folder, list it.', example: `ls ${q(t)}` };
    return { what: `\`${t}\` is a folder, but \`${e.cmd}\` expected a file here.`, fix: `Check with \`ls -l\` what is a file and what is a folder (folders start with \`d\`).`, example: 'ls -l' };
  },

  EEXIST: ({ e, t }) => (e.cmd === 'mkdir'
    ? { what: `Something called \`${t}\` already exists here, so there is nothing to create.`, fix: 'Nothing is broken. With `-p`, mkdir stays quiet when the folder already exists.', example: `mkdir -p ${q(t)}` }
    : { what: `\`${t}\` already exists, and \`${e.cmd}\` does not overwrite it by itself.`, fix: 'Choose another name, or remove the existing one first.', example: 'ls -l' }),

  ENOTEMPTY: ({ e, t }) => (e.cmd === 'rmdir'
    ? { what: `\`rmdir\` only removes empty folders, as a safety net. \`${t}\` still has something in it (maybe hidden files: check with \`ls -a\`).`, fix: 'To delete a folder together with its contents, use `rm -r`. This is permanent.', example: `rm -r ${q(t)}` }
    : { what: `The target folder \`${t}\` already exists and is not empty.`, fix: 'Pick a different target name, or move the contents instead.', example: 'ls' }),

  EACCES: x => {
    const { sh, e, t, line } = x;
    if (e.cmd === 'shell' && e.noexec) return { what: `\`${t}\` is not marked as executable, so the system refuses to run it. New files are never executable by default.`, fix: 'Give it the execute permission once, then run it.', example: `chmod +x ${q(t)}` };
    const abs = norm(sh.tilde(t || ''), sh.cwd);
    let target = null;
    try { target = sh.fs.get(abs); } catch { /* ignore */ }
    if (target && target.owner !== sh.user.name && abs.startsWith(sh.home + '/')) return { what: `\`${t}\` is inside your home folder, but it belongs to \`${target.owner}\`. That usually happens when a file was created with sudo.`, fix: 'Take the ownership back with `chown` (change owner). Changing owners needs sudo.', example: `sudo chown ${sh.user.name} ${q(t.startsWith(sh.home + '/') ? '~' + t.slice(sh.home.length) : t)}` };
    if (e.cmd === 'shell' && e.redirect) {
      if (/^\s*sudo\b/.test(line)) return { what: `\`sudo\` ran the command as administrator, but the \`>\` redirection is done by your own shell, before sudo even starts. Your shell is not allowed to write \`${t}\`.`, fix: 'Pipe into `sudo tee`, which writes the file with admin rights (`-a` appends).', example: `echo "text" | sudo tee -a ${q(t)}` };
      return { what: `You are not allowed to write to \`${t}\`. It belongs to the system (owner: root).`, fix: 'System files are changed with admin rights. For redirection that means piping into `sudo tee` (`-a` appends).', example: `echo "text" | sudo tee -a ${q(t)}` };
    }
    if (e.cmd === 'cd' || e.verb === 'cannot open directory') return { what: `You do not have permission to enter or list \`${t}\`. It is reserved for another user (often root).`, fix: 'Look at the owner and permissions with `ls -ld`. If you really need to look inside, use sudo.', example: `sudo ls ${q(t)}` };
    let n = null;
    try { n = sh.fs.get(norm(sh.tilde(t || ''), sh.cwd)); } catch { /* ignore */ }
    if (n && n.owner === sh.user.name) return { what: `\`${t}\` belongs to you, but its permission bits currently do not allow this (see the first column of \`ls -l\`).`, fix: 'As the owner you can give yourself the permission back.', example: `chmod u+rw ${q(t)}` };
    return { what: `Permission denied: \`${t}\` belongs to ${n ? `\`${n.owner}\`` : 'another user'}, and normal users may not ${['cat', 'head', 'tail', 'less', 'grep', 'wc'].includes(e.cmd) ? 'read' : 'change'} it. This protects the system.`, fix: `If you are sure, run the same command with admin rights by putting \`sudo\` in front. Tip: \`sudo !!\` repeats the last command with sudo.`, example: `sudo ${line}` };
  },

  EPERM: ({ e, t, line }) => (e.cmd === 'kill'
    ? { what: `Process ${t} belongs to another user (probably root). You may only stop your own processes.`, fix: 'Check the owner in the first column of `ps aux`. System processes need sudo, and usually should be left alone.', example: `ps aux | grep ${t}` }
    : { what: `Only the owner of a file (or the administrator) may do this${e.cmd === 'chown' ? '; changing owners always needs admin rights' : ''}.`, fix: 'Check the owner with `ls -l`. If it is right to change it, use sudo.', example: `sudo ${line}` }),

  USAGE: ({ e, sh }) => {
    const r = REFMAP[e.cmd];
    if (!r) return { what: `\`${e.cmd}\` was called without the information it needs.`, fix: `See \`man ${e.cmd}\` or the Reference panel.` };
    return { what: `\`${e.cmd}\` needs to be told what to work on. ${r.sum}.`, fix: `The pattern is \`${r.syn}\`. ${noteFor(r, sh.os)}`.trim(), example: r.ex[0]?.[0] };
  },

  BADOPT: ({ e, t, mac }) => {
    if (t === '--help' && mac) return { what: `Most of the tools built into macOS do not understand \`--help\` (that is a Linux/GNU habit).`, fix: 'On macOS, read the manual page instead. Press q to leave it.', example: `man ${e.cmd}` };
    const r = REFMAP[e.cmd];
    const opts = r?.opts.map(o => o[0]).filter(o => o.startsWith('-')).slice(0, 6).join(', ');
    return { what: `\`${e.cmd}\` has no option \`${t}\`. Options are case-sensitive, and each tool has its own set.`, fix: `${opts ? `Common ones: ${opts}. ` : ''}The full list is in \`man ${e.cmd}\`.`, example: `man ${e.cmd}` };
  },

  SYNTAX: ({ t, line }) => {
    if (t === '|' || t === '&&' || t === '||') return { what: `\`${t}\` connects two commands, so there must be a command on both sides of it.`, fix: 'Example of a complete pipeline:', example: 'ls | wc -l' };
    if (t === '\\n' || t === 'newline') return { what: /[<>]\s*$/.test(line) ? 'The redirection has no target: after `>` or `<` the shell expects a file name.' : 'The line ended before the command was complete.', fix: 'Add what is missing at the end of the line.', example: 'echo hello > file.txt' };
    return { what: `The shell could not make sense of the line around \`${t}\`. Characters like \`| & ; < > ( )\` have special meanings.`, fix: 'If you meant the character literally, put it in quotes.', example: `echo "a ${t} b"` };
  },

  NOMATCH: ({ t }) => ({ what: `zsh tried to replace the pattern \`${t}\` with matching file names, found none, and stopped before running the command.`, fix: 'Check with `ls` what is really there. If you meant the characters literally (for example for `find -name`), put the pattern in quotes.', example: `"${t}"` }),

  HIST: () => ({ what: '`!` followed by text recalls an earlier command from your history, and no earlier command matched.', fix: 'If you want a literal `!`, use single quotes. `history` shows what can be recalled.', example: "echo 'Hello!'" }),

  CD_ARGS: ({ t }) => ({ what: `\`cd\` takes exactly one folder, but it received several words (\`${t}\`). The shell splits at spaces.`, fix: 'If the folder name contains spaces, quote it, or let Tab complete it.', example: `cd "${t}"` }),

  RM_DIR: ({ t }) => ({ what: `\`${t}\` is a folder. Plain \`rm\` only deletes files, as a safety net.`, fix: 'Use `rm -r` to delete a folder and everything inside it. There is no trash and no undo. For an empty folder, `rmdir` is the safe choice.', example: `rm -r ${q(t)}` }),
  CP_DIR: ({ e, t }) => ({ what: `\`${t}\` is a folder. \`${e.cmd}\` copies single files unless told otherwise.`, fix: 'Add `-r` (recursive) to copy a folder with everything inside.', example: `${e.cmd} -r ${q(t)} DESTINATION` }),
  RM_ROOT: () => ({ what: 'This would delete far more than a single item (the whole system, or the folder you are standing in). `rm` refuses.', fix: 'Always name the specific file or folder you want to delete, and look twice before pressing Enter on any `rm -r`.' }),
  SAME_FILE: () => ({ what: 'Source and destination are the same file, so there is nothing to copy.', fix: 'Give the copy a different name or put it in a different folder.', example: 'cp notes.txt notes-copy.txt' }),
  TARGET_NOT_DIR: ({ e, t }) => ({ what: `With more than two names, the last one must be an existing folder that receives all the others. \`${t}\` is not a folder.`, fix: 'Create the folder first, or check for a typo. A stray space in a file name also causes this.', example: `mkdir ${q(t)}` }),
  EINVAL: ({ t }) => ({ what: `A folder cannot be moved into itself (\`${t}\`).`, fix: 'Choose a destination outside of the folder you are moving.' }),

  FIND_PATH: () => ({ what: 'On macOS, `find` must be told where to start searching. (Linux assumes the current folder.)', fix: 'Give a starting folder first. `.` means "here".', example: 'find . -name "*.txt"' }),
  FIND_UNQUOTED: () => ({ what: 'The pattern was not quoted, so the shell replaced `*` with the matching file names in the current folder before `find` even started. find then received several names instead of one pattern.', fix: 'Always put patterns for `find -name` in quotes, so that find (not the shell) does the matching.', example: 'find . -name "*.jpg"' }),
  FIND_EXEC: () => ({ what: '`-exec` needs to know where the command ends.', fix: 'End it with `\\;` (escaped, so the shell passes it on). `{}` stands for each file found.', example: 'find . -name "*.log" -exec rm {} \\;' }),
  SED_I: () => ({ what: "On macOS, `sed -i` requires an extra argument: the suffix for a backup file. sed took your script as that suffix and then tried to read the file name as the script.", fix: "Pass an empty suffix `''` to edit in place without a backup. (On Linux, plain `-i` works.)", example: "sed -i '' 's/old/new/g' file.txt" }),
  SED_SCRIPT: ({ t }) => ({ what: `sed could not understand the script \`${t}\`.`, fix: 'The most common script is search-and-replace: `s/old/new/` (add `g` to replace every match). Put it in single quotes.', example: "sed 's/old/new/g' file.txt" }),
  AWK_SYNTAX: () => ({ what: 'awk could not understand the program.', fix: 'Put the program in single quotes and the action in braces.', example: "awk '{print $1}' file.txt" }),
  NOMAN: ({ t }) => ({ what: `There is no manual page for \`${t}\`. Either it is not a command, or it is a shell builtin without its own page.`, fix: '`type NAME` tells you what a name is. `help` lists the commands of this trainer.', example: `type ${t}` }),
  BAD_MODE: ({ t }) => ({ what: `\`${t}\` is not a valid permission. chmod understands letters (\`u+x\`, \`go-w\`, \`a=r\`) or three digits (\`644\`, \`755\`).`, fix: 'Letters: who (u g o a), plus/minus/equals, what (r w x). Digits: r=4, w=2, x=1 added up, for owner, group, others.', example: 'chmod u+x script.sh' }),
  BAD_USER: ({ t }) => ({ what: `There is no user or group called \`${t}\` on this system.`, fix: '`whoami` prints your user name, `groups` your groups.', example: 'whoami' }),
  BAD_NAME: ({ t }) => ({ what: `\`${t}\` is not a valid variable assignment. There must be no spaces around \`=\`, and names consist of letters, digits and \`_\`.`, fix: 'Write NAME=value without spaces. Quote the value if it contains spaces.', example: 'export EDITOR="vim"' }),
  SUDO_PW: () => ({ what: 'sudo asks for your own login password and gives up after three failed attempts.', fix: 'Nothing is shown while you type a password; that is normal. In this trainer any non-empty text is accepted. Never type your real password here.' }),
  SU: ({ mac }) => ({ what: `\`su\` wants the password of the root account, which is disabled on ${mac ? 'macOS' : 'Ubuntu'}.`, fix: 'Use `sudo` in front of a single command instead. It asks for your own password.', example: 'sudo whoami' }),
  ESRCH: ({ t }) => ({ what: `No running process has the ID or name \`${t}\`. Maybe it already ended, or the number is mistyped.`, fix: 'Look the process up first. The PID is the second column.', example: 'ps aux' }),
  NOJOB: () => ({ what: 'This shell has no such background or suspended job.', fix: '`jobs` lists them. A job appears after you start something with `&` or suspend it with Ctrl+Z.', example: 'jobs' }),
  BAD_PID: ({ t }) => ({ what: `\`kill\` expects a process ID (a number) or a job like \`%1\`, not \`${t}\`.`, fix: 'Find the number with `ps` or `pgrep`, or stop a program by name with `pkill`.', example: `pkill ${t}` }),
  SVC_ROOT: ({ t }) => ({ what: 'Starting and stopping system services changes the whole machine, so it needs admin rights. Checking the status does not.', fix: 'Put `sudo` in front.', example: `sudo systemctl ${t}` }),
  NO_UNIT: ({ t }) => ({ what: `No service called \`${t}\` is installed.`, fix: 'List the services that exist.', example: 'systemctl list-units' }),

  BREW_ROOT: ({ line }) => ({ what: 'Homebrew installs into a folder that belongs to you, so it never needs sudo, and it refuses to run as root for safety.', fix: 'Run the same command without `sudo`.', example: line.replace(/^\s*sudo\s+/, '') }),
  PKG_UNKNOWN: ({ sh, t, mac }) => {
    const alias = { rg: 'ripgrep', fdfind: mac ? 'fd' : 'fd-find', fd: mac ? 'fd' : 'fd-find', batcat: 'bat', z: 'zoxide', tldr: mac ? 'tlrc' : 'tldr', nvim: 'neovim' }[t];
    if (alias && alias !== t && findPkg(sh.os, alias)) return { what: `\`${t}\` is the name of the command, but the package that contains it is called \`${alias}\`. Package and command names sometimes differ.`, fix: 'Install the package by its own name.', example: mac ? `brew install ${alias}` : `sudo apt install ${alias}` };
    const near = nearest(t || '', Object.keys(PKGS).map(k => pkgName(sh.os, k)), 2);
    return { what: `The package manager knows no package called \`${t}\`.${near ? ` Did you mean \`${near}\`?` : ''}`, fix: 'Search for the right name first.', example: mac ? `brew search ${(t || '').slice(0, 4)}` : `apt search ${(t || '').slice(0, 4)}` };
  },
  PKG_NOT_INSTALLED: ({ t }) => ({ what: `\`${t}\` is not installed, so it cannot be removed.`, fix: 'List what is installed.', example: 'brew list' }),
  BREW_SUB: ({ t }) => ({ what: `\`brew\` has no subcommand \`${t}\`.`, fix: 'The everyday ones are install, uninstall, list, search, info, update and upgrade.', example: 'brew help' }),
  APT_ROOT: ({ t }) => ({ what: 'Installing, removing or updating software changes system folders, and only the administrator may do that. Searching and showing works without.', fix: 'Put `sudo` in front. `sudo !!` repeats the last command with sudo.', example: `sudo apt ${t}` }),
  APT_SUB: ({ t }) => ({ what: `\`apt\` has no operation called \`${t}\`.`, fix: 'The everyday ones are update, install, remove, upgrade, search, show and list.', example: 'apt help' }),

  NET_HOST: ({ t }) => ({ what: `The name \`${t}\` could not be turned into a network address. Either it is misspelled or the machine is offline. (This trainer only knows a few pretend hosts.)`, fix: 'Hosts that exist here: example.com, api.example.com, files.example.com, server.example.com.', example: 'ping -c 3 example.com' }),
  NET_REFUSED: ({ t }) => ({ what: `\`${t}\` was reached, but nothing is listening on that port: no server program is running there.`, fix: 'Check that the service is started and that host and port are right.' }),
  HTTP_404: ({ t }) => ({ what: `The server answered "404 Not Found": the host exists, but there is no page at that path (\`${t}\`).`, fix: 'Check the part of the URL after the host name.', example: 'curl https://files.example.com/notes.txt' }),
  CURL_O: () => ({ what: '`-O` saves under the file name at the end of the URL, but this URL ends in `/`, so there is no name.', fix: 'Choose the name yourself with lowercase `-o`.', example: 'curl -o page.html https://example.com/' }),
  SSH_HOST: ({ t }) => ({ what: `ssh could not find a computer called \`${t}\`.`, fix: 'The form is `ssh USER@HOST`. This trainer has one pretend server.', example: 'ssh you@server.example.com' }),
  SSH_VERIFY: () => ({ what: 'You declined the host key, so ssh did not connect. On first contact ssh shows the server\'s fingerprint so that you can be sure it is the right machine.', fix: 'If you trust the server, answer `yes` (the full word).', example: 'ssh you@server.example.com' }),
  SSH_AUTH: () => ({ what: 'The server rejected the login: wrong password three times.', fix: 'Nothing is shown while typing a password. In this trainer any non-empty text works.' }),
  SCP_LOCAL: () => ({ what: '`scp` copies between computers. One of the two paths must be remote, written as `USER@HOST:PATH` (note the colon).', fix: 'For two local paths, plain `cp` is the tool.', example: 'scp notes.txt you@server.example.com:~/' }),

  TAR_MODE: () => ({ what: 'tar must be told what to do: create (`c`), extract (`x`) or list (`t`).', fix: 'The classic combinations: `-czf` create, `-xzf` extract, `-tzf` list. `z` = gzip, `f` = the archive file follows.', example: 'tar -czf backup.tar.gz Documents' }),
  TAR_F: () => ({ what: 'tar was not told which archive file to use. Without `-f` it tries to use a tape drive, a leftover from the 1970s.', fix: 'Always include `f`, directly followed by the archive name.', example: 'tar -xzf archive.tar.gz' }),
  TAR_EMPTY: () => ({ what: 'tar was asked to create an archive but not told what to put into it.', fix: 'Name the archive first, then the files or folders to pack.', example: 'tar -czf backup.tar.gz Documents' }),
  TAR_FORMAT: ({ t }) => ({ what: `\`${t}\` is not a tar archive.`, fix: '`file NAME` tells you what kind of file something is. `.zip` files are unpacked with `unzip`.', example: `file ${q(t || '')}` }),
  ZIP_FORMAT: ({ t }) => ({ what: `\`${t}\` is not a zip archive.`, fix: '`file NAME` tells you what it is. `.tar.gz` files are unpacked with `tar -xzf`.', example: `file ${q(t || '')}` }),

  GIT_NOREPO: () => ({ what: 'git commands only work inside a repository: a folder that contains a hidden `.git` folder. The folder you are in is not one.', fix: '`cd` into your project first. To start tracking a new project, run `git init` inside it.', example: 'git init' }),
  GIT_IDENT: () => ({ what: 'Every commit records who made it, and git does not know your name and e-mail yet. This is a one-time setup per computer.', fix: 'Set both, then repeat the commit.', example: 'git config --global user.name "Your Name"' }),
  GIT_NOTHING: () => ({ what: 'There is nothing in the staging area. A commit only contains what you have staged with `git add`.', fix: 'Stage your changes first (`git add .` stages everything), then commit. `git status` always tells you where things stand.', example: 'git add .' }),
  GIT_PATHSPEC: ({ t }) => ({ what: `git found no file matching \`${t}\`, neither in the folder nor among the tracked files.`, fix: 'Check the name with `git status` or `ls`.', example: 'git status' }),
  GIT_NOBRANCH: ({ t }) => ({ what: `There is no branch called \`${t}\`.`, fix: 'List the branches with `git branch`. To create a new one and switch to it:', example: `git switch -c ${t}` }),
  GIT_DIRTY: () => ({ what: 'You have uncommitted changes in files that differ on the other branch. git refuses, because switching would overwrite your work.', fix: 'Commit the changes first, or park them with `git stash` (bring them back later with `git stash pop`).', example: 'git stash' }),
  GIT_CONFLICT: ({ t }) => ({ what: `Both branches changed the same file (\`${t}\`), and git cannot decide which version wins. It wrote both versions into the file, between \`<<<<<<<\`, \`=======\` and \`>>>>>>>\` markers.`, fix: 'Open the file, keep what you want, delete the three marker lines, then `git add` the file and `git commit`. Or give up the merge with `git merge --abort`.', example: `vi ${q(t || '')}` }),
  GIT_UNMERGED: () => ({ what: 'The merge is not finished: some files still count as conflicted.', fix: 'After fixing a file, mark it as resolved with `git add FILE`, then commit.', example: 'git status' }),
  GIT_NOCOMMITS: () => ({ what: 'This repository has no commits yet, so there is no history and nothing a branch could point to.', fix: 'Make the first commit.', example: 'git add . && git commit -m "First commit"' }),
  GIT_NOREMOTE: () => ({ what: 'This repository is not connected to a server ("remote"), so there is nowhere to push to or pull from.', fix: 'Connect it once with `git remote add origin URL`. Cloned repositories have this already.', example: 'git remote -v' }),
  GIT_CLONE: () => ({ what: 'The server has no repository at that URL (or it is private).', fix: 'This trainer offers one pretend repository:', example: 'git clone https://github.com/example/hello-world.git' }),
  GIT_CLONE_EXISTS: ({ t }) => ({ what: `Cloning creates a new folder named after the repository, but \`${t}\` already exists.`, fix: 'Clone into another name by adding it at the end, or go into the existing folder.', example: `cd ${q(t || '')}` }),
  GIT_SUB: ({ t }) => ({ what: `git has no command \`${t}\`.`, fix: 'The everyday ones: status, add, commit, log, diff, branch, switch, merge.', example: 'git status' }),
  GIT_BRANCH_EXISTS: ({ t }) => ({ what: `A branch called \`${t}\` already exists.`, fix: 'Switch to it (without `-c`).', example: `git switch ${t}` }),
  GIT_BRANCH_CURRENT: () => ({ what: 'You cannot delete the branch you are standing on.', fix: 'Switch to another branch first.', example: 'git switch main' }),
  GIT_NOT_MERGED: ({ t }) => ({ what: `Branch \`${t}\` has commits that exist nowhere else. \`-d\` refuses so that you do not lose them.`, fix: 'Merge it first, or use capital `-D` if you really want to throw those commits away.', example: `git merge ${t}` }),
  GIT_EMPTY_MSG: () => ({ what: 'A commit needs a message. An empty message cancels the commit.', fix: 'The quickest way is to give the message on the command line.', example: 'git commit -m "Describe the change"' }),
  GIT_ADD_NOTHING: () => ({ what: '`git add` needs to know what to stage.', fix: '`git add .` stages everything in the current folder.', example: 'git add .' }),
  GIT_OUTSIDE: () => ({ what: 'That path is outside of the repository.', fix: 'git only tracks files inside the project folder.' }),
  GIT_UNSUPPORTED: () => ({ what: 'This git command exists, but the trainer does not simulate it.', fix: 'Supported: init, clone, status, add, commit, log, diff, show, branch, switch, checkout, merge, restore, reset, stash, remote, push, pull, config.' }),

  JQ_SYNTAX: () => ({ what: 'jq could not understand the filter.', fix: "Put the filter in single quotes so the shell leaves it alone. Paths start with a dot: `.name`, `.[0]`, `.[]`.", example: "jq '.[0].name' file.json" }),
  JQ_INPUT: () => ({ what: 'The input is not valid JSON. If it came from `curl`, the progress meter or an error page may be mixed in.', fix: 'Use `curl -s` (silent), and look at the raw input first.', example: 'curl -s https://api.example.com/users | jq .' }),
  JQ_RUNTIME: ({ t }) => ({ what: `The filter does not fit the shape of the data: ${t}. For example, \`.name\` works on an object, not on a list of objects.`, fix: 'Look at the structure with `jq .` first. To apply something to every element of a list, go through `.[]`.', example: "jq '.[].name'" }),
  RG_REGEX: () => ({ what: 'ripgrep treats the pattern as a regular expression, where characters like `( [ { * +` have special meanings.', fix: 'Add `-F` to search for the text literally.', example: 'rg -F "text(with)brackets"' }),
  Z_NOMATCH: () => ({ what: 'zoxide only knows folders you have visited (with `cd` or `z`) since it was set up.', fix: 'Visit the folder once with `cd`; from then on `z` can jump to it.', example: 'zoxide query -l' }),
  VI_DIR: ({ t }) => ({ what: `\`${t}\` is a folder. Editors open files.`, fix: 'Name a file inside the folder.', example: `ls ${q(t || '')}` }),
};

// Explain why a finished command failed. Returns null when no error was recorded
// (a non-zero exit alone, e.g. grep finding nothing, is not treated as a mistake).
export function explain(ev) {
  const e = ev.err;
  if (!e || !RULES[e.code]) return null;
  const sh = ev.sh;
  const rec = [...ev.cmds].reverse().find(c => c.name === e.cmd) || null;
  try {
    return RULES[e.code]({ sh, e, t: e.target, line: ev.line.trim(), mac: sh.os === 'mac', rec });
  } catch (err) {
    console.error(err);
    return null;
  }
}

const TIPS = {
  stdin: ({ cmd }) => ({ what: `\`${cmd}\` was started without a file, so it is now waiting for you to type its input. That is why there is no prompt.`, fix: 'Type some lines, then press **Ctrl+D** on an empty line to finish. **Ctrl+C** cancels.' }),
  overwrite: ({ file }) => ({ what: `Heads up: \`>\` replaced everything that was in \`${file}\`. There is no undo.`, fix: 'To add to the end of a file instead, use `>>`.', once: true }),
  rm: () => ({ what: 'Files deleted with `rm` are gone for good. They do not go to the trash.', fix: '`rm -i` asks before each deletion, and `ls` with the same pattern first shows what would be hit.', once: true }),
  silent: ({ cmd }) => ({ what: `\`${cmd}\` printed nothing, and that is good news: most commands stay silent when they succeed.`, fix: 'Check the result with `ls`.', once: true }),
  sudo: ({ ssh }) => ({ what: 'While you type a password, nothing appears on screen: no dots, no stars. That is normal. Just type and press Enter.', fix: `This trainer accepts any non-empty text. **Never type your real password here.**${ssh ? '' : ' After the first time, sudo remembers you for a few minutes.'}` }),
  pager: ({ cmd }) => ({ what: `\`${cmd}\` showed its output in the pager \`less\`, which takes over the screen until you leave it.`, fix: '**q** quits, **Space** scrolls a page, **/text** searches.', once: true }),
  follow: () => ({ what: '`tail -f` keeps running and waits for new lines to be added to the file.', fix: 'Press **Ctrl+C** to stop it.' }),
  'ping-forever': () => ({ what: `Without \`-c\`, ping keeps going until you stop it.`, fix: 'Press **Ctrl+C** to stop and see the statistics. `ping -c 3 HOST` sends just three.' }),
  open: ({ target, kind, app }) => ({ what: kind === 'url' ? `On a real system this would open \`${target}\` in your web browser.` : kind === 'dir' ? `On a real system this would open the folder \`${target}\` in the file manager.` : kind === 'app' ? `On a real system this would start the app ${app}.` : `On a real system this would open \`${target}\` with ${app || 'its default app'}.`, fix: 'The trainer has no desktop, so nothing visible happens here.' }),
  say: ({ text }) => ({ what: `The computer says: "${text}"`, fix: 'On a real Mac this is spoken through the speakers.' }),
  subshell: ({ shell }) => ({ what: `On a real system, \`${shell}\` without arguments starts a new shell inside the current one (leave it with \`exit\`).`, fix: `The trainer stays in the current shell. To run a script: \`${shell} script.sh\`.` }),
  rootshell: () => ({ what: 'You are now root, the administrator. The prompt ends in `#` as a warning: every command runs with full power.', fix: 'Do what you need and leave with `exit`. Prefer `sudo COMMAND` for single commands.' }),
  'alias-temp': ({ os }) => ({ what: 'This alias lives only in the current terminal session.', fix: `To keep it, add the same line to your shell config file (\`${os === 'mac' ? '~/.zshrc' : '~/.bashrc'}\`).`, once: true }),
  'path-broken': ({ path }) => ({ what: `PATH is now \`${path}\`, without the system folders. The shell will no longer find commands like \`ls\`.`, fix: 'When adding a folder, keep the old value: `export PATH="$HOME/bin:$PATH"`. To repair it now:', example: 'export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"' }),
  stubborn: ({ pid }) => ({ what: `Process ${pid} ignored the polite request to stop (the default signal, TERM). A frozen program can do that.`, fix: 'Force it with signal 9 (KILL), which cannot be ignored. Use it as a last resort, because the program gets no chance to save.', example: `kill -9 ${pid}` }),
  'brew-next-steps': () => ({ what: 'Homebrew is installed, but your shell does not know where to find it yet. The installer says so under "Next steps", which is easy to overlook.', fix: 'Run the three commands it lists. The first two make the setting permanent, the third applies it to this terminal.' }),
  'apt-renamed': ({ pkg, bin, usual }) => ({ what: `On Ubuntu, the package \`${pkg}\` installs its program as \`${bin}\`, because the usual name \`${usual}\` is already taken by another package.`, fix: `Call it as \`${bin}\`, or add \`alias ${usual}='${bin}'\` to your ~/.bashrc.` }),
  'http-404': ({ url }) => ({ what: `The server answered, but with "404 Not Found": there is no page at \`${url}\`. curl prints the error page all the same.`, fix: 'With `-f`, curl reports HTTP errors instead of printing the page.' }),
  'ssh-fingerprint': () => ({ what: 'The first time you connect to a server, ssh shows its fingerprint and asks whether to trust it. Afterwards it is remembered in `~/.ssh/known_hosts`.', fix: 'Type the full word `yes` and press Enter.' }),
  'ssh-in': ({ host }) => ({ what: `You are now working on the remote machine. Look at the prompt: the host name changed. Every command runs over there, on ${host}.`, fix: 'Type `exit` (or press Ctrl+D) to come back to your own computer.' }),
  'git-editor': () => ({ what: 'Because there was no `-m "message"`, git opened your editor (vi) for the commit message.', fix: 'Press `i`, type a message on the first line, press Esc, then type `:wq` and Enter. Quitting with an empty message cancels the commit.' }),
  'git-diff-staged': () => ({ what: '`git diff` shows only changes that are not staged yet, and everything is staged.', fix: 'To see what is staged for the next commit:', example: 'git diff --staged' }),
  'git-branch-created': ({ name }) => ({ what: `The branch \`${name}\` was created, but you are still on the old branch.`, fix: 'Switch to it. (`git switch -c NAME` creates and switches in one step.)', example: `git switch ${name}` }),
  'zip-r': () => ({ what: 'Without `-r`, zip stores only the empty folder, not the files inside it.', fix: 'Add `-r` (recursive) to include the contents.', example: 'zip -r archive.zip folder' }),
  exit: () => ({ what: '`exit` closes the shell. On a real system the terminal window would now close.', fix: 'The trainer starts a fresh session for you.' }),
};

export function tipText(ev) {
  const t = TIPS[ev.id];
  return t ? t({ ...ev.data, os: ev.sh?.os }) : null;
}

const VI = {
  E37: 'You changed the text but have not saved it, so vi will not quit. `:wq` saves and quits. `:q!` quits and throws the changes away.',
  E492: 'vi does not know that command. The ones you need most: `:w` save, `:q` quit, `:wq` both, `:q!` quit without saving. If you wanted to type text, press Esc and then `i`.',
  E45: 'This file is read-only for you (it belongs to another user). Quit with `:q!` and open it again with `sudo vi FILE`.',
  E212: 'vi is not allowed to write this file. Quit with `:q!` and open it again with `sudo`, or save a copy somewhere you may write: `:w ~/copy.txt`.',
  E32: 'This text has no file name yet. Give it one when saving: `:w notes.txt`.',
  E486: 'The text you searched for does not occur in the file. Searching is case-sensitive.',
  E35: 'There is no earlier search to repeat. Start one with `/` followed by the text and Enter.',
  E518: 'vi does not know that option. Useful ones: `:set number`, `:set hlsearch`, `:set ignorecase`.',
  E17: 'That name is a folder. Save under a file name instead: `:w FILE`.',
};
export const viExplain = code => VI[code] || null;
