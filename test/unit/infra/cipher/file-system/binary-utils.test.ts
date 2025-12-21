import {expect} from 'chai'

import {
  getMimeType,
  isBinaryFile,
  isImageFile,
  isMediaFile,
  isPdfFile,
} from '../../../../../src/infra/cipher/file-system/binary-utils.js'

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

    it('should return true for buffer with >30% non-printable characters', () => {
      // Create buffer with 50% non-printable (control characters 1-8)
      const mixedBuffer = Buffer.from([
        0x01, 0x02, 0x03, 0x04, 0x05, // 5 non-printable
        0x41, 0x42, 0x43, 0x44, 0x45, // 5 printable (A-E)
      ])
      expect(isBinaryFile('file.txt', mixedBuffer)).to.be.true
    })

    it('should return false for buffer with <30% non-printable characters', () => {
      // Create buffer with 20% non-printable
      const mostlyText = Buffer.from([
        0x01, 0x02, // 2 non-printable
        0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, // 8 printable
      ])
      expect(isBinaryFile('file.txt', mostlyText)).to.be.false
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

    it('should return true for PDF files', () => {
      expect(isMediaFile('document.pdf')).to.be.true
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
})
