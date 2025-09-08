// src/services/video-file-validation.service.ts
import fs from 'fs/promises';
import path from 'path';
import logger from '../utils/logger';
import { AppError } from '../utils/error';

export interface VideoValidationOptions {
  maxSize?: number;
  minSize?: number;
  allowedMimeTypes?: string[];
  allowedExtensions?: string[];
  validateHeader?: boolean;
  validateContent?: boolean;
  maxDuration?: number; // in seconds
  minDuration?: number; // in seconds
  maxResolution?: { width: number; height: number };
  minResolution?: { width: number; height: number };
}

export interface VideoFileInfo {
  path: string;
  originalName: string;
  size: number;
  mimeType: string;
  duration?: number; // in seconds
  resolution?: { width: number; height: number };
  bitrate?: number;
  fps?: number;
}

export class VideoFileValidationService {
  private static readonly DEFAULT_OPTIONS: Required<VideoValidationOptions> = {
    maxSize: 500 * 1024 * 1024, // 500MB
    minSize: 1024, // 1KB
    allowedMimeTypes: [
      'video/mp4',
      'video/mpeg',
      'video/quicktime',
      'video/x-msvideo', // AVI
      'video/webm',
      'video/x-ms-wmv',
      'video/3gpp',
      'video/x-flv'
    ],
    allowedExtensions: [
      '.mp4',
      '.avi',
      '.mov',
      '.wmv',
      '.flv',
      '.webm',
      '.mkv',
      '.m4v',
      '.3gp'
    ],
    validateHeader: true,
    validateContent: true,
    maxDuration: 3600, // 1 hour
    minDuration: 1, // 1 second
    maxResolution: { width: 4096, height: 2160 }, // 4K
    minResolution: { width: 240, height: 180 } // Minimum viable resolution
  };

  private static readonly DANGEROUS_EXTENSIONS = ['.exe', '.bat', '.cmd', '.scr', '.pif', '.com'];
  private static readonly VIRUS_SIGNATURES = ['MZ', '<!DOCTYPE', '<html>', '<script>', 'javascript:', 'vbscript:'];
  private static readonly MAX_FILENAME_LENGTH = 255;

  // Video format magic numbers/signatures
  private static readonly VIDEO_SIGNATURES = {
    'video/mp4': [
      [0x66, 0x74, 0x79, 0x70], // ftyp
      [0x6D, 0x64, 0x61, 0x74], // mdat
      [0x6D, 0x6F, 0x6F, 0x76]  // moov
    ],
    'video/avi': [[0x52, 0x49, 0x46, 0x46]], // RIFF
    'video/webm': [[0x1A, 0x45, 0xDF, 0xA3]], // EBML
    'video/quicktime': [
      [0x66, 0x74, 0x79, 0x70, 0x71, 0x74], // ftyp qt
      [0x6D, 0x6F, 0x6F, 0x76] // moov
    ]
  };

  /**
   * Comprehensive video file validation
   */
  static async validateVideoFile(
    videoInfo: VideoFileInfo, 
    options: VideoValidationOptions = {}
  ): Promise<void> {
    const opts = { ...this.DEFAULT_OPTIONS, ...options };
    
    logger.info('Starting video file validation', { 
      file: videoInfo.originalName, 
      size: videoInfo.size,
      mimeType: videoInfo.mimeType 
    });
    
    // Basic validations
    this.validateBasicVideoFileInfo(videoInfo, opts);
    
    // File system validations
    await this.validateFileSystem(videoInfo, opts);
    
    // Content validations
    if (opts.validateContent || opts.validateHeader) {
      await this.validateVideoFileContent(videoInfo, opts);
    }

    // Video-specific validations
    await this.validateVideoProperties(videoInfo, opts);
    
    logger.info('Video file validation completed successfully', { 
      file: videoInfo.originalName 
    });
  }

  /**
   * Validate basic video file information
   */
  private static validateBasicVideoFileInfo(
    videoInfo: VideoFileInfo, 
    opts: Required<VideoValidationOptions>
  ): void {
    const { originalName, size, mimeType } = videoInfo;

    // Filename validation
    if (!originalName || originalName.trim().length === 0) {
      throw new AppError('Invalid filename', 400, 'INVALID_FILENAME');
    }

    if (originalName.length > this.MAX_FILENAME_LENGTH) {
      throw new AppError(
        `Filename too long (max ${this.MAX_FILENAME_LENGTH} characters)`, 
        400, 
        'FILENAME_TOO_LONG'
      );
    }

    if (originalName.includes('\0')) {
      throw new AppError('Invalid filename format', 400, 'INVALID_FILENAME');
    }

    // Size validation
    if (size < opts.minSize) {
      throw new AppError(`File too small (min ${opts.minSize} bytes)`, 400, 'FILE_TOO_SMALL');
    }

    if (size > opts.maxSize) {
      throw new AppError(
        `File too large (max ${Math.round(opts.maxSize / (1024 * 1024))}MB)`, 
        400, 
        'FILE_TOO_LARGE'
      );
    }

    // MIME type validation
    if (!opts.allowedMimeTypes.includes(mimeType.toLowerCase())) {
      throw new AppError(`Unsupported video type: ${mimeType}`, 400, 'UNSUPPORTED_MIME_TYPE');
    }

    // Extension validation
    const ext = path.extname(originalName).toLowerCase();
    if (!opts.allowedExtensions.includes(ext)) {
      throw new AppError(`Video extension '${ext}' not allowed`, 400, 'INVALID_EXTENSION');
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
  private static async validateFileSystem(
    videoInfo: VideoFileInfo, 
    opts: Required<VideoValidationOptions>
  ): Promise<void> {
    try {
      const stats = await fs.stat(videoInfo.path);
      
      if (!stats.isFile()) {
        throw new AppError('Path is not a file', 400, 'INVALID_FILE');
      }

      if (stats.size === 0) {
        throw new AppError('Video file is empty', 400, 'EMPTY_FILE');
      }

      if (stats.size !== videoInfo.size) {
        logger.warn('Video file size mismatch', { 
          reported: videoInfo.size, 
          actual: stats.size,
          path: videoInfo.path 
        });
      }

      // Check file accessibility
      await fs.access(videoInfo.path, fs.constants.R_OK);

    } catch (error: any) {
      if (error instanceof AppError) {
        throw error;
      }

      if (error.code === 'ENOENT') {
        throw new AppError('Video file not found', 400, 'FILE_NOT_FOUND');
      }

      if (error.code === 'EACCES') {
        throw new AppError('Video file is not readable', 400, 'FILE_NOT_READABLE');
      }

      logger.error('Video file system validation failed', { 
        path: videoInfo.path, 
        error: error.message 
      });
      throw new AppError('Video file validation failed', 400, 'FILE_VALIDATION_ERROR');
    }
  }

  /**
   * Check if video processing operation is supported
   */
  private static isVideoProcessingSupported(fromMimeType: string, operation: string): boolean {
    const supportedOperations: Record<string, string[]> = {
      'video/mp4': ['watermark', 'crop', 'trim', 'resize'],
      'video/avi': ['watermark', 'crop', 'trim'],
      'video/mov': ['watermark', 'crop', 'trim'],
      'video/webm': ['watermark', 'crop', 'trim'],
      'video/wmv': ['watermark', 'crop', 'trim']
    };
    
    return supportedOperations[fromMimeType]?.includes(operation) || false;
  }

  /**
   * Validate video file content and headers
   */
  private static async validateVideoFileContent(
    videoInfo: VideoFileInfo, 
    opts: Required<VideoValidationOptions>
  ): Promise<void> {
    try {
      const buffer = await fs.readFile(videoInfo.path);
      
      // Check for virus signatures in first 2KB
      if (opts.validateContent) {
        const header = buffer.slice(0, 2048).toString();
        for (const signature of this.VIRUS_SIGNATURES) {
          if (header.includes(signature)) {
            logger.warn('Potential malicious content detected in video', {
              path: videoInfo.path,
              signature,
              mimeType: videoInfo.mimeType
            });
            throw new AppError('Potentially malicious content detected', 400, 'MALICIOUS_CONTENT');
          }
        }
      }

      // Validate video file header matches MIME type
      if (opts.validateHeader) {
        const isValidHeader = this.validateVideoFileHeader(buffer, videoInfo.mimeType);
        if (!isValidHeader) {
          throw new AppError('Video file header does not match MIME type', 400, 'INVALID_FILE_HEADER');
        }
      }

      // Additional video-specific content validation
      await this.validateVideoContainer(buffer, videoInfo.mimeType);

    } catch (error: any) {
      if (error instanceof AppError) {
        throw error;
      }

      logger.error('Video file content validation error', { 
        path: videoInfo.path, 
        error: error.message 
      });
      throw new AppError('Video content validation failed', 400, 'CONTENT_VALIDATION_ERROR');
    }
  }

  /**
   * Validate video properties (duration, resolution, etc.)
   */
  private static async validateVideoProperties(
    videoInfo: VideoFileInfo,
    opts: Required<VideoValidationOptions>
  ): Promise<void> {
    // Duration validation
    if (videoInfo.duration !== undefined) {
      if (videoInfo.duration < opts.minDuration) {
        throw new AppError(
          `Video too short (min ${opts.minDuration} seconds)`, 
          400, 
          'VIDEO_TOO_SHORT'
        );
      }

      if (videoInfo.duration > opts.maxDuration) {
        throw new AppError(
          `Video too long (max ${Math.round(opts.maxDuration / 60)} minutes)`, 
          400, 
          'VIDEO_TOO_LONG'
        );
      }
    }

    // Resolution validation
    if (videoInfo.resolution) {
      const { width, height } = videoInfo.resolution;
      
      if (width < opts.minResolution.width || height < opts.minResolution.height) {
        throw new AppError(
          `Video resolution too low (min ${opts.minResolution.width}x${opts.minResolution.height})`, 
          400, 
          'RESOLUTION_TOO_LOW'
        );
      }

      if (width > opts.maxResolution.width || height > opts.maxResolution.height) {
        throw new AppError(
          `Video resolution too high (max ${opts.maxResolution.width}x${opts.maxResolution.height})`, 
          400, 
          'RESOLUTION_TOO_HIGH'
        );
      }

      // Check for valid aspect ratios (basic validation)
      const aspectRatio = width / height;
      if (aspectRatio < 0.1 || aspectRatio > 10) {
        throw new AppError('Invalid video aspect ratio', 400, 'INVALID_ASPECT_RATIO');
      }
    }

    // Validate processing operations support
    if (!this.isVideoProcessingSupported(videoInfo.mimeType, 'watermark')) {
      throw new AppError(
        `Watermarking not supported for ${videoInfo.mimeType}`, 
        400, 
        'WATERMARK_NOT_SUPPORTED'
      );
    }

    if (!this.isVideoProcessingSupported(videoInfo.mimeType, 'crop')) {
      throw new AppError(
        `Cropping/trimming not supported for ${videoInfo.mimeType}`, 
        400, 
        'CROP_NOT_SUPPORTED'
      );
    }
  }

  /**
   * Validate MIME type and extension match
   */
  private static validateMimeTypeExtensionMatch(mimeType: string, extension: string): void {
    const expectedMimeTypes: Record<string, string[]> = {
      '.mp4': ['video/mp4'],
      '.avi': ['video/x-msvideo', 'video/avi'],
      '.mov': ['video/quicktime'],
      '.wmv': ['video/x-ms-wmv'],
      '.flv': ['video/x-flv'],
      '.webm': ['video/webm'],
      '.mkv': ['video/x-matroska'],
      '.m4v': ['video/mp4', 'video/x-m4v'],
      '.3gp': ['video/3gpp']
    };

    const expectedTypes = expectedMimeTypes[extension];
    if (expectedTypes && !expectedTypes.includes(mimeType.toLowerCase())) {
      throw new AppError('Video file extension and MIME type mismatch', 400, 'TYPE_MISMATCH');
    }
  }

  /**
   * Validate video file header matches MIME type
   */
  private static validateVideoFileHeader(buffer: Buffer, mimeType: string): boolean {
    type VideoMimeTypes = 'video/mp4' | 'video/avi' | 'video/webm' | 'video/quicktime';

    const normalizedMimeType = mimeType.toLowerCase() as VideoMimeTypes;
    
    const signatures = this.VIDEO_SIGNATURES[normalizedMimeType];
    
    if (!signatures) {
      logger.debug('Video header validation skipped for MIME type:', mimeType);
      return true;
    }

    // Check if any of the signatures match
    for (const signature of signatures) {
      let matches = true;
      for (let i = 0; i < signature.length; i++) {
        if (i >= buffer.length || buffer[i] !== signature[i]) {
          // For MP4, check at different offsets as ftyp might not be at the start
          if (normalizedMimeType === 'video/mp4' && signature === this.VIDEO_SIGNATURES['video/mp4'][0]) {
            // Search for ftyp in first 100 bytes
            const searchBuffer = buffer.slice(0, 100);
            if (searchBuffer.includes(Buffer.from(signature))) {
              return true;
            }
          }
          matches = false;
          break;
        }
      }
      if (matches) {
        return true;
      }
    }

    return false;
  }

  /**
   * Validate video container format
   */
  private static async validateVideoContainer(buffer: Buffer, mimeType: string): Promise<void> {
    switch (mimeType.toLowerCase()) {
      case 'video/mp4':
        this.validateMP4Container(buffer);
        break;
      case 'video/avi':
        this.validateAVIContainer(buffer);
        break;
      case 'video/webm':
        this.validateWebMContainer(buffer);
        break;
      default:
        logger.debug('Container validation skipped for MIME type:', mimeType);
    }
  }

  /**
   * Validate MP4 container structure
   */
  private static validateMP4Container(buffer: Buffer): void {
    const header = buffer.slice(0, 100).toString('ascii', 0, 100);
    
    // Check for required MP4 atoms
    const requiredAtoms = ['ftyp'];
    const foundAtoms = requiredAtoms.filter(atom => header.includes(atom));
    
    if (foundAtoms.length === 0) {
      throw new AppError('Invalid MP4 container structure', 400, 'INVALID_MP4_CONTAINER');
    }
  }

  /**
   * Validate AVI container structure
   */
  private static validateAVIContainer(buffer: Buffer): void {
    const header = buffer.slice(0, 20).toString('ascii');
    
    if (!header.includes('RIFF') || !header.includes('AVI ')) {
      throw new AppError('Invalid AVI container structure', 400, 'INVALID_AVI_CONTAINER');
    }
  }

  /**
   * Validate WebM container structure
   */
  private static validateWebMContainer(buffer: Buffer): void {
    // WebM uses EBML (Extensible Binary Meta Language)
    if (buffer.length < 4 || buffer[0] !== 0x1A || buffer[1] !== 0x45 || buffer[2] !== 0xDF || buffer[3] !== 0xA3) {
      throw new AppError('Invalid WebM container structure', 400, 'INVALID_WEBM_CONTAINER');
    }
  }

  /**
   * Validate crop parameters
   */
  static validateCropParameters(startTime: number, endTime: number, videoDuration?: number): void {
    if (startTime < 0) {
      throw new AppError('Start time cannot be negative', 400, 'INVALID_START_TIME');
    }

    if (endTime <= startTime) {
      throw new AppError('End time must be greater than start time', 400, 'INVALID_END_TIME');
    }

    if (videoDuration && endTime > videoDuration) {
      throw new AppError('End time exceeds video duration', 400, 'END_TIME_EXCEEDS_DURATION');
    }

    const cropDuration = endTime - startTime;
    if (cropDuration < 1) {
      throw new AppError('Crop duration must be at least 1 second', 400, 'CROP_DURATION_TOO_SHORT');
    }

    if (cropDuration > 3600) {
      throw new AppError('Crop duration cannot exceed 1 hour', 400, 'CROP_DURATION_TOO_LONG');
    }
  }

  /**
   * Sanitize video filename
   */
  static sanitizeVideoFilename(filename: string): string {
    let sanitized = filename.replace(/[\/\\:*?"<>|]/g, '');
    
    // Remove null bytes and control characters
    sanitized = sanitized.replace(/[\x00-\x1F\x7F]/g, '');
    
    // Normalize Unicode characters
    sanitized = sanitized.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    // Ensure video extension
    const ext = path.extname(sanitized).toLowerCase();
    if (!this.DEFAULT_OPTIONS.allowedExtensions.includes(ext)) {
      sanitized = path.basename(sanitized, ext) + '.mp4';
    }

    if (!sanitized || sanitized.trim().length === 0) {
      sanitized = 'video.mp4';
    }

    return sanitized.trim();
  }

  /**
   * Check if video MIME type is supported
   */
  static isSupportedVideoMimeType(mimeType: string): boolean {
    return this.DEFAULT_OPTIONS.allowedMimeTypes.includes(mimeType.toLowerCase());
  }

  /**
   * Get recommended video settings for processing
   */
  static getRecommendedVideoSettings(mimeType: string): {
    maxBitrate: number;
    recommendedCodec: string;
    recommendedFormat: string;
  } {
    const settings: Record<string, {
      maxBitrate: number;
      recommendedCodec: string;
      recommendedFormat: string;
    }> = {
      'video/mp4': {
        maxBitrate: 10000000, // 10 Mbps
        recommendedCodec: 'h264',
        recommendedFormat: 'mp4'
      },
      'video/webm': {
        maxBitrate: 8000000, // 8 Mbps
        recommendedCodec: 'vp9',
        recommendedFormat: 'webm'
      },
      'video/avi': {
        maxBitrate: 15000000, // 15 Mbps
        recommendedCodec: 'h264',
        recommendedFormat: 'avi'
      }
    };

    const normalizedMimeType = mimeType.toLowerCase();
    return settings[normalizedMimeType] || settings['video/mp4'];
  }
}