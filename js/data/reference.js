// One source of truth for command documentation. It feeds the Reference panel,
// `man`, `--help`, `tldr`, `whatis`, `apropos` and the coach's usage hints.

const R = (name, cat, sum, syn, opts = [], ex = [], extra = {}) => ({ name, cat, sum, syn, opts, ex, ...extra });

export const REF = [
  // ---------- Navigation ----------
  R('pwd', 'Navigation', 'Print the folder you are in (the "working directory")', 'pwd [-P]', [['-P', 'the real location, with symbolic links resolved']], [['pwd', 'show where you are right now'], ['pwd -P', 'the same, but without going through links']]),
  R('ls', 'Navigation', 'List the contents of a folder', 'ls [options] [path ...]', [
    ['-l', 'long format: permissions, owner, size, date'],
    ['-a', 'also show hidden files (names starting with a dot)'],
    ['-h', 'with -l: sizes like 1.2K instead of bytes'],
    ['-t', 'sort by time, newest first'],
    ['-r', 'reverse the sort order'],
    ['-R', 'also list all subfolders'],
    ['-1', 'one name per line'],
    ['-F', 'mark folders with / and programs with *'],
  ], [['ls', 'list the current folder'], ['ls -la', 'everything, with details'], ['ls -lh Documents', 'details of another folder, readable sizes'], ['ls -lt', 'newest files first']],
  { note: { mac: 'On macOS, options must come before the path: `ls -l Documents`, not `ls Documents -l`.' } }),
  R('cd', 'Navigation', 'Change into another folder', 'cd [folder]', [], [['cd Documents', 'go into Documents'], ['cd ..', 'go up one level'], ['cd', 'go to your home folder'], ['cd ~/Downloads', 'go to Downloads from anywhere'], ['cd -', 'jump back to the previous folder'], ['cd /', 'go to the root of the filesystem']]),
  R('tree', 'Navigation', 'Show a folder and its subfolders as a tree', 'tree [options] [folder]', [['-a', 'include hidden files'], ['-d', 'folders only'], ['-L n', 'only go n levels deep']], [['tree', 'tree of the current folder'], ['tree -L 2 projects', 'two levels of projects']], { pkg: 'tree' }),

  // ---------- Files and folders ----------
  R('mkdir', 'Files', 'Create folders', 'mkdir [-p] folder ...', [['-p', 'create missing parent folders too; no error if it exists'], ['-v', 'say what was created']], [['mkdir photos', 'create one folder'], ['mkdir -p work/2026/reports', 'create a whole path at once']]),
  R('touch', 'Files', 'Create an empty file, or update a file\'s timestamp', 'touch file ...', [], [['touch notes.txt', 'create notes.txt if it does not exist'], ['touch a.txt b.txt', 'several at once']]),
  R('cp', 'Files', 'Copy files and folders', 'cp [options] source ... destination', [['-r', 'copy folders with everything inside'], ['-i', 'ask before overwriting'], ['-v', 'show what is copied']], [['cp a.txt b.txt', 'copy a.txt to a new file b.txt'], ['cp a.txt Documents/', 'copy into a folder'], ['cp -r project project-backup', 'copy a whole folder']]),
  R('mv', 'Files', 'Move or rename files and folders', 'mv [options] source ... destination', [['-i', 'ask before overwriting'], ['-v', 'show what is moved']], [['mv old.txt new.txt', 'rename'], ['mv report.txt Documents/', 'move into a folder'], ['mv *.jpg Pictures/', 'move many files']]),
  R('rm', 'Files', 'Delete files and folders (permanently, there is no trash)', 'rm [options] file ...', [['-r', 'delete folders and everything inside'], ['-i', 'ask before each deletion'], ['-f', 'never ask, ignore missing files'], ['-v', 'show what is deleted']], [['rm old.txt', 'delete a file'], ['rm -r build', 'delete a folder and its contents'], ['rm -i *.log', 'delete with a safety question']]),
  R('rmdir', 'Files', 'Delete empty folders', 'rmdir folder ...', [], [['rmdir empty-folder', 'works only if the folder is empty']]),
  R('ln', 'Files', 'Create links: a second path that leads to a file or folder', 'ln -s target link-name', [['-s', 'symbolic link (the usual kind)'], ['-f', 'replace an existing link']], [['ln -s ~/projects/website site', 'make "site" point to the website folder'], ['ln -s Documents/notes.txt quicknotes', 'a second name for a file'], ['sudo ln -s ~/projects/scripts/hello.sh /usr/local/bin/hello', 'make a program runnable from anywhere']], { note: 'The order is the same as for cp: first what exists, then the new name. `ls -l` shows where a link points. Removing a link never touches its target.' }),
  R('readlink', 'Files', 'Show where a symbolic link points', 'readlink link', [], [['readlink site', 'print the target of the link']]),
  R('realpath', 'Files', 'Print the full, real path of a file', 'realpath path', [], [['realpath site', 'the absolute path, with links resolved']]),
  R('file', 'Files', 'Guess what kind of file something is', 'file name ...', [], [['file photo.jpg', 'report the file type']]),
  R('stat', 'Files', 'Show detailed information about a file', 'stat file ...', [], [['stat notes.txt', 'size, permissions, dates']]),
  R('du', 'Files', 'Show how much disk space files and folders use', 'du [options] [path ...]', [['-h', 'readable sizes'], ['-s', 'only a total per argument']], [['du -sh Documents', 'total size of a folder']]),
  R('df', 'Files', 'Show free space on disks', 'df [-h]', [['-h', 'readable sizes']], [['df -h', 'disk usage overview']]),
  R('basename', 'Files', 'Strip the folder part from a path', 'basename path', [], [['basename /a/b/c.txt', 'prints c.txt']]),
  R('dirname', 'Files', 'Strip the last part from a path', 'dirname path', [], [['dirname /a/b/c.txt', 'prints /a/b']]),

  // ---------- Viewing ----------
  R('cat', 'Viewing', 'Print file contents (or join several files)', 'cat [options] [file ...]', [['-n', 'number the lines']], [['cat notes.txt', 'show a file'], ['cat a.txt b.txt', 'show two files after each other'], ['cat a.txt b.txt > both.txt', 'join files into a new one']], { note: 'With no file, cat waits for keyboard input. Finish with Ctrl+D.' }),
  R('less', 'Viewing', 'Read long text page by page', 'less [file]', [], [['less report.md', 'open a file'], ['ls -la | less', 'page through long output']], { note: 'Inside less: Space = next page, b = back, /word = search, n = next match, q = quit.' }),
  R('head', 'Viewing', 'Show the first lines of a file', 'head [-n count] [file ...]', [['-n N', 'show N lines (default 10)']], [['head notes.txt', 'first 10 lines'], ['head -n 3 notes.txt', 'first 3 lines']]),
  R('tail', 'Viewing', 'Show the last lines of a file', 'tail [-n count] [-f] [file ...]', [['-n N', 'show N lines (default 10)'], ['-f', 'keep watching the file for new lines (stop with Ctrl+C)']], [['tail server.log', 'last 10 lines'], ['tail -n 20 server.log', 'last 20 lines'], ['tail -f server.log', 'follow a growing log']]),
  R('wc', 'Viewing', 'Count lines, words and bytes', 'wc [-lwc] [file ...]', [['-l', 'lines only'], ['-w', 'words only'], ['-c', 'bytes only']], [['wc -l notes.txt', 'how many lines?'], ['ls | wc -l', 'how many entries in this folder?']]),
  R('echo', 'Viewing', 'Print text', 'echo [-n] [text ...]', [['-n', 'no line break at the end']], [['echo hello', 'print hello'], ['echo "Hi $USER"', 'variables work inside double quotes'], ['echo hello > file.txt', 'write text into a file (replaces it)'], ['echo more >> file.txt', 'append a line to a file']]),
  R('printf', 'Viewing', 'Print formatted text', 'printf format [arguments ...]', [], [['printf "%s is %d\\n" Anna 31', 'fill in a template']]),

  // ---------- Search and text ----------
  R('grep', 'Search & text', 'Find lines that match a pattern', 'grep [options] pattern [file ...]', [['-i', 'ignore upper/lower case'], ['-n', 'show line numbers'], ['-r', 'search all files in a folder'], ['-v', 'show lines that do NOT match'], ['-c', 'count matching lines'], ['-l', 'only list file names'], ['-w', 'match whole words'], ['-E', 'extended patterns: a|b, +, ?']], [['grep milk notes.txt', 'lines containing milk'], ['grep -i error server.log', 'case-insensitive'], ['grep -rn TODO projects', 'search a folder, with line numbers'], ['ps aux | grep node', 'filter the output of another command']]),
  R('find', 'Search & text', 'Find files by name, type or other properties', 'find path [tests]', [['-name "pattern"', 'match the file name (quote the pattern)'], ['-iname "pattern"', 'same, ignoring case'], ['-type f|d', 'files only / folders only'], ['-maxdepth n', 'do not go deeper than n levels'], ['-empty', 'empty files and folders'], ['-delete', 'delete what was found (careful)']], [['find . -name "*.txt"', 'all .txt files below here'], ['find ~ -type d -name "recipes"', 'folders named recipes'], ['find . -name "*.log" -delete', 'delete all .log files below here']], { note: { mac: 'macOS find needs a starting path: `find . -name ...`.' } }),
  R('sort', 'Search & text', 'Sort lines', 'sort [options] [file ...]', [['-n', 'sort as numbers'], ['-r', 'reverse'], ['-u', 'drop duplicate lines'], ['-k N', 'sort by column N'], ['-t C', 'columns are separated by character C']], [['sort names.txt', 'alphabetical'], ['sort -n numbers.txt', 'numerical'], ['sort -t, -k3 -n data.csv', 'by the 3rd comma-separated column']]),
  R('uniq', 'Search & text', 'Collapse repeated neighbouring lines', 'uniq [-c] [file]', [['-c', 'prefix each line with how often it occurred'], ['-d', 'only show lines that repeat']], [['sort names.txt | uniq', 'unique lines (sort first)'], ['sort access.log | uniq -c | sort -rn', 'count and rank']]),
  R('cut', 'Search & text', 'Pick columns out of each line', 'cut -d delimiter -f fields [file ...]', [['-d C', 'column separator (default: tab)'], ['-f LIST', 'which columns, e.g. 1 or 1,3 or 2-4'], ['-c LIST', 'which character positions']], [['cut -d, -f1 data.csv', 'first column of a CSV'], ['cut -c1-10 file.txt', 'first 10 characters of each line']]),
  R('tr', 'Search & text', 'Replace or delete characters', 'tr [-d] set1 [set2]', [['-d', 'delete the characters in set1']], [['echo hello | tr a-z A-Z', 'to upper case'], ['tr -d "," < data.csv', 'remove all commas']]),
  R('sed', 'Search & text', 'Edit text with rules, most often search-and-replace', "sed [-n] [-i] 'script' [file ...]", [['s/old/new/', 'replace the first match in each line'], ['s/old/new/g', 'replace all matches'], ['-i', 'change the file itself instead of printing'], ['-n ... p', 'print only selected lines'], ['Nd', 'delete line N']], [["sed 's/cat/dog/g' pets.txt", 'print with replacements'], ["sed -n '2,4p' file.txt", 'print lines 2 to 4'], ["sed '1d' data.csv", 'drop the first line']], { note: { mac: "macOS: in-place editing needs an empty argument: `sed -i '' 's/a/b/' file`.", linux: "Linux: `sed -i 's/a/b/' file` edits the file in place." } }),
  R('awk', 'Search & text', 'Process text column by column', "awk [-F sep] 'program' [file ...]", [['-F C', 'columns are separated by C'], ['$1, $2 ...', 'the 1st, 2nd ... column; $0 is the whole line'], ['NR', 'current line number'], ['NF', 'number of columns in the line']], [["awk '{print $1}' file.txt", 'first column'], ["awk -F, '{print $2}' data.csv", 'second CSV column'], ["awk -F, '$3 > 30' data.csv", 'rows where column 3 is above 30'], ["awk '{sum += $1} END {print sum}' numbers.txt", 'add up a column']]),
  R('diff', 'Search & text', 'Show the differences between two files', 'diff [-u] file1 file2', [['-u', 'unified format, as used by git']], [['diff old.txt new.txt', 'what changed?']]),
  R('tee', 'Search & text', 'Write output to a file and show it at the same time', 'tee [-a] file', [['-a', 'append instead of replacing']], [['ls | tee list.txt', 'save and see'], ['echo "line" | sudo tee -a /etc/hosts', 'write to a protected file']]),
  R('xargs', 'Search & text', 'Turn lines of input into arguments for a command', 'xargs command', [], [['find . -name "*.tmp" | xargs rm', 'delete everything find reported']]),
  R('seq', 'Search & text', 'Print a sequence of numbers', 'seq [first] last', [], [['seq 5', '1 to 5'], ['seq 2 10', '2 to 10']]),

  // ---------- Help ----------
  R('man', 'Help', 'Open the manual page of a command', 'man command', [['-k word', 'search all manual pages for a word']], [['man ls', 'the manual for ls (q quits)'], ['man -k copy', 'which commands deal with copying?']], { note: 'The manual opens in the pager less: Space scrolls, /word searches, q quits.' }),
  R('help', 'Help', 'List the commands available in this trainer', 'help [command]', [], [['help', 'overview of commands'], ['help ls', 'short help for ls']], { note: 'This overview is part of the trainer. On a real system, use `man`, `--help` and double-Tab to discover commands.' }),
  R('which', 'Help', 'Show which program a command name runs', 'which name ...', [], [['which ls', 'where does ls live?']]),
  R('type', 'Help', 'Explain what a name is: program, builtin or alias', 'type name ...', [], [['type cd', 'cd is a shell builtin'], ['type ll', 'show an alias']]),
  R('whatis', 'Help', 'One-line description of a command', 'whatis name', [], [['whatis grep', 'what is grep?']]),
  R('apropos', 'Help', 'Search command descriptions for a word', 'apropos word', [], [['apropos copy', 'commands about copying']]),
  R('history', 'Help', 'List the commands you typed before', 'history', [], [['history', 'numbered list'], ['history | grep cp', 'find an earlier cp command'], ['!!', 'run the previous command again'], ['sudo !!', 'run it again with sudo']]),
  R('tldr', 'Help', 'Short, example-based help pages', 'tldr command', [], [['tldr tar', 'the most common tar examples']], { pkg: 'tldr' }),

  // ---------- Permissions ----------
  R('chmod', 'Permissions', 'Change who may read, write or run a file', 'chmod [-R] mode file ...', [['u g o a', 'who: user (owner), group, others, all'], ['+ - =', 'add, remove, set exactly'], ['r w x', 'read, write, execute'], ['755, 644 ...', 'numbers: r=4 w=2 x=1, one digit each for user, group, others'], ['-R', 'apply to a folder and everything inside']], [['chmod +x script.sh', 'make a script runnable'], ['chmod u+w notes.txt', 'let the owner write'], ['chmod 644 notes.txt', 'owner reads/writes, others read'], ['chmod 600 secret.txt', 'private: only the owner']]),
  R('chown', 'Permissions', 'Change the owner (and group) of a file', 'chown [-R] owner[:group] file ...', [['-R', 'apply to everything inside a folder']], [['sudo chown you file.txt', 'make yourself the owner'], ['sudo chown -R you:staff project', 'a whole folder']]),
  R('sudo', 'Permissions', 'Run one command as the administrator (root)', 'sudo command', [['-k', 'forget the cached password']], [['sudo apt update', 'run with admin rights'], ['sudo !!', 'repeat the last command with sudo'], ['sudo vi /etc/hosts', 'edit a system file']], { note: 'Nothing is shown while you type your password; that is normal. Use sudo only when a command truly needs it.' }),
  R('whoami', 'Permissions', 'Print your user name', 'whoami', [], [['whoami', 'who am I logged in as?']]),
  R('id', 'Permissions', 'Show your user and group IDs', 'id', [], [['id', 'user, group and memberships']]),
  R('groups', 'Permissions', 'Show the groups you belong to', 'groups', [], [['groups', 'list group memberships']]),

  // ---------- Processes ----------
  R('ps', 'Processes', 'List running programs (processes)', 'ps [aux]', [['aux', 'all processes of all users, with details']], [['ps', 'processes started from this terminal'], ['ps aux', 'everything that is running'], ['ps aux | grep python', 'find one program']]),
  R('top', 'Processes', 'Live view of running processes', 'top', [], [['top', 'watch CPU and memory use (q quits)']]),
  R('htop', 'Processes', 'A friendlier, colourful top', 'htop', [], [['htop', 'interactive process viewer (q quits)']], { pkg: 'htop' }),
  R('kill', 'Processes', 'Stop a process by its ID', 'kill [-9] pid ...', [['-9', 'force-kill a process that ignores the polite request'], ['%1', 'refer to job number 1 instead of a PID']], [['kill 6100', 'ask process 6100 to stop'], ['kill -9 6100', 'force it'], ['kill %1', 'stop background job 1']]),
  R('killall', 'Processes', 'Stop processes by name', 'killall name', [], [['killall python3', 'stop every python3 process you own']]),
  R('pgrep', 'Processes', 'Find process IDs by name', 'pgrep name', [], [['pgrep python', 'PIDs of matching processes']]),
  R('pkill', 'Processes', 'Stop processes whose name matches', 'pkill name', [], [['pkill python', 'stop matching processes']]),
  R('jobs', 'Processes', 'List programs running in the background of this shell', 'jobs', [], [['jobs', 'background and suspended jobs']]),
  R('fg', 'Processes', 'Bring a background job to the foreground', 'fg [%n]', [], [['fg', 'continue the most recent job'], ['fg %2', 'continue job 2']]),
  R('bg', 'Processes', 'Let a suspended job continue in the background', 'bg [%n]', [], [['bg', 'resume the job you suspended with Ctrl+Z']]),
  R('sleep', 'Processes', 'Wait for a number of seconds', 'sleep seconds', [], [['sleep 5', 'pause for 5 seconds'], ['sleep 60 &', 'the same, but in the background']]),
  R('uptime', 'Processes', 'How long the computer has been running, and its load', 'uptime', [], [['uptime', 'running time and load averages']]),
  R('systemctl', 'Processes', 'Control background services on Linux', 'systemctl action service', [['status', 'is it running?'], ['start / stop / restart', 'control it (needs sudo)'], ['enable / disable', 'start automatically at boot or not']], [['systemctl status nginx', 'check a service'], ['sudo systemctl restart nginx', 'restart it']], { os: 'linux' }),
  R('free', 'Processes', 'Show memory usage', 'free [-h]', [['-h', 'readable sizes']], [['free -h', 'how much RAM is in use?']], { os: 'linux' }),

  // ---------- Shell and environment ----------
  R('export', 'Shell', 'Set a variable that programs you start can see', 'export NAME=value', [], [['export EDITOR=vim', 'set a variable'], ['export PATH="$HOME/bin:$PATH"', 'add a folder to the search path']]),
  R('unset', 'Shell', 'Remove a variable', 'unset NAME', [], [['unset EDITOR', 'forget the variable']]),
  R('env', 'Shell', 'List environment variables', 'env', [], [['env', 'show all exported variables'], ['env | grep PATH', 'find one']]),
  R('printenv', 'Shell', 'Print environment variables', 'printenv [NAME]', [], [['printenv HOME', 'value of one variable']]),
  R('alias', 'Shell', 'Give a command a short nickname', "alias name='command'", [], [["alias ll='ls -la'", 'define a shortcut'], ['alias', 'list all aliases']], { note: 'Aliases vanish when the terminal closes, unless you put them in your shell config file (~/.zshrc or ~/.bashrc).' }),
  R('unalias', 'Shell', 'Remove an alias', 'unalias name', [], [['unalias ll', 'remove the shortcut']]),
  R('source', 'Shell', 'Run the commands of a file in the current shell', 'source file', [], [['source ~/.zshrc', 'reload your config after editing (macOS)'], ['source ~/.bashrc', 'the same on Linux']]),
  R('clear', 'Shell', 'Clear the screen', 'clear', [], [['clear', 'same as pressing Ctrl+L']]),
  R('exit', 'Shell', 'Close the shell (or leave an ssh session)', 'exit', [], [['exit', 'log out']]),
  R('date', 'Shell', 'Print the date and time', 'date', [], [['date', 'now']]),
  R('cal', 'Shell', 'Print a calendar', 'cal', [], [['cal', 'this month']]),
  R('uname', 'Shell', 'Print system information', 'uname [-a]', [['-a', 'everything']], [['uname -a', 'kernel and machine type']]),
  R('hostname', 'Shell', 'Print the name of this computer', 'hostname', [], [['hostname', 'computer name']]),
  R('bash', 'Shell', 'Run a script with the bash shell', 'bash script.sh', [['-c "command"', 'run a command given as text']], [['bash hello.sh', 'run a script without making it executable']]),

  // ---------- Packages ----------
  R('brew', 'Packages', 'Homebrew: install software on macOS', 'brew command [name ...]', [['install NAME', 'install a package'], ['install --cask NAME', 'install a graphical app'], ['uninstall NAME', 'remove a package'], ['list', 'what is installed?'], ['search TEXT', 'find packages'], ['info NAME', 'details about a package'], ['update', 'refresh the list of available software'], ['upgrade', 'update installed packages'], ['doctor', 'check for problems']], [['brew install tree', 'install the tree command'], ['brew search grep', 'look for packages'], ['brew list', 'installed packages'], ['brew upgrade', 'update everything']], { os: 'mac', note: 'Never run brew with sudo.' }),
  R('apt', 'Packages', 'Install software on Ubuntu/Debian Linux', 'apt command [name ...]', [['update', 'refresh the list of available software (sudo)'], ['install NAME', 'install a package (sudo)'], ['remove NAME', 'remove a package (sudo)'], ['upgrade', 'update installed packages (sudo)'], ['search TEXT', 'find packages'], ['show NAME', 'details about a package'], ['list --installed', 'what is installed?']], [['sudo apt update', 'always do this first'], ['sudo apt install tree', 'install the tree command'], ['apt search ripgrep', 'look for packages'], ['sudo apt remove tree', 'uninstall']], { os: 'linux', note: 'Changing installed software needs sudo; searching and showing does not.' }),

  // ---------- Network ----------
  R('ping', 'Network', 'Check whether a computer answers', 'ping [-c count] host', [['-c N', 'stop after N packets']], [['ping -c 3 example.com', 'three test packets'], ['ping example.com', 'keep going until Ctrl+C']], { note: { linux: 'Runs until you press Ctrl+C unless you pass -c.', mac: 'Runs until you press Ctrl+C unless you pass -c.' } }),
  R('curl', 'Network', 'Fetch a URL and print it', 'curl [options] url', [['-o FILE', 'save to FILE'], ['-O', 'save under the remote file name'], ['-L', 'follow redirects'], ['-I', 'show only the response headers'], ['-s', 'silent: no progress meter']], [['curl https://example.com', 'print a web page'], ['curl -O https://files.example.com/notes.txt', 'download a file'], ['curl -s https://api.example.com/users | jq .', 'fetch JSON and format it']], { help: true }),
  R('wget', 'Network', 'Download files', 'wget [-O file] url', [['-O FILE', 'save as FILE'], ['-q', 'quiet']], [['wget https://files.example.com/data.csv', 'download into the current folder']], { pkg: 'wget' }),
  R('ssh', 'Network', 'Log in to another computer', 'ssh user@host', [], [['ssh you@server.example.com', 'open a remote shell (exit to leave)']]),
  R('scp', 'Network', 'Copy files to or from another computer', 'scp [-r] source destination', [['-r', 'copy folders']], [['scp notes.txt you@server.example.com:~/', 'upload a file'], ['scp you@server.example.com:~/welcome.txt .', 'download a file']]),
  R('ifconfig', 'Network', 'Show network interfaces and IP addresses', 'ifconfig', [], [['ifconfig', 'list interfaces']], { os: 'mac' }),
  R('ip', 'Network', 'Show network interfaces and IP addresses', 'ip a', [], [['ip a', 'list interfaces and addresses']], { os: 'linux' }),

  // ---------- Archives ----------
  R('tar', 'Archives', 'Pack and unpack .tar and .tar.gz archives', 'tar -czf archive.tar.gz folder | tar -xzf archive.tar.gz', [['-c', 'create an archive'], ['-x', 'extract an archive'], ['-t', 'list the contents'], ['-z', 'compress with gzip (.tar.gz)'], ['-f FILE', 'the archive file (always needed)'], ['-v', 'list files while working'], ['-C DIR', 'extract into DIR']], [['tar -czf backup.tar.gz Documents', 'pack a folder'], ['tar -tzf backup.tar.gz', 'look inside'], ['tar -xzf backup.tar.gz', 'unpack here']], { help: true }),
  R('zip', 'Archives', 'Create .zip archives', 'zip -r archive.zip folder', [['-r', 'include folders']], [['zip -r photos.zip Pictures', 'pack a folder']], { help: true }),
  R('unzip', 'Archives', 'Unpack .zip archives', 'unzip archive.zip', [['-l', 'only list the contents']], [['unzip photos.zip', 'unpack here']], { help: true }),

  // ---------- Git ----------
  R('git', 'Git', 'Track versions of your files', 'git command [options]', [['init', 'start tracking the current folder'], ['status', 'what changed?'], ['add FILE', 'stage changes for the next commit'], ['commit -m "msg"', 'save a snapshot'], ['log --oneline', 'history, one line per commit'], ['diff', 'unstaged changes, line by line'], ['branch', 'list branches'], ['switch -c NAME', 'create and switch to a branch'], ['switch NAME', 'switch branches'], ['merge NAME', 'bring another branch into this one'], ['clone URL', 'download a repository']], [['git init', 'start a repository'], ['git add .', 'stage everything'], ['git commit -m "First version"', 'commit'], ['git status', 'check where you are'], ['git log --oneline', 'short history']], { help: true }),

  // ---------- Modern tools ----------
  R('rg', 'Modern tools', 'ripgrep: very fast recursive search (a modern grep)', 'rg [options] pattern [path]', [['-i', 'ignore case'], ['-l', 'only list files'], ['-w', 'whole words'], ['--hidden', 'also search hidden files']], [['rg TODO', 'search the current folder recursively'], ['rg -i error logs', 'case-insensitive, in one folder']], { pkg: 'ripgrep' }),
  R('fd', 'Modern tools', 'A simple, fast find', 'fd [options] [pattern] [path]', [['-e EXT', 'by file extension'], ['-t f|d', 'files / folders only'], ['-H', 'include hidden files']], [['fd notes', 'names containing "notes"'], ['fd -e txt', 'all .txt files']], { pkg: 'fd', note: { linux: 'On Ubuntu the package is `fd-find` and the command is `fdfind`.' } }),
  R('bat', 'Modern tools', 'cat with line numbers and a nicer layout', 'bat file ...', [], [['bat notes.txt', 'view a file']], { pkg: 'bat', note: { linux: 'On Ubuntu the command is installed as `batcat`.' } }),
  R('eza', 'Modern tools', 'A modern ls with colours and a tree view', 'eza [options] [path ...]', [['-l', 'long format'], ['-a', 'hidden files too'], ['-T', 'tree view'], ['-L n', 'tree depth']], [['eza -la', 'detailed listing'], ['eza -T -L 2', 'two-level tree']], { pkg: 'eza' }),
  R('fzf', 'Modern tools', 'Fuzzy finder: pick from a list by typing a few letters', 'fzf', [], [['fzf', 'pick a file below the current folder'], ['history | fzf', 'pick from your command history'], ['vim $(fzf)', 'open the picked file in vim']], { pkg: 'fzf' }),
  R('jq', 'Modern tools', 'Read and transform JSON', "jq 'filter' [file]", [['.', 'the whole input, nicely formatted'], ['.name', 'one field'], ['.[0]', 'first array element'], ['.[]', 'every array element'], ['-r', 'raw strings, without quotes']], [["jq . data.json", 'pretty-print'], ["jq '.[].name' users.json", 'the name of every user'], ["curl -s https://api.example.com/users | jq '.[0]'", 'first item of an API answer']], { pkg: 'jq' }),
  R('zoxide', 'Modern tools', 'A smarter cd that remembers the folders you use', 'z part-of-name', [], [['z web', 'jump to the most used folder matching "web"'], ['zoxide query -l', 'list remembered folders']], { pkg: 'zoxide', note: 'After installing, add `eval "$(zoxide init zsh)"` (or bash) to your shell config. That creates the `z` command.' }),
  R('cowsay', 'Modern tools', 'A cow that says things. Just for fun.', 'cowsay text', [], [['cowsay hello', 'moo']], { pkg: 'cowsay' }),

  // ---------- Editors ----------
  R('vi', 'Editors', 'The vi/vim text editor, available on practically every system', 'vi [file]', [], [['vi notes.txt', 'open or create a file'], [':wq', 'inside vi: save and quit'], [':q!', 'inside vi: quit without saving']], { note: 'vi starts in Normal mode. Press i to type text, Esc to stop typing, then :wq and Enter to save and quit.' }),
  R('vim', 'Editors', 'Vi IMproved: the modern vi', 'vim [file]', [], [['vim notes.txt', 'open or create a file']], { note: 'Same keys as vi. See the vi tab in the Reference.' }),
  R('nano', 'Editors', 'A simple editor that shows its shortcuts at the bottom', 'nano [file]', [], [['nano notes.txt', 'open or create a file']], { note: 'Ctrl+O then Enter saves, Ctrl+X exits. ^ in the help bar means Ctrl.' }),

  // ---------- macOS only ----------
  R('open', 'macOS', 'Open a file, folder or URL with its default app', 'open [-a app] target', [['-a APP', 'open with a specific app']], [['open .', 'show the current folder in Finder'], ['open report.pdf', 'open with the default app'], ['open https://example.com', 'open in the browser']], { os: 'mac' }),
  R('pbcopy', 'macOS', 'Copy text to the clipboard', 'command | pbcopy', [], [['cat notes.txt | pbcopy', 'copy a file\'s text'], ['pwd | pbcopy', 'copy the current path']], { os: 'mac' }),
  R('pbpaste', 'macOS', 'Print the clipboard', 'pbpaste', [], [['pbpaste > clip.txt', 'save the clipboard to a file']], { os: 'mac' }),
  R('say', 'macOS', 'Speak text aloud', 'say text', [], [['say hello', 'the computer talks']], { os: 'mac' }),
  R('sw_vers', 'macOS', 'Print the macOS version', 'sw_vers', [], [['sw_vers', 'product name and version']], { os: 'mac' }),

  // ---------- Linux only ----------
  R('xdg-open', 'Linux', 'Open a file, folder or URL with its default app', 'xdg-open target', [], [['xdg-open .', 'show the current folder in the file manager']], { os: 'linux' }),
  R('lsb_release', 'Linux', 'Print which Linux distribution this is', 'lsb_release -a', [['-a', 'all information']], [['lsb_release -a', 'distribution and version']], { os: 'linux' }),
];

export const REFMAP = Object.fromEntries(REF.map(r => [r.name, r]));
export const CATS = [...new Set(REF.map(r => r.cat))];

// Notes can be a string or { mac, linux }.
export const noteFor = (r, os) => (typeof r.note === 'string' ? r.note : r.note?.[os] || '');

export const SYNTAX = [
  ['~', 'your home folder', 'cd ~/Documents'],
  ['.', 'the current folder', 'cp ~/notes.txt .'],
  ['..', 'the folder one level up', 'cd ..'],
  ['/', 'the root of the filesystem; also separates folders in a path', 'cd /'],
  ['*', 'wildcard: any characters', 'ls *.txt'],
  ['?', 'wildcard: exactly one character', 'ls photo?.jpg'],
  ['{a,b}', 'expands to several words', 'mkdir -p site/{css,js}'],
  ['"…"', 'keeps spaces together; variables still work inside', 'cd "My Summer Trip"'],
  ["'…'", 'keeps everything literal', "echo 'costs $5'"],
  ['\\', 'takes away the special meaning of the next character', 'cd My\\ Summer\\ Trip'],
  ['>', 'send output into a file, replacing its content', 'echo hi > file.txt'],
  ['>>', 'append output to the end of a file', 'echo more >> file.txt'],
  ['<', 'read input from a file', 'sort < names.txt'],
  ['2>', 'send error messages into a file', 'ls nope 2> errors.txt'],
  ['2>&1', 'send errors to the same place as normal output', 'cmd > all.txt 2>&1'],
  ['|', 'pipe: feed the output of one command into the next', 'ls | wc -l'],
  ['&&', 'run the next command only if the first succeeded', 'mkdir new && cd new'],
  ['||', 'run the next command only if the first failed', 'cd nope || echo "missing"'],
  [';', 'run commands one after another', 'cd ~; ls'],
  ['&', 'run a command in the background', 'sleep 30 &'],
  ['$NAME', 'the value of a variable', 'echo $HOME'],
  ['$(…)', 'insert the output of a command', 'echo "Today is $(date)"'],
  ['!!', 'the previous command', 'sudo !!'],
  ['#', 'the rest of the line is a comment', 'ls  # list files'],
];

export const SHORTCUTS = [
  ['Tab', 'complete a command or file name; press again to see the choices'],
  ['↑ / ↓', 'step through earlier commands'],
  ['Ctrl+R', 'search your command history as you type'],
  ['Ctrl+A', 'jump to the start of the line'],
  ['Ctrl+E', 'jump to the end of the line'],
  ['Option+← / →', 'move one word left or right (Alt on Linux)'],
  ['Ctrl+U', 'delete from the cursor back to the start of the line'],
  ['Ctrl+K', 'delete from the cursor to the end of the line'],
  ['Ctrl+W', 'delete the word before the cursor'],
  ['Ctrl+Y', 'paste back what Ctrl+U / K / W deleted'],
  ['Ctrl+L', 'clear the screen'],
  ['Ctrl+C', 'cancel the current line or stop the running program'],
  ['Ctrl+D', 'end of input; on an empty line it closes the shell'],
  ['Ctrl+Z', 'suspend the running program (resume with fg or bg)'],
];

export const VIKEYS = [
  ['Modes', [['i', 'insert before the cursor'], ['a', 'insert after the cursor'], ['A', 'insert at the end of the line'], ['I', 'insert at the start of the line'], ['o / O', 'open a new line below / above'], ['Esc', 'back to Normal mode'], ['v / V', 'select characters / whole lines'], [':', 'command line (for :w, :q …)']]],
  ['Save and quit', [[':w', 'save'], [':q', 'quit'], [':wq  or  ZZ', 'save and quit'], [':q!', 'quit and throw away changes'], [':w name', 'save under another name']]],
  ['Move', [['h j k l', 'left, down, up, right (arrow keys work too)'], ['w / b', 'next / previous word'], ['e', 'end of word'], ['0 / $', 'start / end of line'], ['^', 'first non-blank character'], ['gg / G', 'first / last line'], ['5G  or  :5', 'go to line 5'], ['Ctrl+F / Ctrl+B', 'page down / up'], ['%', 'matching bracket']]],
  ['Edit', [['x', 'delete the character under the cursor'], ['dd', 'delete (cut) the line'], ['dw', 'delete to the next word'], ['D', 'delete to the end of the line'], ['cw', 'change a word'], ['cc', 'change the whole line'], ['r', 'replace one character'], ['yy', 'copy (yank) the line'], ['p / P', 'paste after / before'], ['u', 'undo'], ['Ctrl+R', 'redo'], ['.', 'repeat the last change'], ['J', 'join the next line onto this one'], ['>> / <<', 'indent / unindent the line']]],
  ['Counts', [['3dd', 'delete 3 lines'], ['5j', 'move 5 lines down'], ['2w', 'two words forward'], ['d3w', 'delete three words']]],
  ['Search and replace', [['/word', 'search forward'], ['?word', 'search backward'], ['n / N', 'next / previous match'], [':s/old/new/', 'replace in this line'], [':%s/old/new/g', 'replace in the whole file'], [':set hlsearch', 'highlight matches'], [':noh', 'hide the highlighting']]],
  ['Options', [[':set number', 'show line numbers'], [':set nonumber', 'hide them'], [':help', 'help']]],
];

export const NANOKEYS = [
  ['Ctrl+O, Enter', 'save ("write Out")'],
  ['Ctrl+X', 'exit (asks to save if needed)'],
  ['Ctrl+W', 'search'],
  ['Ctrl+K', 'cut the current line'],
  ['Ctrl+U', 'paste the cut line'],
  ['Ctrl+A / Ctrl+E', 'start / end of line'],
  ['Ctrl+C', 'cancel a question'],
];
