# Terminal Trainer

Practise the macOS and Linux command line in a simulated terminal that runs in your browser.
Nothing you type touches your real files, so you can try `rm -rf`, `sudo` and `vi` without risk.

- **Two systems**: macOS (zsh, Homebrew) and Ubuntu Linux (bash, apt), with the differences in prompts, error messages and tools that the real systems have.
- **31 guided lessons** in 12 topics, from `ls` to pipes, vi, permissions, processes, packages, ssh and git.
- **A coach** that explains every error in plain language and shows how it is usually done. The terminal output itself stays exactly as a real shell prints it.
- **vi, nano and less** as full-screen programs, with a strip that shows the current mode and the most useful keys.
- **Sandbox** for free practice, **Review** drills with spaced repetition, and a searchable **Reference**.

## Run it

You need [Node.js](https://nodejs.org) 22 or newer. There is nothing to install.

```sh
npm start
```

Then open <http://localhost:5173>. To use another port: `PORT=8080 npm start`.

The app is a static site. `server.js` only serves the files (browsers do not load JavaScript modules from `file://`), so any other static file server works too.

## Using it

| Area | What it is for |
| --- | --- |
| **Learn** | Step-by-step lessons. The current task is shown above the terminal. Type `hint` (or press the button) when stuck, `next` to move on. All lessons are unlocked. |
| **Sandbox** | An open terminal with no task. Your files are kept between visits. |
| **Review** | Eight short tasks from lessons you finished. Tasks you miss come back sooner. |
| **Reference** | Every command with options and examples, plus shell syntax, keyboard shortcuts and a vi cheat sheet. Clicking an example puts it on the command line. |
| **macOS / Linux** | Switches the simulated system. Progress is tracked separately for each. |

Keys worth knowing from the start: `Tab` completes names, `↑` recalls commands, `Ctrl+C` cancels, `q` leaves pagers, and `Esc` then `:q!` leaves vi. `F6` or `Shift+Tab` moves the keyboard focus out of the terminal.

`sudo` and `ssh` accept any password. **Never type a real password into the trainer.**

## What is simulated

About 120 commands, grouped as in the Reference:

- Navigation and files: `pwd cd ls mkdir touch cp mv rm rmdir ln readlink realpath cat less head tail wc file stat du df tree`
- Text: `grep find sort uniq cut tr sed awk diff tee xargs`
- Shell: quoting, `$VAR`, `$(...)`, globs, `{a,b}`, `> >> < 2> |`, `&& || ; &`, history (`!!`), aliases, `export`, `PATH`, startup files
- Permissions and processes: `chmod chown sudo ps top kill jobs fg bg`, `Ctrl+C`, `Ctrl+Z`
- Packages: `brew` (including installing Homebrew itself) and `apt`
- Network: `ping curl wget ssh scp tar zip unzip` against a small pretend internet
- `git`: init, status, add, commit, log, diff, branch, switch, merge (with conflicts), stash, clone
- Modern tools, after installing them: `rg fd bat eza fzf jq tldr zoxide htop`
- Editors: `vi`/`vim` (modes, motions, operators, counts, visual mode, search, `:s`, undo, `.`), `nano`

It is a teaching simulation, not an emulator. Each command supports its commonly used options, not all of them. Shell scripting constructs (`if`, `for`, functions) are not implemented, and there is no real network or real process behind anything.

## Project layout

```
index.html            page structure
css/styles.css        design tokens (light/dark, per-OS terminal colours), layout, components
server.js             static file server for local use
js/
  app.js              wires everything together: modes, lesson progress, panels, settings
  store.js            saved settings and progress (localStorage), spaced-repetition scheduling
  ui/terminal.js      terminal emulator: output, line editing, history, Tab, full-screen programs
  shell/              the simulated system; no DOM access, runs in Node as well
    index.js          public entry point (createShell)
    vfs.js            in-memory filesystem with owners, permission bits, symlinks
    parser.js         command-line parser (quotes, operators, pipelines)
    shell.js          expansion, redirection, pipes, jobs, completion
    registry.js       command registry
    fixtures.js       starting files for macOS, Linux and the pretend server
    packages.js       catalogue for brew and apt
    coach.js          explanations for errors and teaching tips
    util.js           shared helpers (option parsing, formatting, diff, regex translation)
    commands/         files, text, system, editors, pkg, net, git, modern
  editors/            vi.js, nano.js, pager.js: pure models that return what to draw
  lessons/            lessons.js (the course), drills.js (review tasks), checks.js (step checks)
  data/reference.js   command documentation; also feeds man, --help, tldr and the coach
test/                 node:test suites
```

The dependency direction is one-way: `app.js` → `ui/` and `lessons/` → `shell/`, `editors/`, `data/`. The engine never imports UI code.

### How a command flows

1. `ui/terminal.js` collects a line and calls `shell.run(line)`.
2. `parser.js` turns it into pipelines; `shell.js` expands words, sets up redirections and looks the command up through `PATH` in the virtual filesystem.
3. The command implementation writes to its output and, on failure, records a structured error.
4. The shell emits an event. `coach.js` turns a recorded error into an explanation, and the current lesson step's `check(event)` decides whether the step is done.

### Adding a command

Register it in a file under `js/shell/commands/`:

```js
def('hello', c => {
  c.println(`Hello, ${c.args[0] || c.user.name}!`);
});
```

Add an entry to `js/data/reference.js` so it appears in the Reference, `man` and `help`.

### Adding a lesson step

Steps live in `js/lessons/lessons.js`. A step says what to do, gives one solution, and checks the result. Prefer checking the outcome over the exact text typed, so that every correct approach counts:

```js
S('Create a folder called `practice`.', 'mkdir practice', isDir('~/practice'), '`mkdir` means *make directory*.')
```

Then add the solution to the script in `test/lessons.test.js`.

## Tests and code style

```sh
npm test          # 92 tests, no dependencies
npm install       # only needed for linting
npm run lint
```

- `test/lessons.test.js` plays through every lesson and every review drill on both systems.
- `test/shell.test.js` covers parsing, expansion, pipes, permissions, OS differences, completion, git and the coach.
- `test/vi.test.js` covers the editors.

Code style: ES modules, no build step, no runtime dependencies, 2-space indentation (`.editorconfig`), ESLint recommended rules plus `eqeqeq`, `prefer-const` and `no-var` (`eslint.config.js`).

## Design and accessibility

- The terminal is the main element; the current task sits directly above it, so the eyes stay in one place.
- Trainer messages (coach, hints, step feedback) are visually distinct from simulated terminal output, so it is always clear what a real system would print.
- Light and dark themes follow the system setting and can be overridden. Text and status colours meet WCAG AA contrast.
- Everything is usable with the keyboard. The terminal captures `Tab` for completion, so `F6` and `Shift+Tab` leave it, and a skip link jumps to it.
- Terminal text size is adjustable; animations respect "reduce motion"; the layout works down to phone width, with an extra key row on touch screens.
- Output is exposed to screen readers as a live log.

## Known limitations

- On Windows and Linux browsers, `Ctrl+W`, `Ctrl+T` and `Ctrl+N` belong to the browser and cannot be captured. Use `Alt+Backspace` instead of `Ctrl+W`. macOS browsers are unaffected, because their shortcuts use `Cmd`.
- The interface has no automated browser tests in this repository; the engine, editors, lessons and drills do.
- Progress is stored in the browser, so it does not follow you to another browser or device.
