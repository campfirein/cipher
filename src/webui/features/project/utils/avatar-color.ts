const AVATAR_COLORS = [
  '#e0c4f4',
  '#a1ded2',
  '#d9d9d9',
  '#ffcdc2',
  '#c1d0ff',
  '#b2ddb5',
  '#d8d0bf',
  '#f3d673',
  '#c2da91',
  '#ffc182',
]

export function avatarColor(path: string): string {
  let hash = 0
  for (let i = 0; i < path.length; i++) {
    const code = path.codePointAt(i) ?? 0
    hash = Math.abs(Math.trunc(hash * 31 + code))
  }

  return AVATAR_COLORS[hash % AVATAR_COLORS.length]
}
