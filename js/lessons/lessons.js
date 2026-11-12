// The course: 12 tracks of guided lessons.
//
// buildCourse(os) returns [{ id, title, lessons: [lesson] }] where a lesson is
//   { id, title, intro: [paragraph], setup?(sh), steps: [step] }
// and a step is
//   { say, sol, check(ev), done, hint?, copy? }
//     say   what to do            sol    one way to do it (shown as the last hint)
//     check passes when done      done   what the learner should take away
//     copy  a long command offered with a Copy button
//
// Text uses a tiny markup: `code`, **bold**, [[Key]].

import { ran, tried, cmd, line, out, failed, cwd, exists, gone, isDir, isLink, fileHas, key, vi, nano, all, any, has, arg, flags, node, lnode, quiet } from './checks.js';
import { installedPkgs } from '../shell/packages.js';

const S = (say, sol, check, done = '', extra = {}) => ({ say, sol, check, done, ...extra });
const repoAt = (sh, dir) => node(sh, dir + '/.git')?.repo || null;
const tree = (repo, branch = repo.head) => (repo.branches[branch] ? repo.commits[repo.branches[branch]].tree : {});

export function buildCourse(os) {
  const mac = os === 'mac';
  const home = mac ? '/Users/you' : '/home/you';
  const rc = mac ? '~/.zshrc' : '~/.bashrc';
  const shell = mac ? 'zsh' : 'bash';
  const install = mac ? 'brew install' : 'sudo apt install';
  const sys = mac ? 'macOS' : 'Linux';
  const paste = mac ? '[[Cmd+V]]' : '[[Ctrl+Shift+V]]';
  const installed = k => ev => ev.type === 'cmd' && !!installedPkgs(ev.sh.fs)[k];
  const fd = mac ? 'fd' : 'fdfind';
  const bat = mac ? 'bat' : 'batcat';

  const first = {
    id: 'first', title: 'First steps',
    lessons: [
      {
        id: 'look', title: 'Looking around: pwd and ls',
        intro: [
          `This terminal is a **simulation**. It imitates a ${sys} computer with a made-up user called \`you\` and made-up files. The folder names look familiar because every ${mac ? 'Mac' : 'Linux system'} has them, but nothing here is connected to your real computer, so you can create, overwrite and delete freely.`,
          'The terminal always has a **current folder**, just like a file manager window shows one folder at a time. The text in front of the cursor is the **prompt**. It shows who you are, on which computer, and which folder you are in.',
          'A command is a word, optionally followed by **options** (they start with `-`) and **arguments** (what to work on). You type it and press [[Enter]].',
        ],
        steps: [
          S('Ask the terminal which folder you are in. Type `pwd` and press [[Enter]].', 'pwd', ran('pwd'), `\`pwd\` means *print working directory*. \`${home}\` is your **home folder**, where your personal files live. Its short name is \`~\`.`),
          S('List what is in this folder with `ls`.', 'ls', ran('ls'), '`ls` lists the contents of the folder. Plain `ls` does not tell you which names are folders and which are files.'),
          S('Add the option `-l` for a detailed ("long") list: `ls -l`.', 'ls -l', ran('ls', has('l')), 'One line per item. A leading `d` marks a folder (directory), `-` a file. Then come the permissions, owner, group, size in bytes, date of the last change, and the name.', { hint: 'Type `ls`, a space, then `-l` (a lowercase L).' }),
          S('Some files are hidden. Show them too with `ls -a`.', 'ls -a', ran('ls', a => /[aA]/.test(flags(a))), 'Names that start with a dot are hidden; they are mostly settings. `.` stands for *this folder* and `..` for *the folder above*.'),
          S('Options can be combined. List everything in long format: `ls -la`.', 'ls -la', ran('ls', has('l', 'a')), '`-la`, `-al` and `-l -a` all mean the same.'),
          S('You can look into a folder without going there. List the contents of `Documents`.', 'ls Documents', ran('ls', arg(/^(\.\/|~\/)?Documents\/?$/)), 'The folder name is an **argument**: it tells `ls` what to list. Without one, ls lists the current folder.', { hint: 'Put the folder name after the command: `ls Documents`. Names are case-sensitive.' }),
          S('The screen is getting full. Clear it with `clear` (or press [[Ctrl+L]]).', 'clear', any(ran('clear'), key('ctrl-l')), 'Nothing is deleted. Only the view is cleaned up.'),
        ],
      },
      {
        id: 'move', title: 'Moving around: cd and paths',
        intro: [
          'You already know `cd`. This lesson adds what makes moving around quick: `..`, `~`, `-`, and the two kinds of paths.',
          'A **path** says where something is. It is **absolute** when it starts with `/` (counted from the top of the disk), and **relative** otherwise (counted from where you are now).',
        ],
        steps: [
          S('Go into the `Documents` folder.', 'cd Documents', cwd('~/Documents'), 'The prompt changed: it always shows where you are. `cd` prints nothing when it works.'),
          S('Check what is here with `ls`.', 'ls', ran('ls'), 'A good habit: after every `cd`, a quick `ls`.'),
          S('Go into the `recipes` folder.', 'cd recipes', cwd('~/Documents/recipes'), '`recipes` is a relative path: it is looked up inside the folder you are in.'),
          S('Go back up one level with `cd ..` (mind the space).', 'cd ..', all(ran('cd', arg(/^\.\.\/?$/)), cwd('~/Documents')), '`..` always means the folder above the current one. You can chain it: `cd ../..` goes up two levels.'),
          S('Jump straight to `projects/website` in your home folder, using the path `~/projects/website`.', 'cd ~/projects/website', cwd('~/projects/website'), '`~` stands for your home folder, so a path that starts with `~/` works from anywhere.'),
          S('Go home: type just `cd`, with nothing after it.', 'cd', all(ran('cd', a => !a.length || a[0] === '~' || /you\/?$/.test(a[0])), cwd('~')), '`cd` on its own always takes you home.'),
          S('Jump back to where you just were with `cd -`.', 'cd -', ran('cd', arg('-')), '`cd -` is the *back* button. It switches between your last two folders and prints where it went.'),
          S('Go to the very top of the filesystem with `cd /`.', 'cd /', cwd('/'), `\`/\` is the **root**. Everything on the computer lives below it: your home is \`${home}\`, programs are in \`/bin\` and \`/usr/bin\`, system settings in \`/etc\`.`),
          S('Look around with `ls`, then go back home.', 'cd', cwd('~'), `A path that starts with \`/\` is absolute: \`cd ${home}/Documents\` works no matter where you are.`, { hint: 'First `ls`, then `cd` on its own.' }),
        ],
      },
      {
        id: 'tab', title: 'Let the terminal type for you',
        intro: [
          'Nobody types full file names. The [[Tab]] key completes them, and the arrow keys bring back earlier commands. Using both from day one makes you faster and prevents typos.',
        ],
        steps: [
          S('Type `cd Doc` and press [[Tab]] instead of finishing the word. Do not press Enter yet.', 'cd Doc, then Tab', key('tab', e => /^cd Documents\/$/.test(e.after)), 'The shell completed the name, because only one thing here starts with `Doc`. The `/` at the end shows that it is a folder.'),
          S('Now press [[Enter]] to run it.', 'Enter', cwd('~/Documents')),
          S(`Type \`cat n\` and press [[Tab]]${mac ? '' : ' twice'}. Two files start with \`n\`, so the shell cannot decide and shows the choices.`, mac ? 'cat n, then Tab' : 'cat n, then Tab, Tab', key('tab', e => e.listed), 'When several names match, Tab completes as far as it can and lists the candidates. Type one more letter and press Tab again.'),
          S('Type `o` so that the line reads `cat no`, press [[Tab]], then [[Enter]].', 'cat notes.txt', ran('cat', arg('notes.txt')), '`cat` printed the file. You typed 6 characters instead of 13, and a typo was impossible.'),
          S('Press [[↑]] (arrow up). The previous command comes back.', 'the ↑ key', key('up'), 'The shell remembers what you typed. [[↑]] and [[↓]] walk through this history.'),
          S('Press [[Ctrl+C]] to throw the line away without running it.', 'Ctrl+C', key('ctrl-c', e => !e.running), 'Ctrl+C cancels: an unfinished line, or a program that is running. It is the most important key to remember.'),
          S('Tab completes commands too. Type `who` and press [[Tab]], then [[Enter]].', 'whoami', ran('whoami'), '`whoami` prints your user name. Pressing Tab on an empty line lists every command there is.'),
        ],
      },
      {
        id: 'help', title: 'Getting help',
        intro: [
          'You do not need to memorise commands. You need to know how to look them up: the manual (`man`), the built-in help, and a few commands that tell you what a name means.',
        ],
        steps: [
          S('Open the manual page of `ls` with `man ls`. Scroll with [[Space]], then press [[q]] to quit.', 'man ls', ran('man', arg('ls')), 'Manual pages open in a pager called `less`. If a program ever seems stuck showing text with a `:` at the bottom, you are in less: press `q`.'),
          S(mac ? 'On Linux, most commands print a summary with `--help`. See what macOS does: `ls --help`.' : 'For a quick summary, most commands accept `--help`. Try `ls --help`.', 'ls --help', line(/^\s*ls\s+--help/), mac ? 'The tools built into macOS only answer with a terse usage line. On macOS, rely on `man`. Tools you install yourself (git, brew, curl …) do understand `--help`.' : '`--help` prints straight into the terminal. `man` gives the complete manual.'),
          S('Search the manuals for a keyword: `man -k copy`.', 'man -k copy', any(ran('man', arg('-k')), ran('apropos')), 'Useful when you know what you want to do but not what the command is called. `apropos copy` does the same.'),
          S('Where does a command live? Ask with `which ls`.', 'which ls', ran('which'), 'Commands are programs stored in folders such as `/bin`. The shell finds them through a list of folders called `PATH` (there is a lesson on that).'),
          S('`type` tells you what kind of thing a name is. Try `type cd`.', 'type cd', ran('type'), '`cd` is built into the shell itself. `type` also reveals aliases (nicknames for commands).'),
          S('This trainer has its own overview. Run `help`.', 'help', ran('help'), '`help` lists every command the trainer knows, by topic. The **Reference** button at the top shows the same, with examples you can try.'),
        ],
      },
    ],
  };

  const files = {
    id: 'files', title: 'Files and folders',
    lessons: [
      {
        id: 'create', title: 'Creating files and folders',
        intro: ['Time to make things: folders with `mkdir`, empty files with `touch`, and files with content using `echo` and the `>` sign.'],
        steps: [
          S('Create a folder called `practice`: `mkdir practice`.', 'mkdir practice', isDir('~/practice'), '`mkdir` means *make directory*. No output means it worked.'),
          S('Go into it.', 'cd practice', cwd('~/practice')),
          S('Create an empty file: `touch notes.txt`.', 'touch notes.txt', exists('~/practice/notes.txt'), '`touch` creates an empty file. If the file already exists, it only updates its date.'),
          S('`echo` prints text. Try `echo hello`.', 'echo hello', ran('echo'), '`echo` repeats what you give it. That sounds useless until you combine it with the next step.'),
          S('Send the text into a file instead of onto the screen: `echo hello > greeting.txt`.', 'echo hello > greeting.txt', fileHas('~/practice/greeting.txt', /hello/), '`>` **redirects** the output into a file. The file is created if needed, and **replaced** if it already exists.'),
          S('Print the file with `cat greeting.txt`.', 'cat greeting.txt', ran('cat', arg(/greeting\.txt$/)), '`cat` prints the contents of a file. (The name comes from con*cat*enate: it can join several files.)'),
          S('Add a second line with `>>`: `echo world >> greeting.txt`.', 'echo world >> greeting.txt', fileHas('~/practice/greeting.txt', /hello\n.*world/s), '`>>` **appends** to the end of the file. Remember: one `>` overwrites, two `>>` add.'),
          S('Create nested folders in one go: `mkdir -p projects/2026/reports`.', 'mkdir -p projects/2026/reports', isDir('~/practice/projects/2026/reports'), 'Without `-p`, mkdir refuses when the folders in between are missing. With `-p` it creates the whole path.'),
          S('See everything you created, including subfolders: `ls -R`.', 'ls -R', any(ran('ls', has('R')), ran('find'), ran('tree')), '`-R` means *recursive*: this folder and every folder inside it.'),
        ],
      },
      {
        id: 'copy', title: 'Copy, move, rename, delete',
        intro: ['Four commands do all the file management: `cp` copies, `mv` moves and renames, `rm` deletes, `rmdir` removes empty folders. A practice folder with a few files is ready for you.'],
        setup: async sh => {
          await quiet(sh, 'mkdir -p ~/practice/photos; cd ~/practice; echo "Draft report" > report.txt; echo "Old notes" > old.txt; echo img > photos/a.jpg; echo img > photos/b.jpg');
        },
        steps: [
          S('You are in `~/practice`. List it.', 'ls', ran('ls')),
          S('Copy `report.txt` to a new file called `report-backup.txt`.', 'cp report.txt report-backup.txt', all(exists('~/practice/report-backup.txt'), exists('~/practice/report.txt')), 'The pattern is `cp SOURCE DESTINATION`. The original stays where it is.'),
          S('Rename `old.txt` to `archive.txt` with `mv`.', 'mv old.txt archive.txt', all(gone('~/practice/old.txt'), any(exists('~/practice/archive.txt'), exists('~/practice/docs/archive.txt'))), 'There is no separate rename command: moving a file to a new name *is* renaming it.'),
          S('Create a folder `docs` and move `archive.txt` into it.', 'mkdir docs && mv archive.txt docs/', all(exists('~/practice/docs/archive.txt'), gone('~/practice/archive.txt')), 'When the destination is an existing folder, `mv` puts the file inside it.', { hint: 'Two commands: `mkdir docs`, then `mv archive.txt docs/`.' }),
          S('Copy the whole `photos` folder to `photos-backup`. Folders need the option `-r`.', 'cp -r photos photos-backup', exists('~/practice/photos-backup/a.jpg'), '`-r` means *recursive*: the folder and everything inside it.'),
          S('Delete `report-backup.txt` with `rm`.', 'rm report-backup.txt', gone('~/practice/report-backup.txt'), '**There is no trash.** `rm` deletes immediately and permanently.'),
          S('Delete the folder `photos-backup` with everything in it: `rm -r photos-backup`.', 'rm -r photos-backup', gone('~/practice/photos-backup'), 'Read every `rm -r` twice before you press Enter. `rm -ri` asks before each file.'),
          S('Create an empty folder `tmp`, then remove it again with `rmdir tmp`.', 'mkdir tmp && rmdir tmp', ran('rmdir', arg(/^tmp\/?$/)), '`rmdir` only removes empty folders, which makes it the safe choice.', { hint: 'First `mkdir tmp`, then `rmdir tmp`.' }),
        ],
      },
      {
        id: 'read', title: 'Reading files',
        intro: ['Different tools for different sizes: `cat` for short files, `head` and `tail` for the beginning and the end, `less` for comfortable reading, `wc` for counting.'],
        setup: sh => quiet(sh, 'cd ~/Documents'),
        steps: [
          S('You are in `Documents`. Print `notes.txt`.', 'cat notes.txt', ran('cat', arg(/notes\.txt$/))),
          S('`report.md` is long. Count its lines first: `wc -l report.md`.', 'wc -l report.md', ran('wc', has('l')), '`wc` means *word count*. `-l` counts lines, `-w` words, `-c` bytes.'),
          S('Show only the beginning: `head report.md`.', 'head report.md', ran('head'), '`head` shows the first 10 lines. `head -n 3` shows 3.'),
          S('Show the last 5 lines: `tail -n 5 report.md`.', 'tail -n 5 report.md', ran('tail', a => a.join(' ').includes('5')), '`tail` is perfect for log files, where the newest entries are at the end. `tail -f` keeps watching a file (stop with Ctrl+C).'),
          S('Read the whole file comfortably: `less report.md`. Scroll with [[Space]] and [[b]], search with `/Risks` and [[Enter]], quit with [[q]].', 'less report.md', ran(['less', 'more']), '`less` shows one screen at a time instead of flooding the terminal. Remember `q`.'),
          S('`cat` can print several files after each other: `cat notes.txt todo.txt`.', 'cat notes.txt todo.txt', ran('cat', a => a.filter(x => !x.startsWith('-')).length >= 2)),
          S('Number the lines: `cat -n todo.txt`.', 'cat -n todo.txt', ran('cat', has('n')), 'Options change how a command behaves; `man cat` lists them all.'),
        ],
      },
      {
        id: 'wild', title: 'Wildcards and quotes',
        intro: ['Wildcards let one command work on many files. Quotes are how you deal with spaces and special characters. Both are handled by the shell before the command even starts.'],
        setup: sh => quiet(sh, 'cd ~/Downloads'),
        steps: [
          S('You are in `Downloads`. List only the photos: `ls *.jpg`.', 'ls *.jpg', all(line(/\*/), ran('ls', arg(/\.jpg$/))), '`*` matches any run of characters. The **shell** replaces `*.jpg` with the matching names; `ls` never sees the star.'),
          S('See what the shell makes of a pattern: `echo *.txt`.', 'echo *.txt', all(line(/\*/), ran('echo')), '`echo` just prints its arguments, so it shows what a pattern expands to. A good way to test a pattern before using it with `rm`.'),
          S('`?` matches exactly one character. Try `ls IMG_000?.jpg`.', 'ls IMG_000?.jpg', all(line(/\?/), ran('ls'))),
          S('Create a folder `photos` and move all `.jpg` files into it with a single `mv`.', 'mkdir photos && mv *.jpg photos/', all(exists('~/Downloads/photos/IMG_0001.jpg'), exists('~/Downloads/photos/IMG_0003.jpg')), 'One short command moved three files. It works the same for three thousand.', { hint: 'First `mkdir photos`, then `mv *.jpg photos/`.' }),
          S('There is a folder called `My Summer Trip`. Try to enter it the naive way: `cd My Summer Trip`.', 'cd My Summer Trip', line(/^\s*cd\s+My\s+Summer\s+Trip\s*$/), 'The shell splits a command at spaces, so `cd` received three separate words.'),
          S('Now do it right: `cd "My Summer Trip"`. Or type `cd My` and press [[Tab]].', 'cd "My Summer Trip"', cwd('~/Downloads/My Summer Trip'), 'Quotes keep words together. Tab writes it as `My\\ Summer\\ Trip`: a backslash in front of each space does the same job.'),
          S('Print the notes of the first day: `cat "day 1.txt"`.', 'cat "day 1.txt"', ran('cat', arg('day 1.txt'))),
          S('The two kinds of quotes differ. Run `echo "Home: $HOME"` and then `echo \'Home: $HOME\'`.', "echo 'Home: $HOME'", ran('echo', arg('Home: $HOME')), 'Inside double quotes, `$NAME` is replaced by the value of the variable. Single quotes keep everything exactly as typed.', { hint: 'Run the version with double quotes first, then the one with single quotes.' }),
        ],
      },
      {
        id: 'links', title: 'Links: one file, several paths',
        intro: [
          'A **symbolic link** (symlink) is a tiny file that points to another path, like a shortcut. Whoever opens the link gets the target instead. That lets one file or folder appear in several places without copying it.',
          'Links are everywhere: installers link programs into folders on your `PATH`, and tools link configuration files into place. They are created with `ln -s`.',
        ],
        steps: [
          S('Create a link called `site` that points to your website folder: `ln -s ~/projects/website site`.', 'ln -s ~/projects/website site', isLink('~/site'), 'The order is the same as for `cp`: first what exists, then the new name. `-s` makes it a symbolic link.'),
          S('Look at it with `ls -l`.', 'ls -l', ran('ls', has('l')), 'The line starts with `l`, and the arrow shows where the link points: `site -> …`.'),
          S('Go through the link: `cd site`. Then look around with `ls`.', 'cd site', cwd('~/site'), 'You are in the website folder. The link is simply a second path that leads there.', { hint: 'First `cd site`, then `ls`.' }),
          S('`pwd` shows the path you took. Ask for the real location with `pwd -P`.', 'pwd -P', ran('pwd', has('P')), '`-P` means *physical*: the path with every link resolved.'),
          S('Go home with `cd`. Then link a single file: `ln -s Documents/notes.txt quicknotes`.', 'cd; ln -s Documents/notes.txt quicknotes', isLink('~/quicknotes'), '', { hint: 'Two commands: `cd`, then `ln -s Documents/notes.txt quicknotes`.' }),
          S('Read the file through the link: `cat quicknotes`.', 'cat quicknotes', ran('cat', arg('quicknotes'))),
          S('Write through the link: `echo "- butter" >> quicknotes`. Then look at the original: `cat Documents/notes.txt`.', 'echo "- butter" >> quicknotes; cat Documents/notes.txt', all(ran('cat', arg(/Documents\/notes\.txt$/)), fileHas('~/Documents/notes.txt', /butter/)), 'The change landed in the original. There is only one file; the link is a second name for it.', { hint: 'Two commands: the `echo … >> quicknotes` line, then `cat Documents/notes.txt`.' }),
          S('Ask where a link points: `readlink quicknotes`.', 'readlink quicknotes', ran('readlink')),
          S('Delete the link with `rm quicknotes`, then check that the original is still there: `ls Documents`.', 'rm quicknotes; ls Documents', all(ran('ls'), cmd((ev, sh) => !lnode(sh, '~/quicknotes') && !!node(sh, '~/Documents/notes.txt'))), 'Removing a link never touches its target.', { hint: 'Two commands: `rm quicknotes`, then `ls Documents`.' }),
          S('The other direction is different. Create a file and a link to it: `touch draft.txt`, then `ln -s draft.txt latest`. Now delete the file: `rm draft.txt`.', 'touch draft.txt; ln -s draft.txt latest; rm draft.txt', cmd((ev, sh) => lnode(sh, '~/latest')?.t === 'l' && !node(sh, '~/latest')), 'The link is still there, but it points to nothing now: a **broken link**.', { hint: 'Three commands: `touch draft.txt`, `ln -s draft.txt latest`, `rm draft.txt`.' }),
          S('Try to read it: `cat latest`.', 'cat latest', all(failed('ENOENT'), line(/latest/)), '"No such file or directory", although `ls` shows the name. When that happens, `ls -l` reveals where the link points.'),
          S('Now the most common real-world use: making a program runnable from anywhere. First make the script executable: `chmod +x projects/scripts/hello.sh`.', 'chmod +x projects/scripts/hello.sh', cmd((ev, sh) => !!(node(sh, '~/projects/scripts/hello.sh')?.mode & 0o100))),
          S('Link it into `/usr/local/bin`, a folder that is on your `PATH`. It belongs to the system, so this needs sudo: `sudo ln -s ~/projects/scripts/hello.sh /usr/local/bin/hello`.', 'sudo ln -s ~/projects/scripts/hello.sh /usr/local/bin/hello', isLink('/usr/local/bin/hello'), 'Give the target as a full path (or with `~`) here. A relative target is looked up from the folder the link is in, not from where you are standing.'),
          S('Run it by name: `hello`.', 'hello', cmd(ev => /^\s*hello\s*$/.test(ev.line) && ev.exit === 0), 'This is what installation guides mean by "link it into your PATH". `which hello` shows the link, and `ls -l /usr/local/bin` shows where it leads.'),
        ],
      },
    ],
  };

  const faster = {
    id: 'faster', title: 'Working faster',
    lessons: [
      {
        id: 'keys', title: 'Keyboard shortcuts',
        intro: ['The command line has its own editing keys. A handful of them saves you an enormous amount of arrow-key pressing. They work in almost every terminal program.'],
        steps: [
          S('Type this, without pressing Enter: `echo one two three`. Then press [[Ctrl+A]].', 'Ctrl+A', key('ctrl-a', e => e.line.length > 5), 'Ctrl+A jumps to the start of the line. (A = the first letter of the alphabet.)'),
          S('Press [[Ctrl+E]] to jump back to the end.', 'Ctrl+E', key('ctrl-e'), 'Ctrl+E: End. Much faster than holding an arrow key.'),
          S('Press [[Ctrl+W]] to delete the last word.', 'Ctrl+W', key('ctrl-w', e => e.after.length < e.line.length), 'Ctrl+W deletes one word backwards.'),
          S('Press [[Ctrl+U]] to clear the line.', 'Ctrl+U', key('ctrl-u'), mac ? 'In zsh, Ctrl+U clears the whole line. Ctrl+K deletes from the cursor to the end. Ctrl+Y pastes back what was deleted.' : 'In bash, Ctrl+U deletes from the cursor back to the start, Ctrl+K from the cursor to the end. Ctrl+Y pastes back what was deleted.'),
          S('Run `sleep 30`. It does nothing for 30 seconds. Do not wait: stop it with [[Ctrl+C]].', 'sleep 30, then Ctrl+C', cmd(ev => /sleep/.test(ev.line) && ev.exit === 130), 'Ctrl+C interrupts whatever is running in the foreground.'),
          S('Run `ls Documents`, then `pwd`.', 'ls Documents, then pwd', ran('pwd'), 'These two are now in your history, ready for the next step.', { hint: 'Two commands, one after the other.' }),
          S('Press [[Ctrl+R]] and type `Doc`. The shell searches your history as you type. Press [[Enter]] to run the match.', 'Ctrl+R, Doc, Enter', key('search-accept'), 'Ctrl+R is the fastest way to repeat a long command from earlier. Pressing Ctrl+R again steps to older matches.'),
          S('Run the previous command once more by typing `!!`.', '!!', cmd(ev => ev.bang), '`!!` stands for the whole previous command. Its classic use is `sudo !!`, for when you forgot sudo.'),
          S('Look at your history: `history`.', 'history', ran('history'), 'Every line has a number. `history | grep cp` finds old commands.'),
          S('Finally, clear the screen with [[Ctrl+L]].', 'Ctrl+L', key('ctrl-l'), 'All of these shortcuts are listed in the Reference panel under *Shortcuts*.'),
        ],
      },
    ],
  };

  const pipes = {
    id: 'pipes', title: 'Redirection and pipes',
    lessons: [
      {
        id: 'redirect', title: 'Sending output into files',
        intro: ['Every command has an output channel that normally goes to the screen. With `>`, `>>` and `<` you connect it to files instead. This is also how you create and overwrite files from the command line.'],
        setup: sh => quiet(sh, 'cd ~/Documents'),
        steps: [
          S('You are in `Documents`. Save a listing to a file: `ls -l > listing.txt`.', 'ls -l > listing.txt', fileHas('~/Documents/listing.txt', /notes\.txt/), 'Nothing appeared on screen, because the output went into the file.'),
          S('Look at it: `cat listing.txt`.', 'cat listing.txt', ran('cat', arg(/listing\.txt$/))),
          S('Careful, `>` overwrites. Run `echo oops > listing.txt`.', 'echo oops > listing.txt', fileHas('~/Documents/listing.txt', /^oops\n$/), 'The listing is gone. `>` always starts with an empty file.'),
          S('Append instead: `echo "second line" >> listing.txt`.', 'echo "second line" >> listing.txt', fileHas('~/Documents/listing.txt', /oops\nsecond line/), '`>>` adds to the end and keeps what is there.'),
          S('Error messages travel on a separate channel. Run `ls nothere > out.txt` and notice that the error still shows up on screen.', 'ls nothere > out.txt', all(line(/nothere\s*>/), exists('~/Documents/out.txt')), '`>` only catches normal output ("stdout"). Errors use a second channel ("stderr").'),
          S('Catch the error channel with `2>`: `ls nothere 2> errors.txt`.', 'ls nothere 2> errors.txt', fileHas('~/Documents/errors.txt', /nothere/), '`2>` redirects errors. `2> /dev/null` throws them away: `/dev/null` is a bin that swallows everything.'),
          S('`<` feeds a file into a command as its input: `wc -l < todo.txt`.', 'wc -l < todo.txt', all(line(/</), ran('wc')), 'Most commands that accept a file name can also read from their input. That is what makes pipes possible; they come next.'),
          S('Clean up: remove `listing.txt`, `out.txt` and `errors.txt` with one `rm`.', 'rm listing.txt out.txt errors.txt', all(gone('~/Documents/listing.txt'), gone('~/Documents/out.txt'), gone('~/Documents/errors.txt'))),
        ],
      },
      {
        id: 'pipe', title: 'Pipes: connecting commands',
        intro: [
          'The pipe `|` takes the output of the command on its left and feeds it to the command on its right. Small tools that each do one thing, combined into something powerful: this is the central idea of the command line.',
          'You are in `~/projects/logs`, with two log files of a pretend web server.',
        ],
        setup: sh => quiet(sh, 'cd ~/projects/logs'),
        steps: [
          S('Count the entries in your home folder: `ls ~ | wc -l`.', 'ls ~ | wc -l', all(line(/\|/), ran('ls'), ran('wc', has('l'))), '`ls` produced the list, `wc -l` counted its lines.'),
          S('`grep` keeps only the lines that contain a text. Show the errors: `grep ERROR server.log`.', 'grep ERROR server.log', ran('grep', arg('ERROR')), '`grep PATTERN FILE` prints matching lines. It is case-sensitive unless you add `-i`.'),
          S('How many errors are there? Pipe grep into `wc -l`.', 'grep ERROR server.log | wc -l', any(all(line(/\|/), ran('grep', arg('ERROR')), ran('wc', has('l'))), ran('grep', all(has('c'), arg('ERROR')))), 'Five. (`grep -c ERROR server.log` counts as well.)'),
          S('`access.log` has one visitor per line. Show only the first column: `cut -d" " -f1 access.log`.', 'cut -d" " -f1 access.log', all(any(ran('cut'), ran('awk')), out(/^(\d+\.\d+\.\d+\.\d+\n)+$/)), '`cut` picks columns: `-d` sets the separator (here a space), `-f` the column number.'),
          S('Sort those addresses: add `| sort` to the command (press [[↑]] to get it back).', 'cut -d" " -f1 access.log | sort', all(line(/\|/), ran('sort'), out(/^(\d+\.\d+\.\d+\.\d+\n)+$/)), 'Identical addresses now stand next to each other.'),
          S('Count how often each address appears: add `| uniq -c`.', 'cut -d" " -f1 access.log | sort | uniq -c', all(ran('sort'), ran('uniq', has('c'))), '`uniq` merges identical neighbouring lines, which is why you sort first. `-c` adds the count.'),
          S('Rank them, busiest first: add `| sort -rn`.', 'cut -d" " -f1 access.log | sort | uniq -c | sort -rn', all(ran('uniq', has('c')), ran('sort', has('r', 'n'))), 'Four tiny tools, one answer. `sort | uniq -c | sort -rn` is a classic you will use for the rest of your life.'),
          S('Show only the top two: add `| head -n 2`.', 'cut -d" " -f1 access.log | sort | uniq -c | sort -rn | head -n 2', all(ran('uniq'), ran('head'))),
          S('`tee` saves output to a file and shows it at the same time: `grep ERROR server.log | tee errors.txt`.', 'grep ERROR server.log | tee errors.txt', all(ran('tee'), fileHas('~/projects/logs/errors.txt', /ERROR/)), 'Like a T-piece in a water pipe: the data flows on, and a copy goes into the file.'),
        ],
      },
      {
        id: 'find', title: 'Finding files and text',
        intro: ['Two different searches: `find` looks for files by name or type, `grep` looks for text inside files.'],
        steps: [
          S('Find every `.txt` file below the current folder: `find . -name "*.txt"`.', 'find . -name "*.txt"', ran('find', all(arg('-name'), arg('*.txt'))), 'The pattern is `find WHERE TESTS`. Quote the pattern, so that `find` receives it and not the shell.'),
          S('Find only folders, by name: `find . -type d -name recipes`.', 'find . -type d -name recipes', ran('find', all(arg('-type'), arg('d'))), '`-type d` means directories, `-type f` regular files.'),
          S('Now search inside files. Which files in `projects` mention TODO? `grep -r TODO projects`.', 'grep -r TODO projects', ran('grep', all(has('r'), arg('TODO'))), '`-r` searches every file below the folder. Each hit shows the file name and the line.'),
          S('Add line numbers and ignore upper/lower case: `grep -rni todo projects`.', 'grep -rni todo projects', ran('grep', has('r', 'n', 'i'))),
          S('Only the names of the files: `grep -rl TODO projects`.', 'grep -rl TODO projects', ran('grep', has('r', 'l'))),
          S('Turn a search around with `-v`. Show the lines of `Documents/todo.txt` that are not done yet: `grep -v DONE Documents/todo.txt`.', 'grep -v DONE Documents/todo.txt', ran('grep', has('v')), '`-v` inverts the match: every line that does **not** contain the pattern.'),
          S('Combine both worlds. Count all files below `Documents`: `find Documents -type f | wc -l`.', 'find Documents -type f | wc -l', all(ran('find', arg('f')), ran('wc'))),
        ],
      },
      {
        id: 'sedawk', title: 'A taste of sort, sed and awk',
        intro: ['Three tools for working with structured text such as CSV files. You are in `Downloads`, where `data.csv` holds names, cities, ages and salaries.'],
        setup: sh => quiet(sh, 'cd ~/Downloads'),
        steps: [
          S('Look at the file: `cat data.csv`.', 'cat data.csv', line(/data\.csv/)),
          S('Sort it by the third column (age), numerically: `sort -t, -k3 -n data.csv`.', 'sort -t, -k3 -n data.csv', all(ran('sort', a => /k\s*3/.test(a.join(' ')) && flags(a).includes('n')), out(/Felix.*\nClara/)), '`-t,` says the columns are separated by commas, `-k3` picks the third, `-n` compares as numbers.'),
          S('`sed` edits text as it flows past. Replace a word: `sed \'s/Berlin/Potsdam/\' data.csv`.', "sed 's/Berlin/Potsdam/' data.csv", all(ran('sed'), out(/Anna,(?!Berlin)\w/)), '`s/old/new/` substitutes. The file itself is unchanged: sed prints the result. Add `g` (`s/old/new/g`) to replace every match in a line.'),
          S('Print only lines 2 to 4: `sed -n \'2,4p\' data.csv`.', "sed -n '2,4p' data.csv", all(ran('sed'), out(/^Anna.*\nBen.*\nClara.*\n$/)), '`-n` silences the normal output, `2,4p` prints lines 2 to 4.'),
          S('`awk` thinks in columns. Print names and cities: `awk -F, \'{print $1, $2}\' data.csv`.', "awk -F, '{print $1, $2}' data.csv", all(ran('awk'), out(/Anna Berlin/)), '`-F,` sets the separator. `$1`, `$2` … are the columns, `$0` is the whole line.'),
          S('Filter rows with a condition. Who is older than 40? `awk -F, \'$3 > 40\' data.csv`.', "awk -F, '$3 > 40' data.csv", all(ran('awk'), out(/Ben/), cmd(ev => !/Anna/.test(ev.out)))),
          S('Add up a column: `awk -F, \'NR > 1 {sum += $4} END {print sum}\' data.csv`.', "awk -F, 'NR > 1 {sum += $4} END {print sum}' data.csv", out(/^450000\n$/), '`NR > 1` skips the header line (NR = line number). `END` runs after the last line.'),
          S(mac ? 'Change the file itself with `-i`. On macOS it needs an empty argument: `sed -i \'\' \'s/Felix/Fritz/\' data.csv`.' : 'Change the file itself with `-i`: `sed -i \'s/Felix/Fritz/\' data.csv`.', mac ? "sed -i '' 's/Felix/Fritz/' data.csv" : "sed -i 's/Felix/Fritz/' data.csv", fileHas('~/Downloads/data.csv', /Fritz/), mac ? 'On macOS, `-i` requires a backup suffix (here: the empty one, `\'\'`). On Linux it is just `-i`. This difference trips up everyone.' : 'On Linux, `-i` edits in place. On macOS you would write `sed -i \'\' …`. This difference trips up everyone.'),
        ],
      },
    ],
  };

  const editors = {
    id: 'editors', title: 'Editors: nano and vi',
    lessons: [
      {
        id: 'nano', title: 'nano: the easy editor',
        intro: ['Sooner or later you need to change a file in the terminal. `nano` is the friendly option: you simply type, and the shortcuts are listed at the bottom of the screen.'],
        setup: sh => quiet(sh, 'cd ~/Documents'),
        steps: [
          S('Open a new file with `nano shopping.txt` and type a line, for example `apples`.', 'nano shopping.txt', nano(null, n => n.text.trim().length >= 3), 'In nano you just type. The two lines at the bottom list the shortcuts; `^` stands for the Ctrl key.'),
          S('Save with [[Ctrl+O]] ("write out"), then confirm the file name with [[Enter]].', 'Ctrl+O, Enter', nano('write')),
          S('Leave nano with [[Ctrl+X]].', 'Ctrl+X', nano('quit')),
          S('Check the result: `cat shopping.txt`.', 'cat shopping.txt', ran('cat', arg(/shopping\.txt$/))),
          S('Open the file again, add a second line, and leave with [[Ctrl+X]]. nano asks whether to save: answer [[Y]], then [[Enter]].', 'nano shopping.txt', nano('quit', (n, ev) => (node(ev.sh, '~/Documents/shopping.txt')?.data.trim().split('\n').length || 0) >= 2), 'That is all you need for quick edits. Next comes the editor that is installed on every server: vi.', { hint: 'After Ctrl+X, nano asks "Save modified buffer?". Press Y, then Enter to confirm the name.' }),
        ],
      },
      {
        id: 'vi1', title: 'vi: surviving it',
        intro: [
          'vi (and its modern version, vim) exists on practically every Mac, Linux machine and server. It is **modal**: keys mean different things depending on the mode. In **Normal mode** keys are commands. In **Insert mode** keys type text.',
          'vi starts in Normal mode, which is why typing seems to do random things at first. The strip under the editor always shows the current mode and the most useful keys.',
        ],
        setup: sh => quiet(sh, 'cd ~/Documents'),
        steps: [
          S('Open `notes.txt` in vi: `vi notes.txt`.', 'vi notes.txt', vi('open'), 'You are in **Normal mode**. The bottom line shows the file name and its size.'),
          S('Press [[i]] to enter Insert mode.', 'i', vi('mode', v => v.mode === 'insert'), 'The bottom line now says `-- INSERT --`. Everything you type goes into the file.'),
          S('Type a few words, then press [[Esc]] to return to Normal mode.', 'type, then Esc', vi('mode', (v, ev) => v.mode === 'normal' && ev.from === 'insert' && v.dirty), '[[Esc]] always brings you back to Normal mode. When in doubt, press Esc.'),
          S('Save: type `:w` and press [[Enter]].', ':w', vi('write'), '`:` opens a command line at the bottom. `:w` writes (saves) the file.'),
          S('Quit: type `:q` and press [[Enter]].', ':q', vi('quit')),
          S('Open the file again, change something, and try to quit with `:q` without saving.', 'vi notes.txt, i, type, Esc, :q', vi('error', (v, ev) => ev.code === 'E37'), 'vi refuses, to protect your changes: *E37: No write since last change*.', { hint: '`vi notes.txt`, press `i`, type something, press Esc, then `:q` and Enter.' }),
          S('Throw the changes away and quit with `:q!`.', ':q!', vi('quit', (v, ev) => !ev.saved), 'The four commands to remember: `:w` save, `:q` quit, `:wq` save and quit, `:q!` quit without saving.'),
          S('Once more, for real: open `todo.txt`, add a line at the end, and leave with `:wq`.', 'vi todo.txt, G, o, type, Esc, :wq', vi('quit', (v, ev) => ev.saved && /todo\.txt$/.test(v.name) && v.lines.length > 6), 'You can now edit any file on any server. Everything else in vi is about doing it faster.', { hint: '`vi todo.txt`, then `G` (go to the last line), `o` (open a new line below and start typing), type your text, Esc, `:wq`.' }),
        ],
      },
      {
        id: 'vi2', title: 'vi: moving around',
        intro: ['In Normal mode, the keyboard becomes a set of movement keys. You rarely need the mouse or even the arrow keys. `report.md` is a good file to practise on.'],
        setup: sh => quiet(sh, 'cd ~/Documents'),
        steps: [
          S('Open `report.md` in vi.', 'vi report.md', vi('open', v => /report\.md$/.test(v.name))),
          S('Move with [[j]] (down), [[k]] (up), [[h]] (left) and [[l]] (right). Go down at least 3 lines.', 'j j j', vi('key', v => v.cy >= 3), 'The arrow keys work too, but hjkl keep your fingers where they are. `j` looks a bit like an arrow pointing down.'),
          S('Numbers repeat a command. Type `5j` to move five lines down.', '5j', vi('key', (v, ev) => /^\d+j$/.test(ev.keys)), 'Almost every vi command accepts a count in front.'),
          S('Jump to the last line with [[G]] (capital G).', 'G', vi('key', v => v.cy === v.lines.length - 1)),
          S('Jump back to the first line with [[g]][[g]].', 'gg', vi('key', (v, ev) => v.cy === 0 && /gg$/.test(ev.keys))),
          S('Go to line 10: type `:10` and [[Enter]] (or `10G`).', ':10', vi(null, v => v.cy === 9 && v.mode === 'normal')),
          S('Move forward word by word with [[w]] (a few times), and back with [[b]].', 'w w w', vi('key', (v, ev) => ev.key === 'w' && v.cx >= 8), '`w` jumps to the next word, `b` back, `e` to the end of the word.'),
          S('Jump to the end of the line with [[$]].', '$', vi('key', (v, ev) => ev.key === '$')),
          S('And to its start with [[0]] (zero).', '0', vi('key', (v, ev) => ev.key === '0' && v.cx === 0)),
          S('Search: type `/Risks` and press [[Enter]].', '/Risks', vi('search', (v, ev) => /risks/i.test(ev.pat)), 'The cursor jumps to the first match after its position.'),
          S('Press [[n]] for the next match.', 'n', vi('key', (v, ev) => ev.key === 'n'), '`n` repeats the search forwards, `N` backwards. The search wraps around at the end of the file.'),
          S('Scroll a page with [[Ctrl+F]] (forward), then quit with `:q`.', ':q', vi('quit'), 'All movement keys are in the Reference panel, under *vi*.'),
        ],
      },
      {
        id: 'vi3', title: 'vi: editing text',
        intro: [
          'vi\'s editing commands combine an **operator** (what to do) with a **movement** (how far): `d` delete + `w` word = `dw`. A doubled operator works on the whole line: `dd`.',
          'The practice file `draft.txt` contains a few mistakes to fix.',
        ],
        setup: async sh => {
          sh.fs.write(`${sh.home}/Documents/draft.txt`, 'Meeting notes\n- Anna: prepare the budgget\n- Ben: book the the room\n- DELETE THIS LINE\n- Clara: send invitations\n- Hugo: order lunch\n', sh.user);
          await quiet(sh, 'cd ~/Documents');
        },
        steps: [
          S('Open `draft.txt` in vi.', 'vi draft.txt', vi('open', v => /draft\.txt$/.test(v.name))),
          S('In line 2, `budgget` has a `g` too many. Put the cursor on one of the two `g`s and press [[x]].', 'x', vi('key', v => v.lines.some(l => /prepare the budget$/.test(l))), '`x` deletes the character under the cursor.'),
          S('In line 3, "the" appears twice. Put the cursor on the first letter of one `the` and type [[d]][[w]].', 'dw', vi('key', v => v.lines.some(l => /book the room$/.test(l))), '`d` is the delete operator, `w` says how far: one word. `d$` deletes to the end of the line.'),
          S('Move to `DELETE THIS LINE` and press [[d]][[d]].', 'dd', vi('key', v => !v.lines.some(l => /DELETE THIS/.test(l))), '`dd` removes a whole line. `3dd` removes three.'),
          S('Maybe that line was important. Undo with [[u]].', 'u', vi('key', (v, ev) => ev.key === 'u' && v.lines.some(l => /DELETE THIS/.test(l))), '`u` undoes step by step. [[Ctrl+R]] redoes.'),
          S('Delete the line again with `dd`. It is now in vi\'s clipboard. Go to the last line with `G` and paste it below with [[p]].', 'dd, G, p', vi('key', (v, ev) => ev.key === 'p' && /DELETE THIS/.test(v.lines.at(-1))), 'Deleting in vi is really cutting: `dd` then `p` moves a line.'),
          S('Copy without deleting: go to the first line with `gg`, copy it with [[y]][[y]], and paste it with [[p]].', 'gg, yy, p', vi('key', v => v.lines.filter(l => l === 'Meeting notes').length >= 2), '`y` stands for *yank*, vi\'s word for copy. `yy` copies a line, `yw` a word.'),
          S('Change a word: put the cursor on `lunch`, type [[c]][[w]], type `dinner`, and press [[Esc]].', 'cw dinner Esc', vi(null, v => v.mode === 'normal' && v.lines.some(l => /order dinner/.test(l))), '`cw` (change word) deletes the word and switches to Insert mode in one step.'),
          S('Press [[o]] to open a new line below the cursor, type something, and press [[Esc]].', 'o, type, Esc', vi('mode', (v, ev) => ev.from === 'insert' && v.mode === 'normal' && v.lines.length >= 8), '`o` opens a line below, capital `O` above. `A` appends at the end of the line, `I` inserts at its start.'),
          S('Save and quit with `:wq`.', ':wq', vi('quit', (v, ev) => ev.saved)),
        ],
      },
      {
        id: 'vi4', title: 'vi: search, replace and options',
        intro: ['The last vi lesson: replacing text across a whole file, selecting text visually, repeating changes, and switching options on.'],
        setup: async sh => {
          sh.fs.write(`${sh.home}/Documents/config.txt`, '# Server settings\nhost = localhost\nport = 8080\ncolor = blue\ntheme_color = blue\ndebug = false\nadmin_color = blue\n', sh.user);
          await quiet(sh, 'cd ~/Documents');
        },
        steps: [
          S('Open `config.txt` in vi.', 'vi config.txt', vi('open', v => /config\.txt$/.test(v.name))),
          S('Turn on line numbers: `:set number`.', ':set number', vi(null, v => v.opt.number), '`:set nonumber` turns them off again. Options last until you quit; to keep them, people put them into the file `~/.vimrc`.'),
          S('Replace every `blue` with `green` in the whole file: `:%s/blue/green/g`.', ':%s/blue/green/g', vi(null, v => !v.lines.some(l => /blue/.test(l)) && v.lines.some(l => /green/.test(l))), '`%` means every line, `s/old/new/` substitutes, and the final `g` means every match in a line.'),
          S('Select text visually: go to line 4, press [[V]] (capital), extend the selection two lines down with [[j]][[j]], then press [[d]].', 'V j j d', vi('key', (v, ev) => ev.key === 'd' && /V/.test(ev.keys) && v.lines.length <= 5), '`V` selects whole lines, lowercase `v` single characters. Then `d` deletes, `y` copies, `>` indents.'),
          S('Bring the lines back with [[u]].', 'u', vi('key', (v, ev) => ev.key === 'u' && v.lines.length === 7)),
          S('Put the cursor on `8080`, type `cw9090` and press [[Esc]].', 'cw9090 Esc', vi(null, v => v.mode === 'normal' && v.lines.some(l => /port = 9090/.test(l)))),
          S('Now put the cursor on the word `false` and press [[.]] (the dot key).', '.', vi('key', (v, ev) => ev.key === '.'), 'The dot repeats your last change wherever the cursor is. Make a change once, then repeat it with a single key. (Here it wrote 9090 again; undo with `u` if you like.)'),
          S('Save and quit with `:wq`.', ':wq', vi('quit', (v, ev) => ev.saved), 'You know more vi than most people ever learn.'),
        ],
      },
    ],
  };

  const perms = {
    id: 'perms', title: 'Permissions',
    lessons: [
      {
        id: 'perm', title: 'Permissions and running scripts',
        intro: ['Every file records who may **r**ead it, **w**rite it and e**x**ecute (run) it. That is what the cryptic first column of `ls -l` is about, and why a script you just wrote will not run at first.'],
        setup: sh => quiet(sh, 'cd ~/projects/scripts'),
        steps: [
          S('You are in `~/projects/scripts`. List it in long format.', 'ls -l', ran('ls', has('l')), 'Look at the first column, for example `-rw-r--r--`. After the type letter come three groups of three letters: what the **owner**, the **group** and **everyone else** may do. `r` = read, `w` = write, `x` = execute.'),
          S('Print the script: `cat hello.sh`.', 'cat hello.sh', ran('cat', arg(/hello\.sh$/)), 'A script is a text file with commands. Its first line (`#!/bin/bash`) names the program that should run it.'),
          S('Try to run it: `./hello.sh`.', './hello.sh', cmd(ev => /^\s*\.\/hello\.sh/.test(ev.line) && ev.exit === 126), 'Permission denied: the file has no `x` permission. (`./` means "the file in this folder". The shell does not look for programs in the current folder by itself.)'),
          S('Make it executable: `chmod +x hello.sh`.', 'chmod +x hello.sh', cmd((ev, sh) => !!(node(sh, '~/projects/scripts/hello.sh')?.mode & 0o100)), '`chmod` changes the mode (the permissions). `+x` adds execute.'),
          S('Run it now: `./hello.sh`.', './hello.sh', cmd(ev => /hello\.sh/.test(ev.line) && ev.exit === 0 && /Hello from a script/.test(ev.out)), 'In `ls -l` the file now shows `-rwxr-xr-x`.'),
          S('Permissions can be taken away too. Remove your own write permission from `backup.sh`: `chmod u-w backup.sh`.', 'chmod u-w backup.sh', cmd((ev, sh) => { const n = node(sh, '~/projects/scripts/backup.sh'); return !!n && !(n.mode & 0o200); }), '`u` = the owner (user), `g` = group, `o` = others, `a` = all. `+` adds, `-` removes.'),
          S('Try to add a line to it: `echo test >> backup.sh`.', 'echo test >> backup.sh', failed('EACCES'), 'Even your own file is protected now. Only the owner can change the permissions back.'),
          S('Permissions are often written as numbers: r=4, w=2, x=1, added up for owner, group and others. Set `backup.sh` to `rwxr-xr-x` with `chmod 755 backup.sh`.', 'chmod 755 backup.sh', cmd((ev, sh) => node(sh, '~/projects/scripts/backup.sh')?.mode === 0o755), '7 = 4+2+1 (rwx), 5 = 4+1 (r-x). Common values: `644` for documents, `755` for programs and folders, `600` for private files.'),
        ],
      },
      {
        id: 'sudo', title: 'sudo: acting as administrator',
        intro: [
          'System files belong to the administrator account, `root`. As a normal user you may read most of them, but not change them. `sudo` runs a single command as root.',
          '**In this trainer, sudo accepts any password. Never type your real password here.**',
        ],
        steps: [
          S('Look at who owns a system file: `ls -l /etc/hosts`.', 'ls -l /etc/hosts', ran('ls', all(has('l'), arg(/\/etc\/hosts$/))), 'The owner is `root`. Everyone may read the file (the last `r--`), only root may write it.'),
          S('Try to add a line to it: `echo "127.0.0.1 mysite.test" >> /etc/hosts`.', 'echo "127.0.0.1 mysite.test" >> /etc/hosts', failed('EACCES'), 'Permission denied, as expected.'),
          S('`sudo` runs one command as root. Try `sudo whoami`. It asks for a password: type anything (nothing will appear) and press [[Enter]].', 'sudo whoami', all(ran('whoami'), out(/root/)), 'For that one command you were root. Use sudo only when a command really needs it.'),
          S('Edit the file as root: run `sudo vi /etc/hosts`, add the line `127.0.0.1 mysite.test` at the end, and save with `:wq`.', 'sudo vi /etc/hosts', fileHas('/etc/hosts', /mysite\.test/), 'Editing system files with `sudo vi` (or `sudo nano`) is everyday work on servers.', { hint: 'In vi: `G` (last line), `o` (new line below), type the text, Esc, `:wq`. Without an editor: `echo "127.0.0.1 mysite.test" | sudo tee -a /etc/hosts`.' }),
          S('Forgot sudo? Run `touch /etc/trainer.conf` (it fails), then repeat it with `sudo !!`.', 'sudo !!', exists('/etc/trainer.conf'), '`!!` is replaced by the previous command, so `sudo !!` means "again, as root".', { hint: 'First `touch /etc/trainer.conf`, then `sudo !!`.' }),
          S('See who owns the new file: `ls -l /etc/trainer.conf`.', 'ls -l /etc/trainer.conf', ran('ls', arg(/trainer\.conf$/)), 'Files created with sudo belong to root. That is why you should not use sudo inside your own home folder: you would lock yourself out of your own files.'),
          S('Clean up: `sudo rm /etc/trainer.conf`.', 'sudo rm /etc/trainer.conf', gone('/etc/trainer.conf')),
          S('Now the classic accident. Create a file in your own home folder with sudo: `sudo touch ~/oops.txt`. Then try to write to it: `echo hi > ~/oops.txt`.', 'sudo touch ~/oops.txt; echo hi > ~/oops.txt', all(failed('EACCES'), line(/oops/)), 'The file sits in your home folder, but it belongs to root, because sudo created it. You are locked out of your own file.', { hint: 'Two commands: `sudo touch ~/oops.txt`, then `echo hi > ~/oops.txt`.' }),
          S('Take it back with `chown` (change owner): `sudo chown you ~/oops.txt`.', 'sudo chown you ~/oops.txt', cmd((ev, sh) => node(sh, '~/oops.txt')?.owner === 'you'), 'The pattern is `chown OWNER FILE`. Changing owners always needs sudo. For a folder with everything inside: `sudo chown -R you FOLDER`.'),
          S('Check the owner with `ls -l ~/oops.txt`, then write to the file again: `echo hi > ~/oops.txt`.', 'echo hi > ~/oops.txt', fileHas('~/oops.txt', /hi/), '`chmod` changes what may be done with a file, `chown` changes whose file it is. Together they explain every "Permission denied".', { hint: 'First `ls -l ~/oops.txt`, then `echo hi > ~/oops.txt`.' }),
        ],
      },
    ],
  };

  const config = {
    id: 'config', title: 'Shell configuration',
    lessons: [
      {
        id: 'env', title: 'Variables and PATH',
        intro: ['The shell keeps settings in **variables**. The most important one, `PATH`, decides which programs the shell can find. Understanding it explains every "command not found".'],
        steps: [
          S('Print a variable: `echo $HOME`.', 'echo $HOME', ran('echo', arg(home)), 'A `$` in front of a name means "the value of". `HOME` holds the path of your home folder.'),
          S('Print the search path: `echo $PATH`.', 'echo $PATH', ran('echo', arg(/\/usr\/bin/)), '`PATH` is a list of folders separated by `:`. When you type a command, the shell looks through these folders, in this order, for a program with that name.'),
          S('Create your own variable, with no spaces around `=`: `GREETING=hello`. Then print it with `echo $GREETING`.', 'GREETING=hello; echo $GREETING', all(ran('echo', arg('hello')), cmd((ev, sh) => sh.env.GREETING === 'hello')), 'Spaces matter: `GREETING = hello` would try to run a command called GREETING.', { hint: 'Two commands: `GREETING=hello`, then `echo $GREETING`.' }),
          S('`export` makes a variable visible to the programs you start: `export EDITOR=vim`.', 'export EDITOR=vim', cmd((ev, sh) => sh.exported.has('EDITOR') && !!sh.env.EDITOR), 'Many programs read variables such as `EDITOR`. `env` lists everything that is exported.'),
          S('Now add a command of your own. Create the folder `~/bin` and copy the hello script into it as `hello`: `mkdir ~/bin`, then `cp ~/projects/scripts/hello.sh ~/bin/hello`.', 'mkdir ~/bin && cp ~/projects/scripts/hello.sh ~/bin/hello', exists('~/bin/hello'), '', { hint: 'Two commands: `mkdir ~/bin`, then `cp ~/projects/scripts/hello.sh ~/bin/hello`.' }),
          S('Make it executable: `chmod +x ~/bin/hello`.', 'chmod +x ~/bin/hello', cmd((ev, sh) => !!(node(sh, '~/bin/hello')?.mode & 0o100))),
          S('Try to run it by name: `hello`.', 'hello', cmd(ev => /^\s*hello\s*$/.test(ev.line) && ev.exit === 127), 'Command not found: `~/bin` is not in your PATH, so the shell does not look there.'),
          S('Add the folder to the front of PATH: `export PATH="$HOME/bin:$PATH"`. Then run `hello` again.', 'export PATH="$HOME/bin:$PATH"; hello', cmd(ev => /(^|;|&&)\s*hello\s*$/.test(ev.line) && ev.exit === 0), 'Note the `:$PATH` at the end: it keeps the old folders. Forgetting it is a classic mistake that makes every command disappear.', { hint: 'First the `export` line, then `hello`.' }),
          S('Confirm where the shell finds it: `which hello`.', 'which hello', ran('which', arg('hello'))),
        ],
      },
      {
        id: 'rc', title: 'Aliases and your shell config file',
        intro: [
          `Aliases and variables disappear when the terminal closes. To keep them, they go into the config file of your shell. On ${sys} the shell is **${shell}**, and its file is \`${rc}\`. It runs every time a terminal opens.`,
        ],
        steps: [
          S('An alias is a nickname for a command. Create one: `alias projects=\'cd ~/projects\'`.', "alias projects='cd ~/projects'", cmd((ev, sh) => /projects/.test(sh.aliases.projects || '')), 'No spaces around `=`, and quotes around the command.'),
          S('Use it: type `projects`.', 'projects', cwd('~/projects')),
          S('List all aliases with `alias`.', 'alias', ran('alias', a => !a.length), mac ? 'A fresh macOS has none. Many people define `ll` for `ls -la`.' : 'Ubuntu ships a few, such as `ll` for `ls -alF`.'),
          S(`Make the alias permanent by appending it to your config file: \`echo "alias projects='cd ~/projects'" >> ${rc}\`.`, `echo "alias projects='cd ~/projects'" >> ${rc}`, fileHas(rc, /alias projects=/), mac ? 'On a fresh Mac the file does not exist yet; `>>` created it. Always use `>>` here, never `>`: a single `>` would wipe your whole configuration.' : 'Always use `>>` here, never `>`: a single `>` would wipe your whole configuration.'),
          S(`Look at the file: \`cat ${rc}\`.`, `cat ${rc}`, ran('cat', arg(/rc$/))),
          S(`Open the file in an editor and add one more line: \`export EDITOR=vim\`. Use \`nano ${rc}\` or \`vi ${rc}\`.`, `nano ${rc}`, fileHas(rc, /^\s*export EDITOR=vim/m), 'Editing this file is how you customise your terminal: aliases, variables, PATH additions.', { hint: 'nano: type the line, then Ctrl+O, Enter, Ctrl+X. vi: `G`, `o`, type the line, Esc, `:wq`.' }),
          S(`The terminal that is open has not read the change yet. Load the file now: \`source ${rc}\`.`, `source ${rc}`, ran(['source', '.']), '`source` runs a file inside the current shell. New terminal windows read the file automatically.'),
          S('Check that it worked: `echo $EDITOR`.', 'echo $EDITOR', ran('echo', arg('vim'))),
        ],
      },
    ],
  };

  const procs = {
    id: 'procs', title: 'Processes',
    lessons: [
      {
        id: 'proc', title: 'Processes and jobs',
        intro: [
          'Every running program is a **process** with a number, its PID. You can list processes, watch them, and stop the ones that misbehave. Two of them are waiting for you: one that eats CPU and one that is frozen.',
          'Programs you start from the terminal are **jobs** of your shell: you can pause them, send them to the background and bring them back.',
        ],
        setup: sh => {
          sh.procs.push({ pid: 6100, user: 'you', cpu: 97.3, mem: 2.1, cmd: 'python3 runaway.py' }, { pid: 6200, user: 'you', cpu: 0.0, mem: 1.2, cmd: 'frozen-app', stubborn: true });
        },
        steps: [
          S('List the processes started from this terminal: `ps`.', 'ps', ran('ps'), 'Just your shell (and `ps` itself, for a moment).'),
          S('See every process on the machine: `ps aux`.', 'ps aux', ran('ps', a => /a/.test(a.join(''))), 'The columns: owner, process ID (PID), CPU and memory share, and the command. The PID is how you refer to a process.'),
          S('Something is eating the CPU. Watch live with `top`: the busiest process is listed first. Note its PID, then press [[q]].', 'top', ran(['top', 'htop']), '`top` refreshes every few seconds. `q` quits.'),
          S('Find it by name: `ps aux | grep python`.', 'ps aux | grep python', any(all(ran('ps'), tried('grep', arg(/python|runaway/))), ran('pgrep')), '`pgrep python` is a shortcut that prints only the PIDs.'),
          S('Stop it: `kill 6100`.', 'kill 6100', cmd((ev, sh) => !sh.procs.some(p => p.pid === 6100)), '`kill` politely asks a process to end (the signal is called TERM).'),
          S('There is also a frozen program with PID 6200. Ask it to stop: `kill 6200`.', 'kill 6200', tried(['kill', 'pkill', 'killall'], arg(/6200|frozen/)), 'It ignored the request. Frozen programs do that.'),
          S('Force it with signal 9: `kill -9 6200`.', 'kill -9 6200', cmd((ev, sh) => !sh.procs.some(p => p.pid === 6200)), '`-9` (KILL) cannot be ignored. It is the last resort: the program gets no chance to save its work.'),
          S('Now your own jobs. Start a long task with `sleep 600` (ten minutes), then pause it with [[Ctrl+Z]].', 'sleep 600, then Ctrl+Z', cmd(ev => ev.exit === 148), 'Ctrl+Z suspends the program and gives you the prompt back. It is paused, not ended.'),
          S('List the jobs of this shell: `jobs`.', 'jobs', ran('jobs')),
          S('Let it continue in the background: `bg`.', 'bg', ran('bg'), 'It is running again, but no longer blocks the terminal.'),
          S('Start another one directly in the background by adding `&`: `sleep 900 &`.', 'sleep 900 &', cmd((ev, sh) => /&\s*$/.test(ev.line) && sh.jobs.length >= 1), 'The shell prints the job number and the PID.'),
          S('Bring job 1 back to the foreground with `fg %1`, then stop it with [[Ctrl+C]].', 'fg %1, then Ctrl+C', cmd(ev => /^\s*fg\b/.test(ev.line) && ev.exit === 130), '`%1` means job number 1. Plain `fg` takes the most recent job.'),
          S('End the remaining job: `kill %2`. Check with `jobs` that nothing is left.', 'kill %2', cmd((ev, sh) => !sh.jobs.some(j => j.state === 'running' || j.state === 'stopped')), 'Summary: `&` starts in the background, Ctrl+Z pauses, `bg` and `fg` resume, `kill %N` ends a job.', { hint: '`jobs` shows the job numbers. Kill each remaining one with `kill %N`.' }),
        ],
      },
    ],
  };

  const BREW_INSTALL = '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"';
  const packages = {
    id: 'packages', title: mac ? 'Installing software: Homebrew' : 'Installing software: apt',
    lessons: [mac
      ? {
        id: 'pkg', title: 'Homebrew from scratch',
        intro: [
          'macOS has no built-in way to install command-line tools. The standard solution is **Homebrew** (`brew`). In this lesson you install Homebrew itself, the way you would on a new Mac, and then use it.',
          'Pay attention to what the installer prints at the end. Skipping its "Next steps" is the most common beginner problem.',
        ],
        setup: sh => {
          sh.fs.get('/opt')?.kids.delete('homebrew');
          sh.fs.get(sh.home)?.kids.delete('.zprofile');
          sh.env.PATH = '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';
          sh.fs.root.pkgs = {};
        },
        steps: [
          S('Check whether Homebrew is there: `brew --version`.', 'brew --version', all(failed('NOTFOUND'), line(/brew/)), 'Not found: this Mac has no Homebrew yet.'),
          S(`Install it with the official one-liner from brew.sh. Nobody types this by hand: copy it and paste it into the terminal (${paste}), then press [[Enter]]. Any password works here.`, BREW_INSTALL, exists('/opt/homebrew/bin/brew'), 'Installers print a lot. Get into the habit of reading the last screen: it usually tells you what to do next.', { copy: BREW_INSTALL }),
          S('Try again: `brew --version`.', 'brew --version', all(failed('NOTFOUND'), line(/brew/)), 'Still not found. Homebrew lives in `/opt/homebrew/bin`, and that folder is not in your PATH yet. This is exactly what the "Next steps" are for.'),
          S('Run the first two "Next steps" lines. They add Homebrew to the file that every new terminal reads.', "echo >> ~/.zprofile; echo 'eval \"$(/opt/homebrew/bin/brew shellenv)\"' >> ~/.zprofile", fileHas('~/.zprofile', /brew shellenv/), 'Future terminals will now find `brew`. The one that is open has not read the file yet.', { copy: "echo >> ~/.zprofile; echo 'eval \"$(/opt/homebrew/bin/brew shellenv)\"' >> ~/.zprofile" }),
          S('Run the third line for the terminal that is open right now.', 'eval "$(/opt/homebrew/bin/brew shellenv)"', cmd((ev, sh) => sh.env.PATH.includes('/opt/homebrew/bin')), 'It put `/opt/homebrew/bin` at the front of your PATH.', { copy: 'eval "$(/opt/homebrew/bin/brew shellenv)"' }),
          S('Third time lucky: `brew --version`.', 'brew --version', ran('brew')),
          S('Look for a package: `brew search tree`.', 'brew search tree', ran('brew', arg('search'))),
          S('Install it: `brew install tree`. No sudo: Homebrew never needs it.', 'brew install tree', installed('tree'), 'The beer mug marks a finished installation.'),
          S('Use your new command: `tree projects`.', 'tree projects', ran('tree')),
          S('What is installed? `brew list`.', 'brew list', ran('brew', arg(/^(list|ls|leaves)$/))),
          S('Details about a package: `brew info tree`.', 'brew info tree', ran('brew', arg('info'))),
          S('Keep things fresh. `brew update` refreshes the catalogue; `brew upgrade` then updates your packages. Run `brew update`.', 'brew update', ran('brew', arg(/^(update|upgrade)$/)), 'Graphical apps work too: `brew install --cask firefox`.'),
          S('Remove the package again: `brew uninstall tree`.', 'brew uninstall tree', cmd((ev, sh) => !installedPkgs(sh.fs).tree && ev.cmds.some(c => c.name === 'brew'))),
        ],
      }
      : {
        id: 'pkg', title: 'apt: install, update, remove',
        intro: [
          'Ubuntu and Debian install software with `apt`. It downloads packages from the distribution\'s own catalogue, so you rarely need to fetch installers from websites.',
          'Changing installed software affects the whole system, so those commands need `sudo`. Any password works in this trainer.',
        ],
        steps: [
          S('Look for a package: `apt search tree`.', 'apt search tree', ran('apt', arg('search')), 'Searching and showing never needs sudo.'),
          S('Try to install it: `apt install tree`.', 'apt install tree', failed('APT_ROOT'), 'Permission denied: only the administrator may change the system.'),
          S('First refresh the catalogue of available software: `sudo apt update`.', 'sudo apt update', ran(['apt', 'apt-get'], arg('update')), '`update` does not install anything. It fetches the current list of packages, so do it before installing.'),
          S('Now install: `sudo apt install tree`.', 'sudo apt install tree', installed('tree')),
          S('Use your new command: `tree projects`.', 'tree projects', ran('tree')),
          S('List installed packages: `apt list --installed`.', 'apt list --installed', ran('apt', arg('list')), 'On a real system this list has thousands of entries. The trainer shows only its own small catalogue.'),
          S('Details about a package: `apt show tree`.', 'apt show tree', ran('apt', arg('show'))),
          S('Update everything that is installed: `sudo apt upgrade`.', 'sudo apt upgrade', ran(['apt', 'apt-get'], arg(/upgrade/)), '`sudo apt update && sudo apt upgrade` is the routine that keeps an Ubuntu system current.'),
          S('Remove the package: `sudo apt remove tree`. apt asks for confirmation: press [[Enter]] or type `y`.', 'sudo apt remove tree', cmd((ev, sh) => !installedPkgs(sh.fs).tree && ev.cmds.some(c => c.name === 'apt' || c.name === 'apt-get'))),
        ],
      }],
  };

  const modern = {
    id: 'modern', title: 'Modern tools',
    lessons: [
      {
        id: 'modern1', title: 'Faster search and nicer output: rg, fd, bat, eza',
        intro: [
          'The classic tools are decades old. A newer generation does the same jobs faster and with friendlier defaults. None of them is preinstalled, so this is also package-manager practice.',
          mac ? '' : 'On Ubuntu, two of them have unusual names: the package `fd-find` installs the command `fdfind`, and `bat` installs `batcat`.',
        ].filter(Boolean),
        steps: [
          S(`Install ripgrep: \`${install} ripgrep\`.`, `${install} ripgrep`, installed('ripgrep'), 'The package is called `ripgrep`, the command `rg`.'),
          S('Search for TODO in your projects: `rg TODO projects`.', 'rg TODO projects', ran('rg'), '`rg` searches folders recursively by default, shows line numbers, and skips hidden files.'),
          S('Ignore case and list only the files: `rg -il todo projects`.', 'rg -il todo projects', ran('rg', has('i', 'l'))),
          S(`Install fd: \`${install} ${mac ? 'fd' : 'fd-find'}\`.`, `${install} ${mac ? 'fd' : 'fd-find'}`, installed('fd')),
          S(`Find everything with "notes" in its name: \`${fd} notes\`.`, `${fd} notes`, ran(['fd', 'fdfind']), `Compare with \`find . -name "*notes*"\`. ${mac ? '' : 'On Ubuntu the command is `fdfind`; many people add `alias fd=fdfind`.'}`.trim()),
          S(`Find by extension: \`${fd} -e md\`.`, `${fd} -e md`, ran(['fd', 'fdfind'], has('e'))),
          S(`Install bat: \`${install} bat\`.`, `${install} bat`, installed('bat')),
          S(`View a file with line numbers and a frame: \`${bat} Documents/notes.txt\`.`, `${bat} Documents/notes.txt`, ran(['bat', 'batcat']), 'On a real system `bat` also colours source code.'),
          S(`Install eza: \`${install} eza\`.`, `${install} eza`, installed('eza')),
          S('List with colours and readable sizes: `eza -la`.', 'eza -la', ran('eza', has('l'))),
          S('Show a tree, two levels deep: `eza -T -L 2 projects`.', 'eza -T -L 2 projects', ran('eza', a => a.includes('-T') || a.includes('--tree') || flags(a).includes('T'))),
        ],
      },
      {
        id: 'modern2', title: 'jq, fzf, tldr, zoxide, htop',
        intro: ['Five more tools that many people install on day one: `tldr` for quick examples, `jq` for JSON, `fzf` for picking things from lists, `zoxide` for jumping between folders, and `htop` for watching processes.'],
        steps: [
          S(`Install several packages at once: \`${install} jq fzf tldr zoxide htop\`.`, `${install} jq fzf tldr zoxide htop`, all(installed('jq'), installed('fzf'), installed('tldr'), installed('zoxide'), installed('htop')), 'A package manager takes any number of names.'),
          S('Get practical examples for a command: `tldr tar`.', 'tldr tar', ran('tldr'), '`man` is the complete reference. `tldr` shows the five things you actually wanted to know.'),
          S('Fetch some JSON data and format it: `curl -s https://api.example.com/users | jq .`', 'curl -s https://api.example.com/users | jq .', all(ran('curl'), ran('jq')), '`curl` fetched the data (`-s` hides its progress meter), `jq .` formatted it. The dot means "everything".', { copy: 'curl -s https://api.example.com/users | jq .' }),
          S('Pick one field from every element: replace the dot with `\'.[].name\'`.', "curl -s https://api.example.com/users | jq '.[].name'", all(ran('jq'), out(/"Ada Lovelace"\n"Linus Torvalds"/)), '`.[]` walks through the list, `.name` takes one field. Put jq filters in single quotes.', { copy: "curl -s https://api.example.com/users | jq '.[].name'" }),
          S('Filter: the names of the active users, as plain text.', "curl -s https://api.example.com/users | jq -r '.[] | select(.active) | .name'", out(/^Ada Lovelace\nLinus Torvalds\nKen Thompson\n$/), 'Inside jq, `|` works like the shell pipe. `-r` prints raw text without quotes.', { copy: "curl -s https://api.example.com/users | jq -r '.[] | select(.active) | .name'" }),
          S('Run `fzf`, type a few letters of a file name (try `pan`), choose with the arrow keys, and press [[Enter]].', 'fzf', ran('fzf'), '`fzf` prints what you picked. On its own that is not much…'),
          S('…but combined it is great. Print whichever file you pick: `cat $(fzf)`.', 'cat $(fzf)', all(ran('fzf'), ran('cat')), '`$(…)` inserts the output of a command into another. `vim $(fzf)` opens the picked file in vim.'),
          S(`Set up zoxide for this terminal: \`eval "$(zoxide init ${shell})"\`.`, `eval "$(zoxide init ${shell})"`, cmd((ev, sh) => !!sh.aliases.z), `This creates the \`z\` command. To keep it, the line belongs in \`${rc}\`.`, { copy: `eval "$(zoxide init ${shell})"` }),
          S('zoxide learns from where you go. Visit a folder: `cd ~/projects/website`. Then go home with `cd`.', 'cd ~/projects/website; cd', all(cwd('~'), cmd((ev, sh) => !!sh.visits[`${home}/projects/website`])), '', { hint: 'Two commands: `cd ~/projects/website`, then `cd`.' }),
          S('Jump back with just a fragment of the name: `z web`.', 'z web', cwd('~/projects/website'), '`z` jumps to the most used folder that matches. After a week of normal work it knows all your favourite places.'),
          S('Finally, look at your processes in colour: `htop`. Quit with [[q]].', 'htop', ran('htop')),
        ],
      },
    ],
  };

  const network = {
    id: 'network', title: 'Network and remote machines',
    lessons: [
      {
        id: 'net', title: 'ping, curl and wget',
        intro: [
          'The terminal talks to the network too: `ping` tests whether a machine answers, `curl` and `wget` fetch things from the web.',
          'The trainer has no real internet access. A few pretend hosts answer instead: `example.com`, `api.example.com` and `files.example.com`.',
        ],
        setup: sh => quiet(sh, 'cd ~/Downloads'),
        steps: [
          S('Check whether a server answers: `ping -c 3 example.com`.', 'ping -c 3 example.com', ran('ping', has('c')), 'Each line is one answer, with the travel time. `-c 3` stops after three.'),
          S('Without `-c`, ping does not stop by itself. Run `ping example.com` and end it with [[Ctrl+C]].', 'ping example.com, then Ctrl+C', cmd(ev => /ping/.test(ev.line) && ev.exit === 130), 'Ctrl+C stops it, and ping prints its statistics.'),
          S('Fetch a web page: `curl https://example.com`.', 'curl https://example.com', ran('curl'), '`curl` prints what the server sends: here, the HTML of the page.'),
          S('Show only the response headers: `curl -I https://example.com`.', 'curl -I https://example.com', ran('curl', has('I')), 'Headers tell you the status (200 = OK, 404 = not found), the content type and more.'),
          S('Download a file and keep its name: `curl -O https://files.example.com/notes.txt`.', 'curl -O https://files.example.com/notes.txt', exists('~/Downloads/notes.txt'), 'Capital `-O` saves under the remote name.', { copy: 'curl -O https://files.example.com/notes.txt' }),
          S('Download and choose the name yourself with lowercase `-o`: `curl -o cities.csv https://files.example.com/data.csv`.', 'curl -o cities.csv https://files.example.com/data.csv', exists('~/Downloads/cities.csv'), '', { copy: 'curl -o cities.csv https://files.example.com/data.csv' }),
          ...(mac ? [S('`wget` is a popular download tool that macOS lacks. Install it: `brew install wget`.', 'brew install wget', installed('wget'))] : []),
          S('Download an archive with wget: `wget https://files.example.com/project.tar.gz`.', 'wget https://files.example.com/project.tar.gz', exists('~/Downloads/project.tar.gz'), 'wget saves into the current folder by default and shows a progress bar.', { copy: 'wget https://files.example.com/project.tar.gz' }),
          S(`Finally, your own network address: \`${mac ? 'ifconfig' : 'ip a'}\`.`, mac ? 'ifconfig' : 'ip a', ran(mac ? 'ifconfig' : 'ip'), 'Look for the line starting with `inet`: `127.0.0.1` is the computer itself, the other one is your address in the local network.'),
        ],
      },
      {
        id: 'remote', title: 'ssh, scp and archives',
        intro: [
          'Servers have no screen: you work on them through `ssh`, a terminal session on another machine. `scp` copies files across, and `tar` packs folders into a single archive file first.',
          'A pretend server is waiting at `server.example.com`. Any password works.',
        ],
        steps: [
          S('Pack your Documents folder into an archive: `tar -czf docs.tar.gz Documents`.', 'tar -czf docs.tar.gz Documents', exists('~/docs.tar.gz'), '`c` = create, `z` = compress with gzip, `f` = the archive file name follows.'),
          S('Look inside without unpacking: `tar -tzf docs.tar.gz`.', 'tar -tzf docs.tar.gz', ran('tar', a => /t/.test(a[0] || ''))),
          S('Log in to the server: `ssh you@server.example.com`. Answer `yes` to the fingerprint question.', 'ssh you@server.example.com', cmd((ev, sh) => sh.host === 'web01'), 'Look at the prompt: you are on `web01` now. Every command runs over there.'),
          S('Look around on the server: `ls`, then `cat welcome.txt`.', 'cat welcome.txt', all(ran('cat'), cmd((ev, sh) => sh.host === 'web01')), '', { hint: 'Two commands: `ls`, then `cat welcome.txt`.' }),
          S('Create a folder for uploads: `mkdir backups`. Then leave the server with `exit`.', 'mkdir backups; exit', cmd((ev, sh) => sh.host !== 'web01' && !!sh.remotes.web01?.get('/home/you/backups')), 'Back on your own machine. Always check the prompt before running something destructive.', { hint: 'First `mkdir backups`, then `exit`.' }),
          S('Copy the archive to the server: `scp docs.tar.gz you@server.example.com:~/backups/`.', 'scp docs.tar.gz you@server.example.com:~/backups/', cmd((ev, sh) => !!sh.remotes.web01?.get('/home/you/backups/docs.tar.gz')), '`scp` works like `cp`, with `USER@HOST:` in front of the remote path. Mind the colon.'),
          S('Run a single command on the server without a full login: `ssh you@server.example.com ls backups`.', 'ssh you@server.example.com ls backups', all(line(/ssh\s+\S+\s+ls/), out(/docs\.tar\.gz/))),
          S('Copy a file the other way: `scp you@server.example.com:~/welcome.txt .`', 'scp you@server.example.com:~/welcome.txt .', exists('~/welcome.txt'), 'The final `.` means "into the current folder".'),
          S('Unpack your archive into a new folder: `mkdir restore`, then `tar -xzf docs.tar.gz -C restore`.', 'mkdir restore && tar -xzf docs.tar.gz -C restore', exists('~/restore/Documents/notes.txt'), '`x` = extract. `-C` chooses the destination folder.', { hint: 'First `mkdir restore`, then `tar -xzf docs.tar.gz -C restore`.' }),
          S('The other common format is zip: `zip -r docs.zip Documents`.', 'zip -r docs.zip Documents', exists('~/docs.zip'), '`unzip docs.zip` unpacks it, `unzip -l docs.zip` lists the contents.'),
        ],
      },
    ],
  };

  const git = {
    id: 'git', title: 'Git basics',
    lessons: [
      {
        id: 'git1', title: 'Your first repository',
        intro: [
          'git records snapshots of a project, called **commits**, so that you can see what changed and go back. The rhythm is always the same: change files, **stage** the changes with `git add`, save them with `git commit`.',
          'You are in `~/projects/website`. `git status` is your best friend: it always says where things stand and what to do next.',
        ],
        setup: sh => quiet(sh, 'cd ~/projects/website'),
        steps: [
          S('Ask git about this folder: `git status`.', 'git status', failed('GIT_NOREPO'), 'Not a repository yet. git only works inside folders it has been told to track.'),
          S('Turn the folder into a repository: `git init`.', 'git init', cmd((ev, sh) => !!repoAt(sh, '~/projects/website')), 'git created a hidden folder `.git`, where it will keep the whole history.'),
          S('Ask again: `git status`.', 'git status', ran('git', arg('status')), 'The files are **untracked**: git sees them but does not record them yet.'),
          S('Tell git who you are. This is needed once per computer: `git config --global user.name "Your Name"`.', 'git config --global user.name "Your Name"', fileHas('~/.gitconfig', /name = /)),
          S('And your e-mail: `git config --global user.email "you@example.com"`.', 'git config --global user.email "you@example.com"', fileHas('~/.gitconfig', /email = /), 'These settings are stored in `~/.gitconfig`.'),
          S('Stage everything for the first commit: `git add .`', 'git add .', cmd((ev, sh) => Object.keys(repoAt(sh, '~/projects/website')?.index || {}).length >= 4), 'The dot means "everything in this folder". Staging is choosing what goes into the next snapshot.'),
          S('Take the snapshot: `git commit -m "First version"`.', 'git commit -m "First version"', cmd((ev, sh) => Object.keys(repoAt(sh, '~/projects/website')?.commits || {}).length >= 1), '`-m` gives the message. Without it, git opens vi so that you can write one (now you know how to get out).'),
          S('Change a file: `echo "More text" >> README.md`. Then run `git status`.', 'echo "More text" >> README.md; git status', all(ran('git', arg('status')), out(/modified:\s+README\.md/)), 'git noticed the change. It is "not staged": it would not be part of a commit yet.', { hint: 'Two commands: the `echo … >> README.md` line, then `git status`.' }),
          S('See exactly what changed: `git diff`.', 'git diff', ran('git', arg('diff')), 'Lines starting with `+` were added, lines with `-` removed.'),
          S('Stage and commit the change: `git add README.md`, then `git commit -m "Extend readme"`.', 'git add README.md && git commit -m "Extend readme"', cmd((ev, sh) => Object.keys(repoAt(sh, '~/projects/website')?.commits || {}).length >= 2), '', { hint: 'Two commands: `git add README.md`, then `git commit -m "Extend readme"`.' }),
          S('Look at the history: `git log --oneline`.', 'git log --oneline', ran('git', arg('log')), 'Every commit has an ID. Plain `git log` also shows author and date (and opens the pager when the history is long: `q` quits).'),
        ],
      },
      {
        id: 'git2', title: 'Branches, merging and cloning',
        intro: [
          'A **branch** is a separate line of work. You try something on a branch, and when it is good, you **merge** it into the main line. The website repository from the previous lesson is prepared, with two commits.',
        ],
        setup: async sh => {
          await quiet(sh, 'cd ~/projects/website; git config --global user.name "You"; git config --global user.email "you@example.com"; git init; git add .; git commit -m "First version"; echo "More text" >> README.md; git commit -am "Extend readme"');
        },
        steps: [
          S('List the branches: `git branch`.', 'git branch', ran('git', a => a[0] === 'branch' && a.length === 1), 'Only `main` so far. The star marks the branch you are on.'),
          S('Create a branch and switch to it in one step: `git switch -c contact-page`.', 'git switch -c contact-page', cmd((ev, sh) => repoAt(sh, '~/projects/website')?.head === 'contact-page'), 'Older tutorials use `git checkout -b`, which does the same.'),
          S('Create a new page: `echo "<h1>Contact</h1>" > contact.html`. Then stage and commit it.', 'echo "<h1>Contact</h1>" > contact.html; git add contact.html; git commit -m "Add contact page"', cmd((ev, sh) => { const r = repoAt(sh, '~/projects/website'); return !!r && 'contact.html' in tree(r, 'contact-page'); }), 'The commit belongs to the branch `contact-page`. `main` knows nothing about it.', { hint: 'Three commands: the `echo` line, `git add contact.html`, `git commit -m "Add contact page"`.' }),
          S('Switch back: `git switch main`. Then run `ls`.', 'git switch main; ls', all(ran('ls'), cmd((ev, sh) => repoAt(sh, '~/projects/website')?.head === 'main')), '`contact.html` is gone from the folder. It is safe on the other branch: git swaps the files when you switch.', { hint: 'Two commands: `git switch main`, then `ls`.' }),
          S('Bring the work into main: `git merge contact-page`.', 'git merge contact-page', cmd((ev, sh) => { const r = repoAt(sh, '~/projects/website'); return !!r && 'contact.html' in tree(r, 'main'); }), '"Fast-forward" means main simply moved ahead to the newer commit.'),
          S('The branch has done its job. Delete it: `git branch -d contact-page`.', 'git branch -d contact-page', cmd((ev, sh) => { const r = repoAt(sh, '~/projects/website'); return !!r && !('contact-page' in r.branches); })),
          S('Most projects start by copying an existing repository. Go home with `cd` and clone one: `git clone https://github.com/example/hello-world.git`.', 'cd; git clone https://github.com/example/hello-world.git', cmd((ev, sh) => !!repoAt(sh, '~/hello-world')), 'Cloning downloads the files together with the whole history.', { copy: 'git clone https://github.com/example/hello-world.git', hint: 'First `cd`, then the clone command.' }),
          S('Go into it and look at its history: `cd hello-world`, then `git log --oneline`.', 'cd hello-world; git log --oneline', all(ran('git', arg('log')), cwd('~/hello-world')), '', { hint: 'Two commands: `cd hello-world`, then `git log --oneline`.' }),
          S('Where did it come from? `git remote -v`.', 'git remote -v', ran('git', arg('remote')), '`origin` is the server the repository was cloned from. `git pull` fetches new commits from it, `git push` sends yours.'),
        ],
      },
    ],
  };

  return [first, files, faster, pipes, editors, perms, config, procs, packages, modern, network, git];
}
