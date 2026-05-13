/**
 * SettingsPage — interactive /settings view for the TUI.
 *
 * Browse mode: arrow keys move the cursor, Enter edits, R resets, Esc exits.
 * Edit mode: type a new integer, Enter saves through the transport, Esc
 * cancels. Validation errors from the daemon surface inline on the row.
 * After any successful save, a restart banner appears at the top.
 */

import {Box, Text, useInput} from 'ink'
import Spinner from 'ink-spinner'
import React, {useCallback, useMemo, useState} from 'react'

import type {CustomDialogCallbacks} from '../../../types/commands.js'

import {useTheme} from '../../../hooks/index.js'
import {useGetSettings, useResetSetting, useSetSetting} from '../api/settings-api.js'
import {buildSettingsRows, type SettingsRow, validateSettingInput} from '../utils/format-settings.js'

type Mode = 'browse' | 'edit' | 'saving'

export function SettingsPage({onCancel, onComplete}: CustomDialogCallbacks): React.ReactNode {
  const {data, error, isLoading} = useGetSettings()
  const setMutation = useSetSetting()
  const resetMutation = useResetSetting()
  const {
    theme: {colors},
  } = useTheme()

  const [cursor, setCursor] = useState(0)
  const [mode, setMode] = useState<Mode>('browse')
  const [editBuffer, setEditBuffer] = useState('')
  const [rowError, setRowError] = useState<string | undefined>()
  const [dirtyKeys, setDirtyKeys] = useState<ReadonlySet<string>>(new Set())

  const rows = useMemo<SettingsRow[]>(() => (data ? buildSettingsRows(data.items) : []), [data])

  const enterEdit = useCallback(
    (row: SettingsRow) => {
      setEditBuffer(String(row.current))
      setRowError(undefined)
      setMode('edit')
    },
    [],
  )

  const commitEdit = useCallback(
    async (row: SettingsRow, raw: string) => {
      const localError = validateSettingInput(raw, {max: row.max, min: row.min})
      if (localError !== undefined) {
        setRowError(localError)
        return
      }

      setMode('saving')
      setRowError(undefined)
      const response = await setMutation.mutateAsync({key: row.key, value: Number(raw.trim())})
      if (response.ok) {
        setDirtyKeys((previous) => {
          const next = new Set(previous)
          next.add(row.key)
          return next
        })
        setMode('browse')
        return
      }

      setRowError(response.error.message)
      setMode('edit')
    },
    [setMutation],
  )

  const resetRow = useCallback(
    async (row: SettingsRow) => {
      setMode('saving')
      setRowError(undefined)
      const response = await resetMutation.mutateAsync({key: row.key})
      if (response.ok) {
        setDirtyKeys((previous) => {
          const next = new Set(previous)
          next.add(row.key)
          return next
        })
        setMode('browse')
        return
      }

      setRowError(response.error.message)
      setMode('browse')
    },
    [resetMutation],
  )

  useInput(
    (input, key) => {
      if (key.escape) {
        onCancel()
        return
      }

      if (rows.length === 0) return

      if (key.upArrow) {
        setCursor((c) => (c <= 0 ? rows.length - 1 : c - 1))
        setRowError(undefined)
        return
      }

      if (key.downArrow) {
        setCursor((c) => (c >= rows.length - 1 ? 0 : c + 1))
        setRowError(undefined)
        return
      }

      if (key.return) {
        enterEdit(rows[cursor])
        return
      }

      if (input?.toLowerCase() === 'r') {
        resetRow(rows[cursor]).catch(() => {})
      }
    },
    {isActive: mode === 'browse'},
  )

  useInput(
    (input, key) => {
      if (key.escape) {
        setMode('browse')
        setRowError(undefined)
        return
      }

      if (key.return) {
        commitEdit(rows[cursor], editBuffer).catch(() => {})
        return
      }

      if (key.backspace || key.delete) {
        setEditBuffer((previous) => previous.slice(0, -1))
        return
      }

      if (input && !key.ctrl && !key.meta) {
        setEditBuffer((previous) => previous + input)
      }
    },
    {isActive: mode === 'edit'},
  )

  React.useEffect(() => {
    if (error) {
      onComplete(`Failed to load settings: ${error.message}`)
    }
  }, [error, onComplete])

  if (isLoading || !data) {
    return (
      <Text>
        <Spinner type="dots" /> Loading settings...
      </Text>
    )
  }

  const keyWidth = Math.max('KEY'.length, ...rows.map((r) => r.label.length))
  const currentWidth = Math.max('CURRENT'.length, ...rows.map((r) => r.displayCurrent.length))
  const defaultWidth = Math.max('DEFAULT'.length, ...rows.map((r) => r.displayDefault.length))

  return (
    <Box flexDirection="column">
      {dirtyKeys.size > 0 && (
        <Box marginBottom={1}>
          <Text color={colors.warning}>
            Settings changed. Run `brv restart` to apply.
          </Text>
        </Box>
      )}

      <Box>
        <Text color={colors.dimText}>
          {'  ' + pad('KEY', keyWidth)}  {pad('CURRENT', currentWidth)}  {pad('DEFAULT', defaultWidth)}  RESTART?
        </Text>
      </Box>

      {rows.map((row, index) => {
        const isSelected = index === cursor
        const marker = isSelected ? '> ' : '  '
        const lineColor = isSelected ? colors.primary : row.modified ? colors.text : colors.dimText
        return (
          <Box flexDirection="column" key={row.key}>
            <Box>
              <Text color={lineColor}>
                {marker}
                {pad(row.label, keyWidth)}  {pad(row.displayCurrent, currentWidth)}  {pad(row.displayDefault, defaultWidth)}  yes
              </Text>
            </Box>
            {isSelected && mode === 'edit' && (
              <Box marginLeft={2}>
                <Text color={colors.secondary}>{'> '}</Text>
                <Text color={colors.text}>{editBuffer}</Text>
                <Text color={colors.dimText}>
                  {'  '}
                  (min {row.min}, max {row.max}; Enter to save, Esc to cancel)
                </Text>
              </Box>
            )}
            {isSelected && rowError && (
              <Box marginLeft={2}>
                <Text color={colors.errorText}>{rowError}</Text>
              </Box>
            )}
            {isSelected && mode === 'saving' && (
              <Box marginLeft={2}>
                <Text color={colors.dimText}>
                  <Spinner type="dots" /> Saving...
                </Text>
              </Box>
            )}
          </Box>
        )
      })}

      <Box marginTop={1}>
        <Text color={colors.dimText}>
          Up/Down to move, Enter to edit, R to reset to default, Esc to exit
        </Text>
      </Box>
    </Box>
  )
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + ' '.repeat(width - value.length)
}
