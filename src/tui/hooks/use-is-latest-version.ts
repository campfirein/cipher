/**
 * Hook to check if current version is the latest
 *
 * Polls update-notifier cache periodically to detect new versions.
 */

import {useEffect, useState} from 'react'
import updateNotifier from 'update-notifier'

const CHECK_INTERVAL_MS = 60 * 60 * 1000 // 1 hour

export function useIsLatestVersion(version: string): boolean {
  const [isLatestVersion, setIsLatestVersion] = useState(true)

  useEffect(() => {
    const checkUpdate = () => {
      const notifier = updateNotifier({pkg: {name: 'byterover-cli', version}})
      const isLatest = !notifier.update || notifier.update.latest === version
      setIsLatestVersion(isLatest)
    }

    checkUpdate()

    const interval = setInterval(checkUpdate, CHECK_INTERVAL_MS)

    return () => clearInterval(interval)
  }, [version])

  return isLatestVersion
}
