import {expect} from 'chai'

import {
  getMimeType,
  isBinaryFile,
  isImageFile,
  isMediaFile,
  isPdfFile,
  shouldReturnAsAttachment,
} from '../../../../src/agent/infra/file-system/binary-utils.js'

describe('binary-utils', () => {
  describe('isBinaryFile', () => {
    it('should return true for known binary extensions', () => {
      const binaryExtensions = ['.zip', '.exe', '.dll', '.so', '.wasm', '.pyc', '.jar']

      for (const ext of binaryExtensions) {
        const result = isBinaryFile(`file${ext}`, Buffer.from(''))
        expect(result, `Expected ${ext} to be detected as binary`).to.be.true
      }
    })

    it('should return true for image files (handled as binary)', () => {
      expect(isBinaryFile('photo.png', Buffer.from(''))).to.be.true
      expect(isBinaryFile('image.jpg', Buffer.from(''))).to.be.true
      expect(isBinaryFile('icon.gif', Buffer.from(''))).to.be.true
    })

    it('should return true for PDF files (handled as binary)', () => {
      expect(isBinaryFile('document.pdf', Buffer.from(''))).to.be.true
    })

    it('should return false for empty buffer with text extension', () => {
      expect(isBinaryFile('file.txt', Buffer.from(''))).to.be.false
      expect(isBinaryFile('file.ts', Buffer.from(''))).to.be.false
      expect(isBinaryFile('file.js', Buffer.from(''))).to.be.false
    })

    it('should return true for buffer containing null bytes', () => {
      const bufferWithNull = Buffer.from([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x00, 0x57, 0x6f, 0x72, 0x6c, 0x64])
      expect(isBinaryFile('file.txt', bufferWithNull)).to.be.true
    })

    it('should return false for pure ASCII text', () => {
      const textBuffer = Buffer.from('Hello, World! This is a test file.\nLine 2\nLine 3')
      expect(isBinaryFile('file.txt', textBuffer)).to.be.false
    })

    it('should return false for UTF-8 text with common characters', () => {
      const utf8Buffer = Buffer.from('Hello\nWorld\tTab\rReturn')
      expect(isBinaryFile('file.txt', utf8Buffer)).to.be.false
    })

    it('should return false for UTF-8 text with emojis', () => {
      const emojiBuffer = Buffer.from('# Status\n\n✅ Done\n❌ Failed\n⚠️ Warning\n🚀 Launched')
      expect(isBinaryFile('file.md', emojiBuffer)).to.be.false
    })

    it('should return false for UTF-8 text with box-drawing characters', () => {
      const boxDrawingBuffer = Buffer.from('├── src\n│   ├── index.ts\n│   └── utils\n└── tests')
      expect(isBinaryFile('file.md', boxDrawingBuffer)).to.be.false
    })

    it('should return false for UTF-8 text with CJK characters', () => {
      const cjkBuffer = Buffer.from('# 项目文档\n\n## 安装说明\n请使用 npm 安装依赖')
      expect(isBinaryFile('file.md', cjkBuffer)).to.be.false
    })

    it('should return true for buffer with >10% control characters', () => {
      // Create buffer with 50% control characters (0x01-0x08)
      const mixedBuffer = Buffer.from([
        0x01,
        0x02,
        0x03,
        0x04,
        0x05, // 5 control chars
        0x41,
        0x42,
        0x43,
        0x44,
        0x45, // 5 printable (A-E)
      ])
      expect(isBinaryFile('file.txt', mixedBuffer)).to.be.true
    })

    it('should return false for buffer with <10% control characters', () => {
      // Create buffer with ~5% control characters
      const mostlyText = Buffer.from([
        0x01, // 1 control char
        0x41,
        0x42,
        0x43,
        0x44,
        0x45,
        0x46,
        0x47,
        0x48,
        0x49,
        0x4a, // 10 printable
        0x4b,
        0x4c,
        0x4d,
        0x4e,
        0x4f,
        0x50,
        0x51,
        0x52,
        0x53, // 9 more printable
      ])
      expect(isBinaryFile('file.txt', mostlyText)).to.be.false
    })

    it('should return true for invalid UTF-8 sequences', () => {
      // Invalid UTF-8: 0xFF 0xFE are not valid UTF-8 bytes
      const invalidUtf8 = Buffer.from([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0xff, 0xfe, 0x57, 0x6f, 0x72, 0x6c, 0x64])
      expect(isBinaryFile('file.txt', invalidUtf8)).to.be.true
    })

    it('should handle SVG files as text (not binary)', () => {
      const svgContent = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
      expect(isBinaryFile('icon.svg', svgContent)).to.be.false
    })
  })

  describe('isImageFile', () => {
    it('should return true for common image extensions', () => {
      expect(isImageFile('photo.png')).to.be.true
      expect(isImageFile('photo.PNG')).to.be.true
      expect(isImageFile('image.jpg')).to.be.true
      expect(isImageFile('image.jpeg')).to.be.true
      expect(isImageFile('icon.gif')).to.be.true
      expect(isImageFile('banner.webp')).to.be.true
      expect(isImageFile('legacy.bmp')).to.be.true
      expect(isImageFile('favicon.ico')).to.be.true
      expect(isImageFile('scan.tiff')).to.be.true
      expect(isImageFile('scan.tif')).to.be.true
    })

    it('should return false for SVG files (text-based)', () => {
      expect(isImageFile('icon.svg')).to.be.false
    })

    it('should return false for non-image files', () => {
      expect(isImageFile('document.pdf')).to.be.false
      expect(isImageFile('script.js')).to.be.false
      expect(isImageFile('data.json')).to.be.false
      expect(isImageFile('archive.zip')).to.be.false
    })

    it('should handle paths with directories', () => {
      expect(isImageFile('/path/to/photo.png')).to.be.true
      expect(isImageFile('src/assets/icon.jpg')).to.be.true
    })
  })

  describe('isPdfFile', () => {
    const validPdfBuffer = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34])
    const pdfWithLeadingWhitespace = Buffer.concat([Buffer.from('   \n\t'), validPdfBuffer])
    const invalidPdfBuffer = Buffer.from([0x50, 0x4b, 0x03, 0x04])

    describe('without buffer (extension-only)', () => {
      it('should return true for PDF files', () => {
        expect(isPdfFile('document.pdf')).to.be.true
        expect(isPdfFile('Document.PDF')).to.be.true
        expect(isPdfFile('/path/to/file.pdf')).to.be.true
      })

      it('should return false for non-PDF files', () => {
        expect(isPdfFile('document.docx')).to.be.false
        expect(isPdfFile('image.png')).to.be.false
        expect(isPdfFile('file.txt')).to.be.false
      })
    })

    describe('with buffer (magic byte validation)', () => {
      it('should return true for .pdf with valid PDF magic bytes', () => {
        expect(isPdfFile('document.pdf', validPdfBuffer)).to.be.true
        expect(isPdfFile('Document.PDF', validPdfBuffer)).to.be.true
      })

      it('should return true for .pdf with leading whitespace before magic bytes', () => {
        expect(isPdfFile('document.pdf', pdfWithLeadingWhitespace)).to.be.true
      })

      it('should return false for .pdf with invalid magic bytes', () => {
        expect(isPdfFile('fake.pdf', invalidPdfBuffer)).to.be.false
        expect(isPdfFile('binary.pdf', Buffer.from([0x00, 0x01, 0x02, 0x03]))).to.be.false
      })

      it('should return false for non-.pdf extension with valid magic bytes', () => {
        expect(isPdfFile('document.txt', validPdfBuffer)).to.be.false
      })

      it('should return false for empty buffer', () => {
        expect(isPdfFile('document.pdf', Buffer.from([]))).to.be.false
      })
    })
  })

  describe('getMimeType', () => {
    it('should return correct MIME type for images', () => {
      expect(getMimeType('file.png')).to.equal('image/png')
      expect(getMimeType('file.jpg')).to.equal('image/jpeg')
      expect(getMimeType('file.jpeg')).to.equal('image/jpeg')
      expect(getMimeType('file.gif')).to.equal('image/gif')
      expect(getMimeType('file.webp')).to.equal('image/webp')
      expect(getMimeType('file.bmp')).to.equal('image/bmp')
      expect(getMimeType('file.ico')).to.equal('image/x-icon')
      expect(getMimeType('file.tiff')).to.equal('image/tiff')
      expect(getMimeType('file.tif')).to.equal('image/tiff')
    })

    it('should return correct MIME type for PDF', () => {
      expect(getMimeType('document.pdf')).to.equal('application/pdf')
    })

    it('should return null for unsupported extensions', () => {
      expect(getMimeType('file.txt')).to.be.null
      expect(getMimeType('file.js')).to.be.null
      expect(getMimeType('file.docx')).to.be.null
      expect(getMimeType('file.svg')).to.be.null
    })

    it('should handle case-insensitive extensions', () => {
      expect(getMimeType('file.PNG')).to.equal('image/png')
      expect(getMimeType('file.PDF')).to.equal('application/pdf')
      expect(getMimeType('file.JpG')).to.equal('image/jpeg')
    })
  })

  describe('isMediaFile', () => {
    it('should return true for image files', () => {
      expect(isMediaFile('photo.png')).to.be.true
      expect(isMediaFile('image.jpg')).to.be.true
    })

    it('should return false for PDF files (PDFs handled separately)', () => {
      expect(isMediaFile('document.pdf')).to.be.false
    })

    it('should return false for text files', () => {
      expect(isMediaFile('file.txt')).to.be.false
      expect(isMediaFile('script.js')).to.be.false
      expect(isMediaFile('style.css')).to.be.false
    })

    it('should return false for SVG (text-based)', () => {
      expect(isMediaFile('icon.svg')).to.be.false
    })

    it('should return false for binary non-media files', () => {
      expect(isMediaFile('archive.zip')).to.be.false
      expect(isMediaFile('program.exe')).to.be.false
    })
  })

  describe('shouldReturnAsAttachment', () => {
    it('should return true for image files regardless of pdfMode', () => {
      expect(shouldReturnAsAttachment('photo.png')).to.be.true
      expect(shouldReturnAsAttachment('image.jpg')).to.be.true
      expect(shouldReturnAsAttachment('photo.png', 'text')).to.be.true
      expect(shouldReturnAsAttachment('photo.png', 'base64')).to.be.true
    })

    it('should return true for PDF files when pdfMode is base64', () => {
      expect(shouldReturnAsAttachment('document.pdf', 'base64')).to.be.true
    })

    it('should return false for PDF files when pdfMode is text', () => {
      expect(shouldReturnAsAttachment('document.pdf', 'text')).to.be.false
    })

    it('should return false for PDF files when pdfMode is not specified (defaults to text)', () => {
      expect(shouldReturnAsAttachment('document.pdf')).to.be.false
    })

    it('should return false for text files', () => {
      expect(shouldReturnAsAttachment('file.txt')).to.be.false
      expect(shouldReturnAsAttachment('script.js')).to.be.false
    })

    it('should return false for binary non-media files', () => {
      expect(shouldReturnAsAttachment('archive.zip')).to.be.false
      expect(shouldReturnAsAttachment('program.exe')).to.be.false
    })

    it('should return false for SVG files', () => {
      expect(shouldReturnAsAttachment('icon.svg')).to.be.false
    })
  })
})
