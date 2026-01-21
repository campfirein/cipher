/**
 * Command Details Component
 *
 * Displays detailed information about a selected command suggestion,
 * including description, usage, subcommands, arguments, and flags.
 */

import {Box, Text} from 'ink'
import React from 'react'

import type {CommandArg, CommandFlag, CommandSubcommandInfo, CommandSuggestion} from '../types.js'

import {useTheme} from '../contexts/theme-context.js'

interface CommandDetailsProps {
  labelWidth: number
  selectedSuggestion: CommandSuggestion | null
}

/**
 * Format usage string from args, flags, and subcommands
 */
function formatUsage(
  label: string,
  args?: CommandArg[],
  flags?: CommandFlag[],
  subCommands?: CommandSubcommandInfo[],
): string {
  let usage = label

  if (subCommands?.length) {
    usage += ' <subcommand>'
  }

  if (args?.length) {
    const argsStr = args.map((a) => (a.required ? `<${a.name}>` : `[${a.name}]`)).join(' ')
    usage += ` ${argsStr}`
  }

  if (flags?.length) {
    const flagsStr = flags.map((f) => (f.type === 'file' ? `[${f.char}${f.name}]` : `[--${f.name}]`)).join(' ')
    usage += ` ${flagsStr}`
  }

  return usage
}

export const CommandDetails: React.FC<CommandDetailsProps> = ({labelWidth, selectedSuggestion}) => {
  const {
    theme: {colors},
  } = useTheme()

  const hasDetails =
    selectedSuggestion &&
    (selectedSuggestion.args?.length || selectedSuggestion.flags?.length || selectedSuggestion.subCommands?.length)

  return (
    <Box
      borderBottom={false}
      borderColor={colors.border}
      borderRight={false}
      borderStyle="single"
      borderTop={false}
      flexDirection="column"
      paddingLeft={1}
    >
      {/* Show args/flags/subcommands for selected command */}
      <Text color={colors.dimText}>{selectedSuggestion?.description || ''}</Text>
      {hasDetails && (
        <>
          <Text color={colors.text}>
            Usage:{' '}
            {formatUsage(
              selectedSuggestion.label,
              selectedSuggestion.args,
              selectedSuggestion.flags,
              selectedSuggestion.subCommands,
            )}
          </Text>

          {selectedSuggestion.subCommands?.map((sub) => (
            <Text color={colors.dimText} key={sub.name}>
              {'  '}
              <Text color={colors.text}>{sub.name.padEnd(labelWidth + 2)}</Text>
              {'  '}
              {sub.description}
            </Text>
          ))}

          {selectedSuggestion.args?.map((arg) => (
            <Text color={colors.dimText} key={arg.name}>
              {'  '}
              <Text color={colors.text}>
                {(arg.required ? `<${arg.name}>` : `[${arg.name}]`).padEnd(labelWidth + 2)}
              </Text>
              {'  '}
              {arg.description}
            </Text>
          ))}

          {selectedSuggestion.flags?.map((flag) => (
            <Text color={colors.dimText} key={flag.name}>
              {'  '}
              <Text color={colors.text}>
                {(flag.type === 'file'
                  ? `${flag.char || '@'}file`
                  : (flag.char ? `-${flag.char}, ` : '') + `--${flag.name}`
                ).padEnd(labelWidth + 2)}
              </Text>
              {'  '}
              {flag.description}
              {flag.default !== undefined && <Text> (default: {String(flag.default)})</Text>}
            </Text>
          ))}
        </>
      )}
    </Box>
  )
}
