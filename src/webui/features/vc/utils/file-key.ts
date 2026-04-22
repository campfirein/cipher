import type {ChangeFile} from '../types'

export function fileBucket(file: ChangeFile): 'merge' | 'staged' | 'unstaged' {
  if (file.status === 'unmerged') return 'merge'
  return file.isStaged ? 'staged' : 'unstaged'
}

export function fileKey(file: ChangeFile): string {
  return `${fileBucket(file)}:${file.path}`
}
