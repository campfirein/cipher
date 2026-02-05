import type {FolderPackResult, PackedFile, SkippedFile} from '../../core/domain/folder-pack/types.js'

/**
 * Escapes special XML characters in a string.
 * @param str - String to escape
 * @returns XML-safe string
 */
function escapeXml(str: string): string {
  return str
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&apos;')
}

/**
 * Formats a file size in bytes to a human-readable string.
 * @param bytes - Size in bytes
 * @returns Formatted string (e.g., "1.5 KB", "2.3 MB")
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Generates a packed file XML element.
 * @param file - The packed file to convert
 * @returns XML string for the file
 */
function generateFileXml(file: PackedFile): string {
  const attrs: string[] = [
    `path="${escapeXml(file.path)}"`,
    `lines="${file.lineCount}"`,
    `size="${file.size}"`,
  ]

  if (file.fileType) {
    attrs.push(`type="${escapeXml(file.fileType)}"`)
  }

  if (file.truncated) {
    attrs.push('truncated="true"')
  }

  return `    <file ${attrs.join(' ')}>
${escapeXml(file.content)}
    </file>`
}

/**
 * Generates a skipped file XML element.
 * @param skipped - The skipped file info
 * @returns XML string for the skipped file
 */
function generateSkippedFileXml(skipped: SkippedFile): string {
  const attrs: string[] = [
    `path="${escapeXml(skipped.path)}"`,
    `reason="${escapeXml(skipped.reason)}"`,
  ]

  if (skipped.message) {
    attrs.push(`message="${escapeXml(skipped.message)}"`)
  }

  return `    <file ${attrs.join(' ')}/>`
}

/**
 * Generates XML output from a folder pack result.
 * Produces structured XML suitable for LLM consumption.
 *
 * @param result - The pack result to convert
 * @returns XML string representation of the packed folder
 */
export function generatePackedXml(result: FolderPackResult): string {
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<packed_folder>',
    '  <metadata>',
    `    <root_path>${escapeXml(result.rootPath)}</root_path>`,
    `    <file_count>${result.fileCount}</file_count>`,
    `    <skipped_count>${result.skippedCount}</skipped_count>`,
    `    <total_lines>${result.totalLines}</total_lines>`,
    `    <total_characters>${result.totalCharacters}</total_characters>`,
    `    <total_size>${formatSize(result.files.reduce((sum, f) => sum + f.size, 0))}</total_size>`,
    `    <duration_ms>${result.durationMs}</duration_ms>`,
    `    <packed_at>${new Date().toISOString()}</packed_at>`,
    '  </metadata>',
    '  <config>',
    `    <use_gitignore>${result.config.useGitignore}</use_gitignore>`,
    `    <include_tree>${result.config.includeTree}</include_tree>`,
    `    <extract_pdf_text>${result.config.extractPdfText}</extract_pdf_text>`,
    `    <max_file_size>${formatSize(result.config.maxFileSize)}</max_file_size>`,
    `    <max_lines_per_file>${result.config.maxLinesPerFile}</max_lines_per_file>`,
  ]

  if (result.config.ignore.length > 0) {
    lines.push(`    <custom_ignores>${result.config.ignore.length} patterns</custom_ignores>`)
  }

  lines.push('  </config>')

  // Directory structure section
  if (result.directoryTree) {
    lines.push('  <directory_structure>', `<![CDATA[${result.directoryTree}]]>`, '  </directory_structure>')
  }

  // Files section
  lines.push('  <files>')
  for (const file of result.files) {
    lines.push(generateFileXml(file))
  }

  lines.push('  </files>')

  // Skipped files section (only if there are any)
  if (result.skippedFiles.length > 0) {
    lines.push('  <skipped_files>')
    for (const skipped of result.skippedFiles) {
      lines.push(generateSkippedFileXml(skipped))
    }

    lines.push('  </skipped_files>')
  }

  // Summary section (useful for LLM context)
  lines.push('  <summary>', `    <description>This packed folder contains ${result.fileCount} files with ${result.totalLines} total lines of content.</description>`)

  // File type breakdown
  const typeBreakdown = new Map<string, number>()
  for (const file of result.files) {
    const fileType = file.fileType ?? 'unknown'
    typeBreakdown.set(fileType, (typeBreakdown.get(fileType) ?? 0) + 1)
  }

  if (typeBreakdown.size > 0) {
    const breakdown = [...typeBreakdown.entries()]
      .map(([type, count]) => `${type}: ${count}`)
      .join(', ')
    lines.push(`    <file_types>${escapeXml(breakdown)}</file_types>`)
  }

  // Skip reason breakdown
  if (result.skippedFiles.length > 0) {
    const skipBreakdown = new Map<string, number>()
    for (const skipped of result.skippedFiles) {
      skipBreakdown.set(skipped.reason, (skipBreakdown.get(skipped.reason) ?? 0) + 1)
    }

    const skipSummary = [...skipBreakdown.entries()]
      .map(([reason, count]) => `${reason}: ${count}`)
      .join(', ')
    lines.push(`    <skip_reasons>${escapeXml(skipSummary)}</skip_reasons>`)
  }

  lines.push('  </summary>', '</packed_folder>')

  return lines.join('\n')
}

/**
 * Generates a compact XML output (minimal whitespace).
 * Useful when size is a concern.
 *
 * @param result - The pack result to convert
 * @returns Compact XML string
 */
export function generatePackedXmlCompact(result: FolderPackResult): string {
  // For now, just remove extra whitespace from the full version
  return generatePackedXml(result)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n')
}
