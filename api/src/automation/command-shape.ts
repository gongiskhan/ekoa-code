/**
 * Compute a stable, normalized "command shape" signature from an argv
 * array. Used as the key for first-time consent approval lookups.
 *
 * Algorithm:
 *   - argv[0] is kept verbatim (the executable).
 *   - For each subsequent arg:
 *       • If it looks like a flag (-x, --long), keep verbatim.
 *       • If it looks like a URL, replace with <URL>.
 *       • If it contains a / or starts with ~, ends with a recognizable
 *         file extension, or is an absolute path — replace with <FILE>
 *         (or <DIR> for trailing-slash / known dir-shaped args).
 *       • Otherwise keep verbatim (subcommand names, constants).
 *   - Special case: `bash -c "<script>"` collapses to `bash -c <SCRIPT>`.
 *
 * Examples:
 *   ["cat", "/Users/g/Downloads/foo.txt"]    → "cat <FILE>"
 *   ["ls", "-la", "/Users/g/Downloads"]      → "ls -la <DIR>"
 *   ["git", "status"]                        → "git status"
 *   ["curl", "-s", "https://api.x.com/foo"]  → "curl -s <URL>"
 *   ["bash", "-c", "ls | wc -l"]             → "bash -c <SCRIPT>"
 *
 * Ported as-is from the old Cortex automation family (carryover-audit A8): pure, zero-import.
 */
export function computeCommandShape(argv: string[]): string {
  if (argv.length === 0) return '';
  const head = argv[0]!;

  // Special-case bash -c / sh -c / zsh -c — collapse the script body.
  if ((head === 'bash' || head === 'sh' || head === 'zsh') && argv[1] === '-c') {
    return `${head} -c <SCRIPT>`;
  }

  const parts = [head];
  for (let i = 1; i < argv.length; i++) {
    parts.push(normalizeArg(argv[i]!));
  }
  return parts.join(' ');
}

function normalizeArg(arg: string): string {
  if (arg.startsWith('-')) return arg;                      // flag

  if (/^https?:\/\//.test(arg)) return '<URL>';             // URL
  if (/^[a-z][a-z0-9+\-.]*:\/\//i.test(arg)) return '<URL>';

  if (arg.startsWith('~') || arg.startsWith('/') || arg.includes('/')) {
    if (arg.endsWith('/')) return '<DIR>';
    if (/\.[a-zA-Z0-9]{1,8}$/.test(arg)) return '<FILE>';
    // Heuristic: ends with a name and no extension → directory
    return '<DIR>';
  }

  if (/\.[a-zA-Z0-9]{1,8}$/.test(arg)) return '<FILE>';     // bare filename with ext

  return arg;                                               // subcommand / literal
}

/**
 * Produce a plain-English description of a command shape, suitable for
 * the consent dialog. Falls back to a generic phrasing when the head
 * isn't recognized.
 */
export function describeCommandShape(shape: string, argv: string[]): string {
  const head = argv[0] ?? '';
  const verbs: Record<string, string> = {
    cat: 'read a file',
    less: 'read a file',
    more: 'read a file',
    head: 'read the start of a file',
    tail: 'read the end of a file',
    ls: 'list a directory',
    find: 'search the filesystem',
    grep: 'search file contents',
    rg: 'search file contents',
    git: 'run a git command',
    npm: 'run an npm command',
    node: 'run a Node.js script',
    python: 'run a Python script',
    python3: 'run a Python script',
    curl: 'make an HTTP request',
    wget: 'download from a URL',
    open: 'open a file or app',
    osascript: 'run an AppleScript',
    pwsh: 'run a PowerShell command',
    powershell: 'run a PowerShell command',
    bash: 'run a shell script',
    sh: 'run a shell script',
    zsh: 'run a shell script',
    rm: 'delete a file',
    mv: 'move or rename a file',
    cp: 'copy a file',
    mkdir: 'create a directory',
    touch: 'create or update a file',
    echo: 'print text',
    awk: 'process text with awk',
    sed: 'edit text with sed',
  };

  const verb = verbs[head];
  void shape;
  if (verb) return `run \`${head}\` to ${verb}`;
  return `run the command \`${head}\``;
}
