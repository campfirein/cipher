/**
 * PDF Generator Helper for Integration Tests
 *
 * Uses pdfkit to generate valid PDFs with known content for testing
 * PDF text extraction functionality.
 */

import PDFDocument from 'pdfkit'

/**
 * Options for generating a test PDF.
 */
export interface PdfGeneratorOptions {
  /** Author metadata */
  author?: string
  /** Array of text content, one string per page */
  pages: string[]
  /** Title metadata */
  title?: string
}

/**
 * Generates a PDF buffer with the specified content and metadata.
 *
 * @param options - PDF generation options
 * @returns Promise resolving to a Buffer containing the PDF
 *
 * @example
 * ```ts
 * // Single page PDF
 * const buffer = await generatePdf({ pages: ['Hello World'] })
 *
 * // Multi-page PDF with metadata
 * const buffer = await generatePdf({
 *   pages: ['Page 1 content', 'Page 2 content'],
 *   title: 'Test Document',
 *   author: 'Test Author',
 * })
 * ```
 */
export async function generatePdf(options: PdfGeneratorOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []

    // Build info object only with defined values
    const info: Record<string, string> = {}
    if (options.title) {
      info.Title = options.title
    }

    if (options.author) {
      info.Author = options.author
    }

    const doc = new PDFDocument({
      info: Object.keys(info).length > 0 ? info : undefined,
    })

    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    // Add each page with its content
    for (const [index, pageContent] of options.pages.entries()) {
      if (index > 0) {
        doc.addPage()
      }

      doc.text(pageContent)
    }

    doc.end()
  })
}

/**
 * Generates a single-page PDF with the given text.
 *
 * @param text - Text content for the page
 * @returns Promise resolving to a Buffer containing the PDF
 */
export async function generateSinglePagePdf(text: string): Promise<Buffer> {
  return generatePdf({ pages: [text] })
}

/**
 * Generates a multi-page PDF with numbered pages.
 *
 * @param pageCount - Number of pages to generate
 * @param contentPrefix - Prefix for each page's content (default: 'Page')
 * @returns Promise resolving to a Buffer containing the PDF
 *
 * @example
 * ```ts
 * // Generates PDF with pages: "Page 1 content", "Page 2 content", etc.
 * const buffer = await generateMultiPagePdf(5)
 *
 * // Custom prefix: "Section 1 content", "Section 2 content", etc.
 * const buffer = await generateMultiPagePdf(3, 'Section')
 * ```
 */
export async function generateMultiPagePdf(pageCount: number, contentPrefix = 'Page'): Promise<Buffer> {
  const pages: string[] = []
  for (let i = 0; i < pageCount; i++) {
    pages.push(`${contentPrefix} ${i + 1} content`)
  }
  
  return generatePdf({ pages })
}
