import {html} from '@codemirror/lang-html'
import {markdown} from '@codemirror/lang-markdown'
import {oneDark} from '@codemirror/theme-one-dark'
import {EditorView} from '@codemirror/view'
import CodeMirror, {type Extension} from '@uiw/react-codemirror'
import {useMemo} from 'react'

export type TopicEditorLanguage = 'html' | 'markdown' | 'text'

interface TopicEditorProps {
  disabled?: boolean
  language: TopicEditorLanguage
  onChange: (value: string) => void
  value: string
}

/** Theming overrides to fit CodeMirror into the WebUI panel surface. */
const wrapperTheme = EditorView.theme(
  {
    '&': {
      backgroundColor: 'var(--card)',
      borderRadius: '0.5rem',
      color: 'var(--foreground)',
      fontFamily: 'var(--font-mono)',
      fontSize: '13px',
      height: '100%',
    },
    '&.cm-focused': {outline: 'none'},
    '.cm-content': {fontFamily: 'var(--font-mono)', padding: '14px 16px'},
    '.cm-gutters': {
      backgroundColor: 'transparent',
      borderRight: '1px solid var(--border)',
      color: 'var(--muted-foreground)',
    },
    '.cm-line': {padding: '0'},
    '.cm-scroller': {fontFamily: 'var(--font-mono)', lineHeight: '1.6'},
  },
  {dark: true},
)

export function TopicEditor({disabled, language, onChange, value}: TopicEditorProps) {
  const extensions = useMemo<Extension[]>(() => {
    const base: Extension[] = [wrapperTheme, EditorView.lineWrapping]
    if (language === 'html') base.push(html({autoCloseTags: true, matchClosingTags: true}))
    else if (language === 'markdown') base.push(markdown())
    return base
  }, [language])

  return (
    <div className="border-border min-h-0 flex-1 overflow-y-auto rounded-lg border">
      <CodeMirror
        basicSetup={{
          allowMultipleSelections: true,
          autocompletion: true,
          bracketMatching: true,
          closeBrackets: true,
          drawSelection: true,
          foldGutter: true,
          highlightActiveLine: true,
          highlightSelectionMatches: true,
          history: true,
          indentOnInput: true,
          lineNumbers: true,
          syntaxHighlighting: true,
        }}
        editable={!disabled}
        extensions={extensions}
        height="100%"
        onChange={onChange}
        theme={oneDark}
        value={value}
      />
    </div>
  )
}
