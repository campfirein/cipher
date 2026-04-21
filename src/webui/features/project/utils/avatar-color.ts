// 10 distinctive top-left → bottom-right diagonal gradients matched to a reference palette.
// Text color is picked per-entry so small letters stay legible on both the
// bright and dark combos. Listed as literal strings so Tailwind JIT picks them up.
const AVATAR_CLASSES = [
  'bg-gradient-to-br from-red-600 to-red-500 text-white',
  'bg-gradient-to-br from-orange-400 to-pink-500 text-white',
  'bg-gradient-to-br from-teal-500 to-emerald-500 text-white',
  'bg-gradient-to-br from-blue-800 to-blue-600 text-white',
  'bg-gradient-to-br from-sky-400 to-sky-300 text-white',
  'bg-gradient-to-br from-purple-500 to-pink-500 text-white',
  'bg-gradient-to-br from-green-500 to-lime-300 text-white',
  'bg-gradient-to-br from-yellow-300 to-orange-400 text-white',
  'bg-gradient-to-br from-orange-500 to-red-600 text-white',
  'bg-gradient-to-br from-cyan-400 to-cyan-300 text-white',
]

export function avatarColor(path: string): string {
  let hash = 0
  for (let i = 0; i < path.length; i++) {
    const code = path.codePointAt(i) ?? 0
    hash = Math.abs(Math.trunc(hash * 31 + code))
  }

  return AVATAR_CLASSES[hash % AVATAR_CLASSES.length]
}
