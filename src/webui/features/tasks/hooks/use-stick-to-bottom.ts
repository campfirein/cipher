import {type RefObject, useCallback, useLayoutEffect, useRef} from 'react'

/**
 * "Stick to bottom" pattern for live logs.
 *
 * Tracks whether the scroll container is at (or near) its bottom edge. When the
 * provided deps change AND the user is at the bottom, the scroll position is
 * auto-advanced to the new bottom. If the user has scrolled up to read older
 * content, auto-scroll backs off until they return to the bottom.
 */

const NEAR_BOTTOM_PX = 80

export function useStickToBottom<T extends HTMLElement>(
  deps: ReadonlyArray<unknown>,
  enabled = true,
): {onScroll: () => void; ref: RefObject<null | T>} {
  const ref = useRef<null | T>(null)
  const isAtBottom = useRef(true)

  const onScroll = useCallback(() => {
    const el = ref.current
    if (!el) return
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    isAtBottom.current = distance < NEAR_BOTTOM_PX
  }, [])

  useLayoutEffect(() => {
    if (!enabled) return
    const el = ref.current
    if (!el || !isAtBottom.current) return
    el.scrollTop = el.scrollHeight
  }, [enabled, ...deps])

  return {onScroll, ref}
}
