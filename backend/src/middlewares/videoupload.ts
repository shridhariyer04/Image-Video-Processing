// src/middleware/video-upload.middleware.ts
import multer, { FileFilterCallback } from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { NODE_ENV } from '../config/env';
import logger from '../utils/logger';
import { AppError } from '../utils/error';
import { VideoFileValidationService } from '../service/videovalidationservice';

// Video-specific configuration
const VIDEO_CONFIG = {
  FILE_LIMITS: {
    MAX_SIZE: 500 * 1024 * 1024, // 500MB
    MIN_SIZE: 1024, // 1KB
    MAX_FILENAME_LENGTH: 255,
    MAX_DURATION: 3600, // 1 hour
  },
  FORMATS: {
    INPUT_EXTENSIONS: ['.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.mkv', '.m4v', '.3gp'],
    INPUT_MIME_TYPES: [
      'video/mp4',
      'video/mpeg',
      'video/quicktime',
      'video/x-msvideo',
      'video/webm',
      'video/x-ms-wmv',
      'video/3gpp',
      'video/x-flv'
    ],
    MIME_TO_EXTENSION: {
      'video/mp4': ['.mp4', '.m4v'],
      'video/mpeg': ['.mpeg', '.mpg'],
      'video/quicktime': ['.mov'],
      'video/x-msvideo': ['.avi'],
      'video/webm': ['.webm'],
      'video/x-ms-wmv': ['.wmv'],
      'video/3gpp': ['.3gp'],
      'video/x-flv': ['.flv']
    }
  },
  SECURITY: {
    DANGEROUS_EXTENSIONS: ['.exe', '.bat', '.cmd', '.scr', '.pif', '.com'],
    VIRUS_SIGNATURES: ['MZ', '<!DOCTYPE', '<html>', '<script>', 'javascript:', 'vbscript:']
  },
  CLEANUP: {
    MAX_AGE_HOURS: 24, // Videos are larger, keep for less time
    CLEANUP_INTERVAL: 6 * 60 * 60 * 1000 // 6 hours
  }
};

// Video upload directory
const VIDEO_UPLOAD_DIR = process.env.VIDEO_UPLOAD_DIR || path.join(process.cwd(), 'uploads', 'videos');

/**
 * Initialize video upload directory with proper permissions
 */
const initializeVideoUploadDir = (): void => {
  try {
    if (!fs.existsSync(VIDEO_UPLOAD_DIR)) {
      fs.mkdirSync(VIDEO_UPLOAD_DIR, { recursive: true, mode: 0o755 });
      logger.info('Video upload directory created', { path: VIDEO_UPLOAD_DIR });
    }

    fs.accessSync(VIDEO_UPLOAD_DIR, fs.constants.W_OK | fs.constants.R_OK);
    logger.debug('Video upload directory initialized successfully', { path: VIDEO_UPLOAD_DIR });
  } catch (error) {
    logger.error('Failed to initialize video upload directory:', {
      path: VIDEO_UPLOAD_DIR,
      error: error instanceof Error ? error.message : error
    });
    throw new AppError('Video upload directory initialization failed', 500, 'VIDEO_UPLOAD_DIR_ERROR');
  }
};

// Initialize upload directory on module load
initializeVideoUploadDir();

/**
 * Video filename sanitization function
 */
const sanitizeVideoFilename = (filename: string): string => {
  return filename
    .replace(/[^\w\s.-]/g, '') // Remove special characters except spaces, dots, and hyphens
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Replace multiple hyphens with single hyphen
    .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens
};

/**
 * Video storage configuration
 */
const videoStorage = multer.diskStorage({
  destination: (_req: Request, _file: Express.Multer.File, cb) => {
    try {
      // Ensure directory exists for each request
      if (!fs.existsSync(VIDEO_UPLOAD_DIR)) {
        fs.mkdirSync(VIDEO_UPLOAD_DIR, { recursive: true, mode: 0o755 });
      }
      cb(null, VIDEO_UPLOAD_DIR);
    } catch (error) {
      logger.error('Video destination setup failed', error);
      cb(new AppError('Video upload destination unavailable', 500, 'VIDEO_DESTINATION_ERROR'), '');
    }
  },

  filename: (_req: Request, file: Express.Multer.File, cb) => {
    try {
      const ext = path.extname(file.originalname).toLowerCase();
      const baseName = path.basename(file.originalname, ext);
      
      // Use video-specific filename sanitization
      const sanitizedBase = sanitizeVideoFilename(baseName);

      // Generate cryptographically secure random string
      const randomHash = crypto.randomBytes(12).toString('hex'); // Longer hash for videos
      
      // Create timestamp with milliseconds for uniqueness
      const timestamp = Date.now();
      
      // Construct final filename with video prefix
      const finalName = `video-${timestamp}-${randomHash}-${sanitizedBase}${ext}`;
      
      logger.debug('Generated video filename:', {
        original: file.originalname,
        sanitized: finalName,
        size: file.size
      });

      cb(null, finalName);
    } catch (error) {
      logger.error('Video filename generation failed', error);
      cb(new AppError('Video filename generation failed', 500, 'VIDEO_FILENAME_ERROR'), '');
    }
  }
});

/**
 * Video file filter with comprehensive validation
 */
const videoFileFilter = (
  req: Request, 
  file: Express.Multer.File, 
  cb: FileFilterCallback
): void => {
  try {
    const ext = path.extname(file.originalname).toLowerCase();
    const mimeType = file.mimetype.toLowerCase();

    // Log video upload attempt
    logger.info('Video upload attempt', {
      originalname: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      clientIp: req.ip,
      userAgent: req.get('User-Agent')
    });

    // Basic validations using video config
    if (!VIDEO_CONFIG.FORMATS.INPUT_EXTENSIONS.includes(ext as any)) {
      logger.warn('Disallowed video extension:', { 
        extension: ext, 
        filename: file.originalname 
      });
      return cb(new AppError(`Video extension '${ext}' not allowed`, 400, 'INVALID_VIDEO_EXTENSION'));
    }

    if (!VIDEO_CONFIG.FORMATS.INPUT_MIME_TYPES.includes(mimeType as any)) {
      logger.warn('Disallowed video MIME type:', { 
        mimeType, 
        filename: file.originalname 
      });
      return cb(new AppError(`Video type '${mimeType}' not allowed`, 400, 'INVALID_VIDEO_MIME_TYPE'));
    }

    // Check dangerous extensions
    if (VIDEO_CONFIG.SECURITY.DANGEROUS_EXTENSIONS.includes(ext as any)) {
      logger.warn('Dangerous extension detected in video:', { 
        extension: ext, 
        filename: file.originalname 
      });
      return cb(new AppError('Dangerous file extension detected', 400, 'DANGEROUS_VIDEO_EXTENSION'));
    }

    // Verify MIME type matches extension
    const expectedExtensions = VIDEO_CONFIG.FORMATS.MIME_TO_EXTENSION[mimeType as keyof typeof VIDEO_CONFIG.FORMATS.MIME_TO_EXTENSION];
    if (expectedExtensions && Array.isArray(expectedExtensions) && !expectedExtensions.includes(ext as any)) {
      logger.warn('Video MIME type mismatch:', {
        extension: ext,
        mimeType,
        expectedExtensions,
        filename: file.originalname
      });
      return cb(new AppError('Video extension and type mismatch', 400, 'VIDEO_TYPE_MISMATCH'));
    }

    // Check filename constraints
    if (file.originalname.length > VIDEO_CONFIG.FILE_LIMITS.MAX_FILENAME_LENGTH) {
      logger.warn('Video filename too long', {
        length: file.originalname.length,
        maxLength: VIDEO_CONFIG.FILE_LIMITS.MAX_FILENAME_LENGTH,
        filename: file.originalname
      });
      return cb(new AppError(
        `Video filename too long (max ${VIDEO_CONFIG.FILE_LIMITS.MAX_FILENAME_LENGTH} characters)`,
        400,
        'VIDEO_FILENAME_TOO_LONG'
      ));
    }

    // Check for null bytes in filename
    if (file.originalname.includes('\0')) {
      logger.warn('Null byte in video filename detected', { filename: file.originalname });
      return cb(new AppError('Invalid video filename format', 400, 'INVALID_VIDEO_FILENAME'));
    }

    // Additional video-specific checks can be added here
    cb(null, true);
  } catch (error) {
    logger.error('Video file filter error:', {
      error: error instanceof Error ? error.message : error,
      filename: file.originalname,
      mimetype: file.mimetype
    });
    cb(new AppError('Video file validation failed', 500, 'VIDEO_VALIDATION_ERROR'));
  }
};

/**
 * Video upload multer configuration
 */
export const videoUpload = multer({
  storage: videoStorage,
  fileFilter: videoFileFilter,
  limits: {
    fileSize: VIDEO_CONFIG.FILE_LIMITS.MAX_SIZE,
    files: 1, // Only allow single video upload
    fields: 10, // Limit form fields
    fieldNameSize: 100,
    fieldSize: 1024 * 50, // 50KB for form fields (larger for video metadata)
  },
});

/**
 * Video-specific Multer error handler
 */
export const handleVideoMulterError = (
  error: any,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (error instanceof multer.MulterError) {
    let message = 'Video upload error';
    let code = 'VIDEO_UPLOAD_ERROR';
    
    switch (error.code) {
      case 'LIMIT_FILE_SIZE':
        const maxSizeMB = Math.round(VIDEO_CONFIG.FILE_LIMITS.MAX_SIZE / (1024 * 1024));
        message = `Video file too large. Maximum size allowed is ${maxSizeMB}MB`;
        code = 'VIDEO_FILE_TOO_LARGE';
        break;
        
      case 'LIMIT_FILE_COUNT':
        message = 'Too many video files. Only one video file allowed per upload';
        code = 'TOO_MANY_VIDEO_FILES';
        break;
        
      case 'LIMIT_FIELD_COUNT':
        message = 'Too many form fields in video upload';
        code = 'TOO_MANY_VIDEO_FIELDS';
        break;
        
      case 'LIMIT_UNEXPECTED_FILE':
        message = 'Unexpected file field. Use "video" as the field name';
        code = 'UNEXPECTED_VIDEO_FIELD';
        break;
        
      case 'LIMIT_PART_COUNT':
        message = 'Too many parts in video multipart data';
        code = 'TOO_MANY_VIDEO_PARTS';
        break;
        
      case 'LIMIT_FIELD_KEY':
        message = 'Video form field name too long';
        code = 'VIDEO_FIELD_NAME_TOO_LONG';
        break;
        
      case 'LIMIT_FIELD_VALUE':
        message = 'Video form field value too long';
        code = 'VIDEO_FIELD_VALUE_TOO_LONG';
        break;
        
      default:
        message = error.message || 'Video upload error';
        break;
    }
    
    logger.warn('Video multer error:', {
      code: error.code,
      message,
      field: error.field,
      clientIp: req.ip,
      filename: req.file?.originalname,
      userAgent: req.get('User-Agent')
    });
    
    res.status(400).json({
      success: false,
      error: {
        code,
        message,
        details: NODE_ENV === 'development' ? error.message : undefined
      },
      timestamp: new Date().toISOString()
    });
    return;
  }
  
  next(error);
};

/**
 * Video file post-upload validation middleware
 */
export const validateUploadedVideo = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.file) {
      return next();
    }

    const videoInfo = {
      path: req.file.path,
      originalName: req.file.originalname,
      size: req.file.size,
      mimeType: req.file.mimetype
    };

    // Perform comprehensive video validation
    await VideoFileValidationService.validateVideoFile(videoInfo);
    
    logger.info('Video upload validation completed', {
      filename: req.file.filename,
      originalname: req.file.originalname,
      size: req.file.size
    });

    next();
  } catch (error) {
    // Clean up the uploaded file if validation fails
    if (req.file?.path) {
      try {
        await fs.promises.unlink(req.file.path);
        logger.info('Cleaned up invalid video file', { path: req.file.path });
      } catch (unlinkError) {
        logger.error('Failed to cleanup invalid video file', { 
          path: req.file.path, 
          error: unlinkError 
        });
      }
    }

    logger.error('Video upload validation failed:', {
      error: error instanceof Error ? error.message : error,
      filename: req.file?.filename,
      originalname: req.file?.originalname
    });

    if (error instanceof AppError) {
      return next(error);
    }

    next(new AppError('Video validation failed', 400, 'VIDEO_VALIDATION_FAILED'));
  }
};

/**
 * Cleanup utility for removing old video uploads
 */
export const cleanupOldVideoUploads = async (maxAgeHours = VIDEO_CONFIG.CLEANUP.MAX_AGE_HOURS): Promise<void> => {
  try {
    const files = await fs.promises.readdir(VIDEO_UPLOAD_DIR);
    const cutoffTime = Date.now() - (maxAgeHours * 60 * 60 * 1000);
    let deletedCount = 0;
    let failedCount = 0;
    let totalSizeDeleted = 0;

    for (const file of files) {
      const filePath = path.join(VIDEO_UPLOAD_DIR, file);
      
      try {
        const stats = await fs.promises.stat(filePath);
        
        if (stats.mtime.getTime() < cutoffTime) {
          totalSizeDeleted += stats.size;
          await fs.promises.unlink(filePath);
          deletedCount++;
        }
      } catch (error) {
        failedCount++;
        logger.warn('Failed to process video file during cleanup', { 
          filePath, 
          error: error instanceof Error ? error.message : error 
        });
      }
    }

    if (deletedCount > 0 || failedCount > 0) {
      logger.info('Video upload cleanup completed', {
        deletedCount,
        failedCount,
        totalSizeDeletedMB: Math.round(totalSizeDeleted / (1024 * 1024)),
        maxAgeHours,
        uploadDir: VIDEO_UPLOAD_DIR,
      });
    }

  } catch (error) {
    logger.error('Video upload cleanup failed', {
      uploadDir: VIDEO_UPLOAD_DIR,
      maxAgeHours,
      error: error instanceof Error ? error.message : error
    });
  }
};

/**
 * Setup periodic video cleanup
 */
export const setupPeriodicVideoCleanup = (): NodeJS.Timeout => {
  const intervalId = setInterval(() => {
    cleanupOldVideoUploads().catch(error => {
      logger.error('Periodic video cleanup failed', error);
    });
  }, VIDEO_CONFIG.CLEANUP.CLEANUP_INTERVAL);

  logger.info('Periodic video upload cleanup scheduled', {
    intervalMs: VIDEO_CONFIG.CLEANUP.CLEANUP_INTERVAL,
    maxAgeHours: VIDEO_CONFIG.CLEANUP.MAX_AGE_HOURS
  });

  return intervalId;
};

/**
 * Get video upload configuration
 */
export const getVideoUploadConfig = () => VIDEO_CONFIG;