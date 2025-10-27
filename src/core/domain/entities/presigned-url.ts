/**
 * Represents a presigned URL for uploading files to cloud storage.
 * Contains the file name and the temporary upload URL with embedded credentials.
 */
export class PresignedUrl {
  public readonly fileName: string
  public readonly uploadUrl: string

  public constructor(fileName: string, uploadUrl: string) {
    if (fileName.trim().length === 0) {
      throw new Error('File name cannot be empty')
    }

    if (uploadUrl.trim().length === 0) {
      throw new Error('Upload URL cannot be empty')
    }

    this.fileName = fileName
    this.uploadUrl = uploadUrl
  }
}
