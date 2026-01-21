/**
 * Markdown Component
 *
 * Parses markdown strings using unified/remark-parse and renders them as Ink components.
 * Supports headings, paragraphs, inline formatting (bold, italic, code), code blocks,
 * lists (ordered/unordered), and links.
 */

import type {
  Blockquote,
  Code,
  Emphasis,
  Heading,
  InlineCode,
  Link,
  List,
  ListItem,
  Text as MdastText,
  Paragraph,
  PhrasingContent,
  Root,
  RootContent,
  Strong,
} from 'mdast'

import {Box, Text} from 'ink'
import React from 'react'
import remarkParse from 'remark-parse'
import {unified} from 'unified'

import type {Theme} from '../contexts/theme-context.js'

import {useTheme} from '../hooks/index.js'

interface MarkdownProps {
  children: string
}

interface ListContext {
  index: number
  ordered: boolean
}

const renderPhrasingContent = (nodes: PhrasingContent[], theme: Theme): React.ReactNode => nodes.map((node, index) => {
  switch (node.type) {
    case 'break': {
      return <Text key={index}>{'\n'}</Text>
    }

    case 'emphasis': {
      return (
        <Text italic key={index}>
          {renderPhrasingContent((node as Emphasis).children, theme)}
        </Text>
      )
    }

    case 'inlineCode': {
      return (
        <Text backgroundColor={theme.colors.bg2} key={index}>
          {(node as InlineCode).value}
        </Text>
      )
    }

    case 'link': {
      return (
        <Text color={theme.colors.info} key={index} underline>
          {renderPhrasingContent((node as Link).children, theme)}
        </Text>
      )
    }

    case 'strong': {
      return (
        <Text bold key={index}>
          {renderPhrasingContent((node as Strong).children, theme)}
        </Text>
      )
    }

    case 'text': {
      return <Text key={index}>{(node as MdastText).value}</Text>
    }

    default: {
      return null
    }
  }
})

const renderListItem = (node: ListItem, context: ListContext, theme: Theme): React.ReactElement => {
  const bullet = context.ordered ? `${context.index + 1}. ` : '• '

  const hasNestedList = node.children.some((child) => child.type === 'list')

  if (hasNestedList) {
    return (
      <Box flexDirection="column" key={context.index}>
        {node.children.map((child, childIndex) => {
          if (child.type === 'paragraph') {
            return (
              <Box key={childIndex}>
                <Text>{bullet}</Text>
                <Text>{renderPhrasingContent((child as Paragraph).children, theme)}</Text>
              </Box>
            )
          }

          if (child.type === 'list') {
            return (
              <Box key={childIndex} marginLeft={2}>
                {renderList(child as List, theme)}
              </Box>
            )
          }

          return renderNode(child, theme, childIndex)
        })}
      </Box>
    )
  }

  const content = node.children.map((child, childIndex) => {
    if (child.type === 'paragraph') {
      return <Text key={childIndex}>{renderPhrasingContent((child as Paragraph).children, theme)}</Text>
    }

    return renderNode(child, theme, childIndex)
  })

  return (
    <Box key={context.index}>
      <Text>{bullet}</Text>
      {content}
    </Box>
  )
}

const renderList = (node: List, theme: Theme): React.ReactElement => (
  <Box flexDirection="column">
    {node.children.map((item, index) =>
      renderListItem(item, { index, ordered: node.ordered ?? false }, theme),
    )}
  </Box>
)

const renderNode = (node: RootContent, theme: Theme, key?: number): React.ReactNode => {
  switch (node.type) {
    case 'blockquote': {
      const blockquote = node as Blockquote
      return (
        <Box
          key={key}
          marginBottom={1}
        >
          <Box
            borderBottom={false}
            borderLeft
            borderLeftColor={theme.colors.dimText}
            borderRight={false}
            borderStyle="single"
            borderTop={false}
            flexDirection="column"
          >
            {blockquote.children.map((child, index) => renderNode(child, theme, index))}
          </Box>
        </Box>
      )
    }

    case 'code': {
      const code = node as Code
      const langLabel = code.lang ? `[${code.lang}]` : ''
      return (
        <Box backgroundColor={theme.colors.bg2} flexDirection="column" key={key} marginY={1} paddingX={1}>
          {langLabel && <Text color={theme.colors.dimText}>{langLabel}</Text>}
          <Text>{code.value}</Text>
        </Box>
      )
    }

    case 'heading': {
      const heading = node as Heading
      return (
        <Box key={key} marginBottom={1}>
          <Text bold color={theme.colors.primary}>
            {'#'.repeat(heading.depth)} {renderPhrasingContent(heading.children, theme)}
          </Text>
        </Box>
      )
    }

    case 'list': {
      return (
        <Box key={key} marginBottom={1}>
          {renderList(node as List, theme)}
        </Box>
      )
    }

    case 'paragraph': {
      return (
        <Box key={key}>
          <Text>{renderPhrasingContent((node as Paragraph).children, theme)}</Text>
        </Box>
      )
    }

    case 'thematicBreak': {
      return (
        <Box key={key} marginY={1}>
          <Text color={theme.colors.dimText}>───────────────────────────────────</Text>
        </Box>
      )
    }

    default: {
      return null
    }
  }
}

const renderChildren = (children: RootContent[], theme: Theme): React.ReactNode => children.map((child, index) => renderNode(child, theme, index))

export const Markdown = ({children}: MarkdownProps): React.ReactElement => {
  const {theme} = useTheme()

  const tree = unified().use(remarkParse).parse(children) as Root

  return <Box flexDirection="column">{renderChildren(tree.children, theme)}</Box>
}
