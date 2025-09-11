// src/services/file-validation.service.ts
import fs from 'fs/promises';
import path from 'path';
import logger from '../utils/logger';
import { AppError } from '../utils/error';

export interface FileValidationOptions {
  maxSize?: number;
  minSize?: number;
  allowedMimeTypes?: string[];
  allowedExtensions?: string[];
  validateHeader?: boolean;
  validateContent?: boolean;
}

export interface FileInfo {
  path: string;
  originalName: string;
  size: number;
  mimeType: string;
}

export class FileValidationService {
  private static readonly DEFAULT_OPTIONS: Required<FileValidationOptions> = {
    maxSize: 50 * 1024 * 1024, // 50MB
    minSize: 100, // 100 bytes
    allowedMimeTypes: [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp',
      'image/avif',
      'image/tiff',
      'image/bmp'
    ],
    allowedExtensions: [
      '.jpg',
      '.jpeg',
      '.png',
      '.webp',
      '.avif',
      '.tiff',
      '.tif',
      '.bmp'
    ],
    validateHeader: true,
    validateContent: true
  };

  private static readonly DANGEROUS_EXTENSIONS = ['.exe', '.bat', '.cmd', '.scr', '.pif', '.com'];
  private static readonly VIRUS_SIGNATURES = ['PK', 'MZ', '<!DOCTYPE', '<html>', '<script>'];
  private static readonly MAX_FILENAME_LENGTH = 255;

  /**
   * Comprehensive file validation
   */
  static async validateFile(
    fileInfo: FileInfo, 
    options: FileValidationOptions = {}
  ): Promise<void> {
    const opts = { ...this.DEFAULT_OPTIONS, ...options };
    
    // Basic validations
    this.validateBasicFileInfo(fileInfo, opts);
    
    // File system validations
    await this.validateFileSystem(fileInfo, opts);
    
    // Content validations
    if (opts.validateContent || opts.validateHeader) {
      await this.validateFileContent(fileInfo, opts);
    }
  }

  /**
   * Validate basic file information
   */
  private static validateBasicFileInfo(fileInfo: FileInfo, opts: Required<FileValidationOptions>): void {
    const { originalName, size, mimeType } = fileInfo;

    // Filename validation
    if (!originalName || originalName.trim().length === 0) {
      throw new AppError('Invalid filename', 400, 'INVALID_FILENAME');
    }

    if (originalName.length > this.MAX_FILENAME_LENGTH) {
      throw new AppError(`Filename too long (max ${this.MAX_FILENAME_LENGTH} characters)`, 400, 'FILENAME_TOO_LONG');
    }

    if (originalName.includes('\0')) {
      throw new AppError('Invalid filename format', 400, 'INVALID_FILENAME');
    }

    // Size validation
    if (size < opts.minSize) {
      throw new AppError(`File too small (min ${opts.minSize} bytes)`, 400, 'FILE_TOO_SMALL');
    }

    if (size > opts.maxSize) {
      throw new AppError(`File too large (max ${Math.round(opts.maxSize / (1024 * 1024))}MB)`, 400, 'FILE_TOO_LARGE');
    }

    // MIME type validation
    if (!opts.allowedMimeTypes.includes(mimeType.toLowerCase())) {
      throw new AppError(`Unsupported file type: ${mimeType}`, 400, 'UNSUPPORTED_MIME_TYPE');
    }

    // Extension validation
    const ext = path.extname(originalName).toLowerCase();
    if (!opts.allowedExtensions.includes(ext)) {
      throw new AppError(`File extension '${ext}' not allowed`, 400, 'INVALID_EXTENSION');
    }

    if (this.DANGEROUS_EXTENSIONS.includes(ext)) {
      throw new AppError('Dangerous file extension detected', 400, 'DANGEROUS_EXTENSION');
    }

    // MIME type and extension consistency
    this.validateMimeTypeExtensionMatch(mimeType, ext);
  }

  /**
   * Validate file system properties
   */
  private static async validateFileSystem(fileInfo: FileInfo, opts: Required<FileValidationOptions>): Promise<void> {
    try {
      const stats = await fs.stat(fileInfo.path);
      
      if (!stats.isFile()) {
        throw new AppError('Path is not a file', 400, 'INVALID_FILE');
      }

      if (stats.size === 0) {
        throw new AppError('File is empty', 400, 'EMPTY_FILE');
      }

      if (stats.size !== fileInfo.size) {
        logger.warn('File size mismatch', { 
          reported: fileInfo.size, 
          actual: stats.size,
          path: fileInfo.path 
        });
      }

      // Check file accessibility
      await fs.access(fileInfo.path, fs.constants.R_OK);

    } catch (error: any) {
      if (error instanceof AppError) {
        throw error;
      }

      if (error.code === 'ENOENT') {
        throw new AppError('File not found', 400, 'FILE_NOT_FOUND');
      }

      if (error.code === 'EACCES') {
        throw new AppError('File is not readable', 400, 'FILE_NOT_READABLE');
      }

      logger.error('File system validation failed', { 
        path: fileInfo.path, 
        error: error.message 
      });
      throw new AppError('File validation failed', 400, 'FILE_VALIDATION_ERROR');
    }
  }

  
private static isConversionSUpported(fromMimeType:string, toFormat:string):boolean{
      const conversionMap: Record<string, string[]> = {
      'image/jpeg': ['jpeg', 'jpg', 'png', 'webp'],
      'image/png': ['png', 'jpeg', 'jpg', 'webp'],
      'image/webp': ['webp', 'png', 'jpeg', 'jpg'],
      'image/gif': ['gif', 'png', 'jpeg', 'jpg'],
      'image/bmp': ['bmp', 'png', 'jpeg', 'jpg']
    };
 return conversionMap[fromMimeType]?.includes(toFormat) || false;
}
  /**
   * Validate file content and headers
   */
  private static async validateFileContent(fileInfo: FileInfo, opts: Required<FileValidationOptions>): Promise<void> {
    try {
      const buffer = await fs.readFile(fileInfo.path);
      
      // Check for virus signatures in first 1KB
      if (opts.validateContent) {
        const header = buffer.slice(0, 1024).toString();
        for (const signature of this.VIRUS_SIGNATURES) {
          if (header.includes(signature)) {
            logger.warn('Potential malicious content detected', {
              path: fileInfo.path,
              signature,
              mimeType: fileInfo.mimeType
            });
            throw new AppError('Potentially malicious content detected', 400, 'MALICIOUS_CONTENT');
          }
        }
      }

      // Validate file header matches MIME type
      if (opts.validateHeader) {
        const isValidHeader = this.validateFileHeader(buffer, fileInfo.mimeType);
        if (!isValidHeader) {
          throw new AppError('File header does not match MIME type', 400, 'INVALID_FILE_HEADER');
        }
      }

    } catch (error: any) {
      if (error instanceof AppError) {
        throw error;
      }

      logger.error('File content validation error', { 
        path: fileInfo.path, 
        error: error.message 
      });
      throw new AppError('File content validation failed', 400, 'CONTENT_VALIDATION_ERROR');
    }
  }

  /**
   * Validate MIME type and extension match
   */
  private static validateMimeTypeExtensionMatch(mimeType: string, extension: string): void {
    const expectedMimeTypes: Record<string, string[]> = {
      '.jpg': ['image/jpeg', 'image/jpg'],
      '.jpeg': ['image/jpeg', 'image/jpg'],
      '.png': ['image/png'],
      '.webp': ['image/webp'],
      '.avif': ['image/avif'],
      '.tiff': ['image/tiff'],
      '.tif': ['image/tiff'],
      '.bmp': ['image/bmp']
    };

    const expectedTypes = expectedMimeTypes[extension];
    if (expectedTypes && !expectedTypes.includes(mimeType.toLowerCase())) {
      throw new AppError('File extension and MIME type mismatch', 400, 'TYPE_MISMATCH');
    }
  }

  /**
   * Validate file header matches MIME type
   */
  private static validateFileHeader(buffer: Buffer, mimeType: string): boolean {
    const header = buffer.slice(0, 12);

    switch (mimeType.toLowerCase()) {
      case 'image/jpeg':
      case 'image/jpg':
        return header[0] === 0xFF && header[1] === 0xD8 && header[2] === 0xFF;
      
      case 'image/png':
        return header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4E && header[3] === 0x47;
      
      case 'image/webp':
        return header.slice(0, 4).toString() === 'RIFF' && 
               header.slice(8, 12).toString() === 'WEBP';
      
      case 'image/bmp':
        return header[0] === 0x42 && header[1] === 0x4D;
      
      case 'image/tiff':
        return (header[0] === 0x49 && header[1] === 0x49 && header[2] === 0x2A && header[3] === 0x00) ||
               (header[0] === 0x4D && header[1] === 0x4D && header[2] === 0x00 && header[3] === 0x2A);
      
      default:
        logger.debug('File header validation skipped for MIME type:', mimeType);
        return true;
    }
  }

  /**
   * Sanitize filename
   */
  static sanitizeFilename(filename: string): string {
    let sanitized = filename.replace(/[\/\\:*?"<>|]/g, '');
    
    // Remove null bytes and control characters
    sanitized = sanitized.replace(/[\x00-\x1F\x7F]/g, '');
    
    // Normalize Unicode characters
    sanitized = sanitized.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    if (!sanitized || sanitized.trim().length === 0) {
      sanitized = 'upload';
    }

    return sanitized.trim();
  }

  /**
   * Check if MIME type is supported
   */
  static isSupportedMimeType(mimeType: string): boolean {
    return this.DEFAULT_OPTIONS.allowedMimeTypes.includes(mimeType.toLowerCase());
  }
}