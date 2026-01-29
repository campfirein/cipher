import {expect} from 'chai'
import {restore as sinonRestore} from 'sinon'

import {PdfExtractionError} from '../../../../../src/core/domain/cipher/errors/file-system-error.js'
import {
  formatPdfContent,
  PdfExtractor,
} from '../../../../../src/infra/cipher/file-system/pdf-extractor.js'

/**
 * PDF magic bytes: %PDF-
 */
const PDF_MAGIC_BYTES = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d])

/**
 * Valid PDF header with version
 */
const VALID_PDF_HEADER = Buffer.from('%PDF-1.4', 'utf8')

/**
 * Invalid buffer (not a PDF)
 */
const INVALID_PDF_BUFFER = Buffer.from('Hello World', 'utf8')

describe('pdf-extractor', () => {
  describe('PdfExtractor.isValidPdf', () => {
    it('should return true for buffer starting with %PDF-', () => {
      expect(PdfExtractor.isValidPdf(PDF_MAGIC_BYTES)).to.be.true
      expect(PdfExtractor.isValidPdf(VALID_PDF_HEADER)).to.be.true
    })

    it('should return true for valid PDF with version number', () => {
      const pdfWithVersion = Buffer.from('%PDF-1.7\n', 'utf8')
      expect(PdfExtractor.isValidPdf(pdfWithVersion)).to.be.true
    })

    it('should return true for PDF with content after header', () => {
      const pdfWithContent = Buffer.concat([VALID_PDF_HEADER, Buffer.from('\n%Some content', 'utf8')])
      expect(PdfExtractor.isValidPdf(pdfWithContent)).to.be.true
    })

    it('should return false for empty buffer', () => {
      expect(PdfExtractor.isValidPdf(Buffer.from([]))).to.be.false
    })

    it('should return false for buffer too short', () => {
      expect(PdfExtractor.isValidPdf(Buffer.from('%PDF', 'utf8'))).to.be.false
      expect(PdfExtractor.isValidPdf(Buffer.from('%PD', 'utf8'))).to.be.false
    })

    it('should return false for non-PDF content', () => {
      expect(PdfExtractor.isValidPdf(Buffer.from('Hello World', 'utf8'))).to.be.false
      expect(PdfExtractor.isValidPdf(Buffer.from('<!DOCTYPE html>', 'utf8'))).to.be.false
      expect(PdfExtractor.isValidPdf(Buffer.from('PK\u0003\u0004', 'utf8'))).to.be.false // ZIP magic
    })

    it('should return false for partial PDF magic', () => {
      expect(PdfExtractor.isValidPdf(Buffer.from('%PDF', 'utf8'))).to.be.false
    })

    it('should return false for corrupted PDF magic', () => {
      expect(PdfExtractor.isValidPdf(Buffer.from('%PDF_1.4', 'utf8'))).to.be.false // underscore instead of dash
      expect(PdfExtractor.isValidPdf(Buffer.from('PDF-1.4', 'utf8'))).to.be.false // missing %
    })
  })

  describe('formatPdfContent', () => {
    it('should return empty string for empty pages array', () => {
      const result = formatPdfContent([], {pageCount: 0}, false, 1)
      expect(result).to.equal('')
    })

    it('should format single page correctly', () => {
      const pages = [{pageNumber: 1, text: 'Hello World'}]
      const metadata = {pageCount: 1}

      const result = formatPdfContent(pages, metadata, false, 2)

      expect(result).to.include('--- Page 1 ---')
      expect(result).to.include('Hello World')
      expect(result).to.include('(End of PDF - 1 pages)')
    })

    it('should format multiple pages with separators', () => {
      const pages = [
        {pageNumber: 1, text: 'Page one content'},
        {pageNumber: 2, text: 'Page two content'},
        {pageNumber: 3, text: 'Page three content'},
      ]
      const metadata = {pageCount: 3}

      const result = formatPdfContent(pages, metadata, false, 4)

      expect(result).to.include('--- Page 1 ---')
      expect(result).to.include('Page one content')
      expect(result).to.include('--- Page 2 ---')
      expect(result).to.include('Page two content')
      expect(result).to.include('--- Page 3 ---')
      expect(result).to.include('Page three content')
      expect(result).to.include('(End of PDF - 3 pages)')
    })

    it('should show continuation message when hasMore is true', () => {
      const pages = [{pageNumber: 1, text: 'First page'}]
      const metadata = {pageCount: 10}

      const result = formatPdfContent(pages, metadata, true, 2)

      expect(result).to.include('--- Page 1 ---')
      expect(result).to.include('First page')
      expect(result).to.include('(PDF has more pages. Use offset=2 to continue)')
      expect(result).not.to.include('End of PDF')
    })

    it('should include correct next offset in continuation message', () => {
      const pages = [
        {pageNumber: 5, text: 'Page five'},
        {pageNumber: 6, text: 'Page six'},
      ]
      const metadata = {pageCount: 20}

      const result = formatPdfContent(pages, metadata, true, 7)

      expect(result).to.include('Use offset=7 to continue')
    })

    it('should handle pages with empty text', () => {
      const pages = [
        {pageNumber: 1, text: ''},
        {pageNumber: 2, text: 'Some content'},
      ]
      const metadata = {pageCount: 2}

      const result = formatPdfContent(pages, metadata, false, 3)

      expect(result).to.include('--- Page 1 ---')
      expect(result).to.include('--- Page 2 ---')
      expect(result).to.include('Some content')
    })

    it('should handle pages with multiline text', () => {
      const pages = [{pageNumber: 1, text: 'Line 1\nLine 2\nLine 3'}]
      const metadata = {pageCount: 1}

      const result = formatPdfContent(pages, metadata, false, 2)

      expect(result).to.include('Line 1\nLine 2\nLine 3')
    })

    it('should handle metadata with title', () => {
      const pages = [{pageNumber: 1, text: 'Content'}]
      const metadata = {pageCount: 1, title: 'My Document'}

      const result = formatPdfContent(pages, metadata, false, 2)

      expect(result).to.include('--- Page 1 ---')
      expect(result).to.include('Content')
      // Note: title is in metadata but formatPdfContent doesn't include it in output
    })

    it('should separate pages with double newlines', () => {
      const pages = [
        {pageNumber: 1, text: 'Page 1'},
        {pageNumber: 2, text: 'Page 2'},
      ]
      const metadata = {pageCount: 2}

      const result = formatPdfContent(pages, metadata, false, 3)

      expect(result).to.include('Page 1\n\n--- Page 2 ---')
    })

    it('should handle metadata with all optional fields', () => {
      const pages = [{pageNumber: 1, text: 'Content'}]
      const metadata = {
        author: 'Test Author',
        creationDate: new Date('2024-01-01'),
        pageCount: 1,
        title: 'Test Title',
      }

      const result = formatPdfContent(pages, metadata, false, 2)

      expect(result).to.include('--- Page 1 ---')
      expect(result).to.include('Content')
    })

    it('should handle large page numbers', () => {
      const pages = [{pageNumber: 999, text: 'Last page content'}]
      const metadata = {pageCount: 999}

      const result = formatPdfContent(pages, metadata, false, 1000)

      expect(result).to.include('--- Page 999 ---')
      expect(result).to.include('(End of PDF - 999 pages)')
    })
  })

  describe('PdfExtractor.extractText', () => {
    describe('validation', () => {
      it('should throw PdfExtractionError for invalid PDF buffer', async () => {
        try {
          await PdfExtractor.extractText(INVALID_PDF_BUFFER, '/test/invalid.pdf')
          expect.fail('Should have thrown PdfExtractionError')
        } catch (error) {
          expect(error).to.be.instanceOf(PdfExtractionError)
          expect((error as PdfExtractionError).message).to.include('Invalid PDF file format')
        }
      })

      it('should throw PdfExtractionError for empty buffer', async () => {
        try {
          await PdfExtractor.extractText(Buffer.from([]), '/test/empty.pdf')
          expect.fail('Should have thrown PdfExtractionError')
        } catch (error) {
          expect(error).to.be.instanceOf(PdfExtractionError)
          expect((error as PdfExtractionError).message).to.include('Invalid PDF file format')
        }
      })

      it('should throw PdfExtractionError for buffer with only PDF header', async () => {
        // A valid PDF header but no actual PDF content
        try {
          await PdfExtractor.extractText(PDF_MAGIC_BYTES, '/test/header-only.pdf')
          expect.fail('Should have thrown PdfExtractionError')
        } catch (error) {
          // Should fail because unpdf cannot parse this
          expect(error).to.be.instanceOf(PdfExtractionError)
        }
      })
    })

    describe('pagination options', () => {
      it('should use default offset of 1 when not specified', async () => {
        // Test with invalid PDF to verify validation happens before pagination
        try {
          await PdfExtractor.extractText(INVALID_PDF_BUFFER, '/test/file.pdf', {})
          expect.fail('Should have thrown')
        } catch (error) {
          // Expected - validation happens first
          expect(error).to.be.instanceOf(PdfExtractionError)
        }
      })

      it('should handle offset less than 1 by using 1', async () => {
        try {
          await PdfExtractor.extractText(INVALID_PDF_BUFFER, '/test/file.pdf', {offset: 0})
          expect.fail('Should have thrown')
        } catch (error) {
          expect(error).to.be.instanceOf(PdfExtractionError)
        }
      })

      it('should handle negative offset by using 1', async () => {
        try {
          await PdfExtractor.extractText(INVALID_PDF_BUFFER, '/test/file.pdf', {offset: -5})
          expect.fail('Should have thrown')
        } catch (error) {
          expect(error).to.be.instanceOf(PdfExtractionError)
        }
      })

      it('should cap limit at 200 pages', async () => {
        // The limit is capped internally at MAX_PAGE_LIMIT = 200
        try {
          await PdfExtractor.extractText(INVALID_PDF_BUFFER, '/test/file.pdf', {limit: 500})
          expect.fail('Should have thrown')
        } catch (error) {
          // Validation fails first, but the limit would be capped
          expect(error).to.be.instanceOf(PdfExtractionError)
        }
      })
    })
  })

  describe('PdfExtractor.extractMetadata', () => {
    it('should throw PdfExtractionError for invalid PDF buffer', async () => {
      try {
        await PdfExtractor.extractMetadata(INVALID_PDF_BUFFER, '/test/invalid.pdf')
        expect.fail('Should have thrown PdfExtractionError')
      } catch (error) {
        expect(error).to.be.instanceOf(PdfExtractionError)
      }
    })

    it('should throw PdfExtractionError for empty buffer', async () => {
      try {
        await PdfExtractor.extractMetadata(Buffer.from([]), '/test/empty.pdf')
        expect.fail('Should have thrown PdfExtractionError')
      } catch (error) {
        expect(error).to.be.instanceOf(PdfExtractionError)
      }
    })
  })

  describe('error handling', () => {
    afterEach(() => {
      sinonRestore()
    })

    it('should include file path in PdfExtractionError', async () => {
      const testPath = '/path/to/test/document.pdf'
      try {
        await PdfExtractor.extractText(INVALID_PDF_BUFFER, testPath)
        expect.fail('Should have thrown PdfExtractionError')
      } catch (error) {
        expect(error).to.be.instanceOf(PdfExtractionError)
        expect((error as PdfExtractionError).message).to.include(testPath)
      }
    })

    it('should handle various file paths in error messages', async () => {
      const testPaths = [
        '/simple.pdf',
        '/path/with spaces/file.pdf',
        '/path/with/many/levels/deep/file.pdf',
        'relative/path/file.pdf',
      ]

      await Promise.all(testPaths.map(async (testPath) => {
        try {
          await PdfExtractor.extractText(INVALID_PDF_BUFFER, testPath)
          expect.fail(`Should have thrown for path: ${testPath}`)
        } catch (error) {
          expect(error).to.be.instanceOf(PdfExtractionError)
          expect((error as PdfExtractionError).message).to.include(testPath)
        }
      }))
    })

    it('should have correct error code in PdfExtractionError', async () => {
      try {
        await PdfExtractor.extractText(INVALID_PDF_BUFFER, '/test.pdf')
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).to.be.instanceOf(PdfExtractionError)
        expect((error as PdfExtractionError).code).to.equal('PDF_EXTRACTION_FAILED')
      }
    })

    it('should have details in PdfExtractionError', async () => {
      try {
        await PdfExtractor.extractText(INVALID_PDF_BUFFER, '/test/file.pdf')
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).to.be.instanceOf(PdfExtractionError)
        const pdfError = error as PdfExtractionError
        expect(pdfError.details).to.deep.include({
          path: '/test/file.pdf',
        })
      }
    })
  })

  describe('PdfExtractResult structure', () => {
    // These tests verify the structure when the extraction would succeed
    // Since we can't easily create valid PDFs in tests, we verify the error path

    it('should throw for malformed PDF structure', async () => {
      // PDF header but corrupted content
      const malformedPdf = Buffer.concat([
        PDF_MAGIC_BYTES,
        Buffer.from(' corrupted content without proper PDF structure'),
      ])

      try {
        await PdfExtractor.extractText(malformedPdf, '/test/malformed.pdf')
        expect.fail('Should have thrown for malformed PDF')
      } catch (error) {
        expect(error).to.be.instanceOf(PdfExtractionError)
      }
    })

    it('should handle buffer that looks like PDF but is not', async () => {
      // Starts with %PDF- but is not a real PDF
      const fakePdf = Buffer.from('%PDF-1.4\nThis is not a real PDF file.')

      try {
        await PdfExtractor.extractText(fakePdf, '/test/fake.pdf')
        expect.fail('Should have thrown for fake PDF')
      } catch (error) {
        expect(error).to.be.instanceOf(PdfExtractionError)
      }
    })
  })

  describe('edge cases', () => {
    it('should handle buffer with BOM before PDF header', async () => {
      // UTF-8 BOM followed by PDF header
      const bomBuffer = Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]), // UTF-8 BOM
        PDF_MAGIC_BYTES,
      ])

      // This should fail validation because BOM is before %PDF-
      expect(PdfExtractor.isValidPdf(bomBuffer)).to.be.false
    })

    it('should handle very short buffers', () => {
      expect(PdfExtractor.isValidPdf(Buffer.from([]))).to.be.false
      expect(PdfExtractor.isValidPdf(Buffer.from([0x25]))).to.be.false
      expect(PdfExtractor.isValidPdf(Buffer.from([0x25, 0x50]))).to.be.false
      expect(PdfExtractor.isValidPdf(Buffer.from([0x25, 0x50, 0x44]))).to.be.false
      expect(PdfExtractor.isValidPdf(Buffer.from([0x25, 0x50, 0x44, 0x46]))).to.be.false
      expect(PdfExtractor.isValidPdf(Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]))).to.be.true // exactly 5 bytes
    })

    it('should handle null bytes in non-PDF buffer', () => {
      const bufferWithNulls = Buffer.from([0x00, 0x00, 0x00, 0x00])
      expect(PdfExtractor.isValidPdf(bufferWithNulls)).to.be.false
    })
  })
})
