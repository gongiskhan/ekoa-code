/**
 * File utilities for detecting file types and languages
 */

/**
 * Strip the absolute filesystem prefix from a sandbox path.
 * Converts e.g. `/Users/x/.ekoa/sandboxes/user-1/...` → `sandboxes/user-1/...`
 * so the UI never exposes the host filesystem root to the user.
 * The original full path should still be passed to backend read/write APIs.
 */
export function getSandboxDisplayPath(path: string): string {
  const idx = path.indexOf('/sandboxes/');
  return idx >= 0 ? path.slice(idx + 1) : path;
}

/**
 * Get the file extension from a filename
 */
function getExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot === -1 || lastDot === 0) return '';
  return filename.slice(lastDot).toLowerCase();
}

/**
 * Get the base filename from a path
 */
function getBasename(filepath: string): string {
  const parts = filepath.split(/[/\\]/);
  return parts[parts.length - 1] || '';
}

/**
 * Text file extensions that can be opened in the editor
 */
const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.html', '.htm', '.css', '.scss', '.sass', '.less',
  '.json', '.yaml', '.yml', '.toml', '.xml',
  '.env', '.env.local', '.env.development', '.env.production',
  '.md', '.mdx', '.txt', '.rst',
  '.sh', '.bash', '.zsh', '.fish', '.ps1', '.bat', '.cmd',
  '.py', '.pyi', '.pyw',
  '.rb', '.erb', '.rake',
  '.go', '.mod', '.sum',
  '.rs',
  '.java', '.kt', '.kts', '.gradle',
  '.c', '.cpp', '.cc', '.cxx', '.h', '.hpp', '.hxx',
  '.cs', '.csx',
  '.php', '.phtml',
  '.swift',
  '.sql', '.mysql', '.pgsql',
  '.graphql', '.gql',
  '.vue', '.svelte', '.astro',
  '.prisma',
  '.dockerfile',
  '.gitignore', '.gitattributes', '.editorconfig', '.prettierrc',
  '.eslintrc', '.babelrc', '.npmrc', '.nvmrc',
  '.lock', '.log',
]);

const TEXT_FILENAMES = new Set([
  'dockerfile', 'makefile', 'gemfile', 'rakefile', 'procfile',
  'brewfile', 'vagrantfile', 'jenkinsfile', 'license', 'readme',
  'changelog', 'authors', 'contributors', 'copying', 'todo', 'notes',
]);

/**
 * Check if a file can be opened in the text editor
 */
export function isTextFile(filename: string): boolean {
  const ext = getExtension(filename);
  const name = getBasename(filename).toLowerCase();

  if (ext && TEXT_EXTENSIONS.has(ext)) return true;
  if (!ext || ext === '') return TEXT_FILENAMES.has(name);
  if (name.endsWith('rc') && name.startsWith('.')) return true;

  return false;
}

/**
 * Get a display language label for a file
 */
export function getFileLanguage(filename: string): string {
  const ext = getExtension(filename);
  const name = getBasename(filename).toLowerCase();

  const languageMap: Record<string, string> = {
    '.ts': 'TypeScript', '.tsx': 'TypeScript', '.js': 'JavaScript',
    '.jsx': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript',
    '.json': 'JSON', '.html': 'HTML', '.htm': 'HTML',
    '.css': 'CSS', '.scss': 'SCSS', '.sass': 'SCSS', '.less': 'LESS',
    '.md': 'Markdown', '.mdx': 'Markdown',
    '.yaml': 'YAML', '.yml': 'YAML', '.xml': 'XML',
    '.sql': 'SQL', '.py': 'Python', '.pyi': 'Python',
    '.rb': 'Ruby', '.go': 'Go', '.rs': 'Rust',
    '.java': 'Java', '.kt': 'Kotlin', '.kts': 'Kotlin',
    '.c': 'C', '.cpp': 'C++', '.cc': 'C++', '.h': 'C',
    '.hpp': 'C++', '.cs': 'C#', '.php': 'PHP', '.swift': 'Swift',
    '.sh': 'Shell', '.bash': 'Shell', '.zsh': 'Shell',
    '.graphql': 'GraphQL', '.gql': 'GraphQL',
    '.vue': 'Vue', '.svelte': 'Svelte', '.astro': 'Astro',
    '.prisma': 'Prisma', '.dockerfile': 'Dockerfile',
    '.toml': 'TOML', '.env': 'Environment',
  };

  if (languageMap[ext]) return languageMap[ext];
  if (name === 'dockerfile') return 'Dockerfile';
  if (name === 'makefile') return 'Makefile';

  return 'Plain Text';
}

/**
 * Get Monaco Editor language identifier for a file
 */
export function getMonacoLanguage(filename: string): string {
  const ext = getExtension(filename);
  const name = getBasename(filename).toLowerCase();

  const monacoMap: Record<string, string> = {
    '.ts': 'typescript', '.tsx': 'typescript', '.js': 'javascript',
    '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
    '.json': 'json', '.html': 'html', '.htm': 'html',
    '.css': 'css', '.scss': 'scss', '.sass': 'scss', '.less': 'less',
    '.md': 'markdown', '.mdx': 'markdown',
    '.yaml': 'yaml', '.yml': 'yaml', '.xml': 'xml',
    '.sql': 'sql', '.mysql': 'sql', '.pgsql': 'pgsql',
    '.py': 'python', '.pyi': 'python', '.pyw': 'python',
    '.rb': 'ruby', '.go': 'go', '.rs': 'rust',
    '.java': 'java', '.kt': 'kotlin', '.kts': 'kotlin',
    '.c': 'c', '.cpp': 'cpp', '.cc': 'cpp', '.cxx': 'cpp',
    '.h': 'c', '.hpp': 'cpp', '.hxx': 'cpp',
    '.cs': 'csharp', '.csx': 'csharp',
    '.php': 'php', '.phtml': 'php',
    '.swift': 'swift',
    '.sh': 'shell', '.bash': 'shell', '.zsh': 'shell',
    '.bat': 'bat', '.cmd': 'bat', '.ps1': 'powershell',
    '.graphql': 'graphql', '.gql': 'graphql',
    '.dockerfile': 'dockerfile',
    '.toml': 'ini', '.env': 'ini',
  };

  if (monacoMap[ext]) return monacoMap[ext];
  if (name === 'dockerfile') return 'dockerfile';
  if (name === 'makefile') return 'shell';

  return 'plaintext';
}
