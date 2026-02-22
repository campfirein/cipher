import {Box, Text, useInput} from 'ink'
import open from 'open'
import React from 'react'

import type {HubEntryDTO} from '../../../../shared/transport/types/dto.js'

import {useTheme} from '../../../hooks/index.js'

const SKILL_COLOR = '#10b96e'
const BUNDLE_COLOR = '#636bff'

interface HubDetailStepProps {
  entry: HubEntryDTO
  isActive: boolean
  onBack: () => void
  onInstall: (entry: HubEntryDTO) => void
}

export function HubDetailStep({entry, isActive, onBack, onInstall}: HubDetailStepProps): React.ReactNode {
  const {
    theme: {colors},
  } = useTheme()

  useInput(
    (input, key) => {
      if (key.return) {
        onInstall(entry)
        return
      }

      if (key.escape) {
        onBack()
        return
      }

      if (input === 'o') {
        open(entry.path_url).catch(() => {})
      }
    },
    {isActive},
  )

  const typeColor = entry.type === 'agent-skill' ? SKILL_COLOR : BUNDLE_COLOR
  const typeLabel = entry.type === 'agent-skill' ? 'skill' : 'bundle'

  return (
    <Box borderColor={colors.border} borderStyle="single" flexDirection="column" paddingX={1}>
      {/* ── Header ── */}
      <Box flexDirection="column" marginBottom={1}>
        <Box gap={2}>
          <Text bold color={colors.text}>
            {entry.name}
          </Text>
          <Text color={typeColor}>[{typeLabel}]</Text>
          <Text color={colors.dimText}>v{entry.version}</Text>
        </Box>
        <Text color={colors.dimText}>{entry.id}</Text>
      </Box>

      {/* ── Description ── */}
      <Box marginBottom={1}>
        <Text color={colors.text}>{entry.long_description}</Text>
      </Box>

      {/* ── Use Cases ── */}
      {entry.metadata.use_cases.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold color={colors.dimText}>
            USE CASES
          </Text>
          {entry.metadata.use_cases.map((useCase) => (
            <Box gap={1} key={useCase}>
              <Text color={colors.primary}>-</Text>
              <Text color={colors.text}>{useCase}</Text>
            </Box>
          ))}
        </Box>
      )}

      {/* ── Metadata grid ── */}
      <Box flexDirection="column" marginBottom={1}>
        {/* Tags */}
        {entry.tags.length > 0 && (
          <Box gap={1}>
            <Text color={colors.dimText}>{'Tags'.padEnd(14)}</Text>
            {entry.tags.map((tag) => (
              <Text color={colors.dimText} key={tag}>
                #{tag}
              </Text>
            ))}
          </Box>
        )}

        {/* Dependencies */}
        {entry.dependencies.length > 0 && (
          <Box gap={1}>
            <Text color={colors.dimText}>{'Requires'.padEnd(14)}</Text>
            {entry.dependencies.map((dep) => (
              <Text color={colors.warning} key={dep}>
                {dep}
              </Text>
            ))}
          </Box>
        )}

        {/* Category */}
        <Box gap={1}>
          <Text color={colors.dimText}>{'Category'.padEnd(14)}</Text>
          <Text color={colors.text}>{entry.category}</Text>
        </Box>

        {/* Registry */}
        {entry.registry && (
          <Box gap={1}>
            <Text color={colors.dimText}>{'Registry'.padEnd(14)}</Text>
            <Text color={colors.text}>{entry.registry}</Text>
          </Box>
        )}

        {/* Author & License */}
        <Box gap={1}>
          <Text color={colors.dimText}>{'Author'.padEnd(14)}</Text>
          <Text color={colors.text}>{entry.author.name}</Text>
        </Box>
        <Box gap={1}>
          <Text color={colors.dimText}>{'License'.padEnd(14)}</Text>
          <Text color={colors.text}>{entry.license}</Text>
        </Box>
      </Box>

      {/* ── Files ── */}
      <Box gap={1} marginBottom={1}>
        <Text color={colors.dimText}>{'Files'.padEnd(14)}</Text>
        {entry.file_tree.map((file) => (
          <Text color={colors.dimText} key={file.name}>
            {file.name}
          </Text>
        ))}
      </Box>

      {/* ── Keybinds ── */}
      <Box gap={2}>
        <Text color={colors.dimText}>
          <Text color={colors.primary}>Enter</Text> Install
        </Text>
        <Text color={colors.dimText}>
          <Text color={colors.text}>o</Text> Open in browser
        </Text>
        <Text color={colors.dimText}>
          <Text color={colors.text}>Esc</Text> Back
        </Text>
      </Box>
    </Box>
  )
}
