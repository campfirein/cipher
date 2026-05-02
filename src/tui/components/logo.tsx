/**
 * Adaptive Logo Component
 *
 * Renders ASCII logo or text logo based on terminal dimensions.
 * - Large terminals (>= 60w, >= 20h): Full ASCII logo
 * - Minimal terminals: Text-only logo
 */

import {Box, Text, useStdout} from 'ink'
import React, {useMemo} from 'react'

import {useIsLatestVersion, useTheme} from '../hooks/index.js'

/**
 * Full ASCII logo "ByteRover" for large terminals
 */
const LOGO_FULL = [
  '░█▀▄░█░█░▀█▀░█▀▀░█▀▄░█▀█░█░█░█▀▀░█▀▄',
  '░█▀▄░░█░░░█░░█▀▀░█▀▄░█░█░▀▄▀░█▀▀░█▀▄',
  '░▀▀░░░▀░░░▀░░▀▀▀░▀░▀░▀▀▀░░▀░░▀▀▀░▀░▀',
]

const MINI_LOGO = 'brv'

interface PaddedLine {
  content: string
  padEnd: string
  padStart: string
}

interface HeaderLine {
  brv: string
  padEnd: string
  padStart: string
  spaces: string
  version: string
}

const PAD_START = '///// '

/**
 * Calculate padding end string to fill remaining width
 */
function calculatePadEnd(contentLength: number, terminalWidth: number): string {
  const availableWidth = terminalWidth
  const padEndLength = availableWidth - PAD_START.length - contentLength - 1
  return padEndLength > 0 ? ' ' + '/'.repeat(padEndLength) : ''
}

/**
 * Get header line with BRV and version
 */
function getHeaderLine(logoLine: string, version: string, terminalWidth: number): HeaderLine {
  const logoLength = [...logoLine].length
  const brv = ''
  const versionText = version ? `v${version}` : ''

  // Spaces between BRV and version to match logo width
  const spacesLength = logoLength - brv.length - versionText.length
  const spaces = spacesLength > 0 ? ' '.repeat(spacesLength) : ' '

  const contentLength = brv.length + spaces.length + versionText.length
  const padEnd = calculatePadEnd(contentLength, terminalWidth)

  return {brv, padEnd, padStart: PAD_START, spaces, version: versionText}
}

/**
 * Get padded logo lines with '/' - 5 at start, fill rest to terminal width
 */
function getPaddedLogoLines(lines: string[], terminalWidth: number): PaddedLine[] {
  return lines.map((line) => {
    const lineLength = [...line].length // Handle unicode characters
    const padEnd = calculatePadEnd(lineLength, terminalWidth)

    return {content: line, padEnd, padStart: PAD_START}
  })
}

type LogoVariant = 'full' | 'text'

/**
 * Select the best logo variant based on terminal size
 */
function selectLogoVariant(width: number, height: number): LogoVariant {
  // Full logo needs >= 60 width, >= 20 height
  if (width >= 60 && height >= 20) {
    return 'full'
  }

  // Fall back to text-only
  return 'text'
}

/**
 * Get logo lines for variant
 */
function getLogoLines(variant: LogoVariant, terminalWidth: number): PaddedLine[] {
  switch (variant) {
    case 'full': {
      return getPaddedLogoLines(LOGO_FULL, terminalWidth)
    }

    default: {
      return []
    }
  }
}

interface LogoProps {
  /**
   * Compact mode, only show text logo
   */
  compact?: boolean
  /**
   * Daemon version to surface inline as a drift indicator. Pass undefined when
   * the local CLI and the running daemon agree on version (or the daemon is
   * too old to advertise its version) so the indicator stays hidden.
   */
  driftDaemonVersion?: string
  /**
   * Optional version to display
   */
  version?: string
}

/**
 * Adaptive Logo Component
 *
 * Automatically selects the best logo variant based on terminal dimensions.
 */
export const Logo: React.FC<LogoProps> = ({compact, driftDaemonVersion, version}) => {
  const {stdout} = useStdout()
  const {
    theme: {colors},
  } = useTheme()
  const isLatestVersion = useIsLatestVersion(version ?? '')

  const terminalWidth = stdout?.columns ?? 80
  const terminalHeight = stdout?.rows ?? 24

  const variant = useMemo(
    () => (compact ? 'text' : selectLogoVariant(terminalWidth, terminalHeight)),
    [compact, terminalWidth, terminalHeight],
  )

  const logoLines = useMemo(() => getLogoLines(variant, terminalWidth), [variant, terminalWidth])

  // Inline drift token, e.g. " [outdated, daemon v3.99.0]". Empty when the
  // header has no daemon-version drift to surface — keeps the banner length
  // calculation symmetric with the no-drift case.
  const driftText = driftDaemonVersion ? ` [outdated, daemon v${driftDaemonVersion}]` : ''

  const headerLine = useMemo(() => {
    if (variant !== 'full' || !LOGO_FULL[0]) return null
    const base = getHeaderLine(LOGO_FULL[0], version ?? '', terminalWidth)
    if (!driftText) return base
    // Re-pad so the trailing `/////` fills the row after the drift token.
    const contentLength = base.brv.length + base.spaces.length + base.version.length + driftText.length
    return {...base, padEnd: calculatePadEnd(contentLength, terminalWidth)}
  }, [variant, version, terminalWidth, driftText])

  // Text-only logo for minimal terminals
  if (variant === 'text') {
    const textContent =
      MINI_LOGO + (version ? ` v${version}` : '') + (isLatestVersion ? ' (latest)' : '') + driftText
    const padEnd = calculatePadEnd(textContent.length, terminalWidth)

    return (
      <Box>
        <Text color={colors.primary}>{PAD_START}</Text>
        <Text>
          <Text bold color={colors.primary}>
            {MINI_LOGO}
          </Text>
          {version && <Text color={colors.primary}> v{version}</Text>}
          {isLatestVersion && <Text color={colors.primary}> (latest)</Text>}
          {driftText && <Text color={colors.warning}>{driftText}</Text>}
        </Text>
        <Text color={colors.primary}>{padEnd}</Text>
      </Box>
    )
  }

  // ASCII logo with header line and version
  return (
    <Box flexDirection="column">
      {headerLine && (
        <Box>
          <Text color={colors.primary}>{headerLine.padStart}</Text>
          <Text>
            <Text>{headerLine.brv}</Text>
            <Text>{headerLine.spaces}</Text>
            <Text color={colors.primary}>{headerLine.version}</Text>
            {driftText && <Text color={colors.warning}>{driftText}</Text>}
          </Text>
          <Text color={colors.primary}>{headerLine.padEnd}</Text>
        </Box>
      )}
      {logoLines.map((line, index) => (
        <Box key={index}>
          <Text color={colors.primary}>{line.padStart}</Text>
          <Text color={colors.primary}>{line.content}</Text>
          <Text color={colors.primary}>{line.padEnd}</Text>
        </Box>
      ))}
    </Box>
  )
}

/**
 * Export utilities for external use
 */
export {getLogoLines, selectLogoVariant}
export type {LogoVariant}
