/**
 * Default ignore patterns for folder packing.
 * These patterns are applied by default to exclude common
 * non-essential files from packed output.
 */
export const DEFAULT_IGNORE_PATTERNS: readonly string[] = [
  // Version control
  '.git/**',
  '.svn/**',
  '.hg/**',
  '.bzr/**',

  // Dependencies
  'node_modules/**',
  'vendor/**',
  '.venv/**',
  'venv/**',
  'env/**',
  '__pycache__/**',
  '.pip/**',
  'bower_components/**',

  // Build outputs
  'dist/**',
  'build/**',
  'out/**',
  'target/**',
  '.next/**',
  '.nuxt/**',
  '.output/**',
  'coverage/**',
  '.coverage/**',
  '.nyc_output/**',

  // Cache directories
  '.cache/**',
  'cache/**',
  '.parcel-cache/**',
  '.turbo/**',
  '.zig-cache/**',
  'zig-out/**',
  'tmp/**',
  'temp/**',

  // IDE and editor
  '.idea/**',
  '.vscode/**',
  '*.swp',
  '*.swo',
  '*~',
  '.project',
  '.classpath',
  '.settings/**',

  // OS files
  '.DS_Store',
  'Thumbs.db',
  'desktop.ini',
  '*.lnk',

  // Byterover specific
  '.brv/**',
  '.byterover/**',

  // Lock files (often large and not useful for context)
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'composer.lock',
  'Gemfile.lock',
  'poetry.lock',
  'Cargo.lock',

  // Binary and compiled files
  '*.exe',
  '*.dll',
  '*.so',
  '*.dylib',
  '*.o',
  '*.obj',
  '*.class',
  '*.pyc',
  '*.pyo',

  // Archives
  '*.zip',
  '*.tar',
  '*.tar.gz',
  '*.tgz',
  '*.rar',
  '*.7z',

  // Media files (unless specifically needed)
  '*.jpg',
  '*.jpeg',
  '*.png',
  '*.gif',
  '*.ico',
  '*.svg',
  '*.webp',
  '*.mp3',
  '*.mp4',
  '*.wav',
  '*.avi',
  '*.mov',

  // Fonts
  '*.woff',
  '*.woff2',
  '*.ttf',
  '*.eot',
  '*.otf',

  // Minified files
  '*.min.js',
  '*.min.css',
  '*.map',

  // Logs
  '*.log',
  'logs/**',

  // Environment files (security)
  '.env',
  '.env.local',
  '.env.*.local',
  '*.pem',
  '*.key',
  '*.crt',
  '*.p12',
  '*.pfx',
] as const

/**
 * Returns the default ignore patterns as a mutable array.
 * Use this when you need to modify or extend the patterns.
 */
export function getDefaultIgnorePatterns(): string[] {
  return [...DEFAULT_IGNORE_PATTERNS]
}
