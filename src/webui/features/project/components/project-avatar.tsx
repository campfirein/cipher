import {cn} from '@campfirein/byterover-packages/lib/utils'

import {initials} from '../../../utils/initials'
import {avatarColor} from '../utils/avatar-color'

type ProjectAvatarSize = 'lg' | 'md' | 'sm'

const SIZE_CLASS: Record<ProjectAvatarSize, string> = {
  lg: 'size-7 text-xs',
  md: 'size-6 text-xs',
  sm: 'size-5 text-[10px]',
}

type ProjectAvatarProps = {
  /** Display name used to derive the initials. */
  name: string
  /** Stable identifier hashed to pick the gradient. Defaults to `name`. */
  seed?: string
  size?: ProjectAvatarSize
}

export function ProjectAvatar({name, seed, size = 'md'}: ProjectAvatarProps) {
  return (
    <span
      className={cn(
        'relative flex shrink-0 items-center justify-center overflow-hidden rounded font-extrabold leading-4',
        'before:absolute before:inset-0 before:bg-black/10 before:content-[""]',
        SIZE_CLASS[size],
        avatarColor(seed ?? name),
      )}
    >
      <span className="relative">{initials(name)}</span>
    </span>
  )
}
