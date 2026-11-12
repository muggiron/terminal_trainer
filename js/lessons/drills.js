// Review drills: short, self-contained tasks without step-by-step guidance.
// Each drill belongs to a lesson and becomes available once that lesson is done.
//   { id, lesson, q (the task), a (one correct answer), check(ev), setup?(sh) }

import { ran, cmd, out, cwd, exists, gone, isDir, isLink, fileHas, all, any, has, arg, node, quiet, line } from './checks.js';
import { installedPkgs } from '../shell/packages.js';

const D = (id, lesson, q, a, check, setup) => ({ id, lesson, q, a, check, setup });

export function buildDrills(os) {
  const mac = os === 'mac';
  return [
    D('pwd', 'look', 'Show which folder you are in.', 'pwd', ran('pwd')),
    D('ls-a', 'look', 'List the current folder, including hidden files.', 'ls -a', ran('ls', a => /[aA]/.test(a.filter(x => x.startsWith('-')).join('')))),
    D('ls-l', 'look', 'List the current folder with details (permissions, size, date).', 'ls -l', ran('ls', has('l'))),
    D('ls-dir', 'look', 'List what is inside the Documents folder, without going there.', 'ls Documents', ran('ls', arg(/Documents\/?$/))),

    D('cd-docs', 'move', 'Go into the Documents folder.', 'cd Documents', cwd('~/Documents')),
    D('cd-home', 'move', 'You are somewhere deep in the system. Go to your home folder.', 'cd', cwd('~'), sh => quiet(sh, 'cd /usr/bin')),
    D('cd-up', 'move', 'Go up one level.', 'cd ..', cwd('~/Documents'), sh => quiet(sh, 'cd ~/Documents/recipes')),
    D('cd-back', 'move', 'Jump back to the folder you were in before.', 'cd -', ran('cd', arg('-')), sh => quiet(sh, 'cd ~/projects; cd ~/Downloads')),

    D('man', 'help', 'Open the manual page for grep (then quit it with q).', 'man grep', ran('man', arg('grep'))),
    D('which', 'help', 'Find out where the program ls is stored.', 'which ls', any(ran('which', arg('ls')), ran('type', arg('ls')))),

    D('mkdir', 'create', 'Create a folder called reports.', 'mkdir reports', isDir('~/reports')),
    D('touch', 'create', 'Create an empty file called draft.txt.', 'touch draft.txt', exists('~/draft.txt')),
    D('mkdir-p', 'create', 'Create the nested folders work/2026/q1 with a single command.', 'mkdir -p work/2026/q1', isDir('~/work/2026/q1')),
    D('write', 'create', 'Put the word hello into a file called hi.txt.', 'echo hello > hi.txt', fileHas('~/hi.txt', /^hello\n?$/)),
    D('append', 'create', 'Add the line "buy stamps" to the end of Documents/todo.txt, keeping what is there.', 'echo "buy stamps" >> Documents/todo.txt', all(fileHas('~/Documents/todo.txt', /fix the bike\n.*buy stamps\n?$/s), cmd(() => true))),

    D('cp', 'copy', 'Copy Documents/notes.txt to Documents/notes-copy.txt.', 'cp Documents/notes.txt Documents/notes-copy.txt', all(exists('~/Documents/notes-copy.txt'), exists('~/Documents/notes.txt'))),
    D('mv', 'copy', 'Rename Documents/todo.txt to Documents/tasks.txt.', 'mv Documents/todo.txt Documents/tasks.txt', all(exists('~/Documents/tasks.txt'), gone('~/Documents/todo.txt'))),
    D('rm', 'copy', 'Delete the file Downloads/old-notes.txt.', 'rm Downloads/old-notes.txt', gone('~/Downloads/old-notes.txt')),
    D('cp-r', 'copy', 'Copy the whole Documents folder to Documents-backup.', 'cp -r Documents Documents-backup', exists('~/Documents-backup/notes.txt')),
    D('rm-r', 'copy', 'Delete the folder Documents/recipes together with its contents.', 'rm -r Documents/recipes', gone('~/Documents/recipes')),

    D('head', 'read', 'Show the first 3 lines of Documents/report.md.', 'head -n 3 Documents/report.md', all(ran('head'), cmd(ev => ev.out.split('\n').length === 4))),
    D('tail', 'read', 'Show the last 2 lines of projects/logs/server.log.', 'tail -n 2 projects/logs/server.log', all(ran('tail'), cmd(ev => ev.out.split('\n').length === 3))),
    D('wc', 'read', 'Count the lines of Documents/todo.txt.', 'wc -l Documents/todo.txt', all(any(ran('wc'), ran('grep')), out(/(^|\s)6(\s|$)/))),

    D('glob', 'wild', 'List all .jpg files in the Downloads folder.', 'ls Downloads/*.jpg', all(line(/\*/), ran('ls', arg(/\.jpg$/)))),
    D('quote', 'wild', 'Print the file "day 1.txt" that is inside Downloads/My Summer Trip.', 'cat "Downloads/My Summer Trip/day 1.txt"', all(ran('cat'), out(/Lisbon/))),

    D('symlink', 'links', 'Create a symbolic link called docs that points to the Documents folder.', 'ln -s Documents docs', isLink('~/docs')),
    D('readlink', 'links', 'A link called site exists. Show where it points.', 'readlink site', all(ran(['readlink', 'ls', 'realpath', 'file', 'stat']), out(/projects\/website/)), sh => quiet(sh, 'ln -s ~/projects/website ~/site')),

    D('redir', 'redirect', 'Save the output of ls -l into a file called list.txt.', 'ls -l > list.txt', fileHas('~/list.txt', /Documents/)),
    D('stderr', 'redirect', 'Run ls on a folder that does not exist (call it nope) and save the error message into err.txt.', 'ls nope 2> err.txt', fileHas('~/err.txt', /nope/)),

    D('count-err', 'pipe', 'Count how many lines of projects/logs/server.log contain ERROR.', 'grep ERROR projects/logs/server.log | wc -l', all(ran('grep'), out(/^\s*5\s*$/))),
    D('grep', 'pipe', 'Show the lines of Documents/todo.txt that contain TODO.', 'grep TODO Documents/todo.txt', all(ran('grep'), out(/^(TODO.*\n){4}$/))),
    D('uniq', 'pipe', 'Print the lines of Documents/fruits.txt sorted, with each fruit only once.', 'sort Documents/fruits.txt | uniq', out(/^apple\nbanana\ncherry\ndate\nelderberry\n$/)),

    D('find', 'find', 'Find all files ending in .md below your home folder.', 'find . -name "*.md"', all(ran(['find', 'fd', 'fdfind']), out(/report\.md/), out(/README\.md/))),
    D('grep-r', 'find', 'Search every file in the projects folder for the text TODO.', 'grep -r TODO projects', all(ran(['grep', 'rg']), out(/app\.js/), out(/README\.md/))),

    D('chmod-x', 'perm', 'Make the script projects/scripts/hello.sh executable.', 'chmod +x projects/scripts/hello.sh', cmd((ev, sh) => !!(node(sh, '~/projects/scripts/hello.sh')?.mode & 0o100))),
    D('chmod-600', 'perm', 'Change Documents/notes.txt so that only you can read and write it (nobody else anything).', 'chmod 600 Documents/notes.txt', cmd((ev, sh) => node(sh, '~/Documents/notes.txt')?.mode === 0o600)),

    D('sudo', 'sudo', 'Run whoami as the administrator.', 'sudo whoami', all(ran('whoami'), out(/root/))),
    D('chown', 'sudo', 'The file locked.txt in your home folder belongs to root. Make yourself (you) its owner.', 'sudo chown you locked.txt', cmd((ev, sh) => node(sh, '~/locked.txt')?.owner === 'you'), sh => { sh.fs.put(`${sh.home}/locked.txt`, 'mine\n', { owner: 'root', group: sh.rootUser.group }); }),

    D('path', 'env', 'Print the value of the PATH variable.', 'echo $PATH', all(ran(['echo', 'printenv', 'env']), out(/\/usr\/bin/))),
    D('alias', 'rc', 'Create an alias called la that runs ls -a.', "alias la='ls -a'", cmd((ev, sh) => /^ls\s+-\w*a/.test(sh.aliases.la || ''))),

    D('ps', 'proc', 'List all running processes of all users.', 'ps aux', ran('ps', a => /[aeA]/.test(a.join('')))),
    D('bg', 'proc', 'Start sleep 100 so that it runs in the background.', 'sleep 100 &', cmd((ev, sh) => sh.jobs.some(j => /sleep/.test(j.cmd) && j.state === 'running'))),

    D('install', 'pkg', 'Install the package tree.', mac ? 'brew install tree' : 'sudo apt install tree', cmd((ev, sh) => !!installedPkgs(sh.fs).tree)),

    D('download', 'net', 'Download https://files.example.com/notes.txt into the current folder.', 'curl -O https://files.example.com/notes.txt', exists('~/notes.txt')),
    D('ping', 'net', 'Send exactly 2 pings to example.com.', 'ping -c 2 example.com', all(ran('ping'), out(/2 packets transmitted/))),

    D('tar', 'remote', 'Pack the Documents folder into an archive called docs.tar.gz.', 'tar -czf docs.tar.gz Documents', exists('~/docs.tar.gz')),

    D('git-init', 'git1', 'Start a git repository in the folder projects/website.', 'cd projects/website && git init', cmd((ev, sh) => !!node(sh, '~/projects/website/.git')?.repo)),
  ];
}
