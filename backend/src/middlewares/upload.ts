// src/middleware/upload.middleware.ts
import multer, { FileFilterCallback } from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { MAX_FILE_SIZE_BYTES, UPLOAD_DIR, NODE_ENV } from '../config/env';
import logger from '../utils/logger';
import { AppError } from '../utils/error';
import { FileValidationService } from '../service/validationservice';
import { IMAGE_CONFIG } from '../config/image.config';

/**
 * Initialize upload directory with proper permissions
 */
const initializeUploadDir = (): void => {
  try {
    if (!fs.existsSync(UPLOAD_DIR)) {
      fs.mkdirSync(UPLOAD_DIR, { recursive: true, mode: 0o755 });
      logger.info('Upload directory created', { path: UPLOAD_DIR });
    }

    fs.accessSync(UPLOAD_DIR, fs.constants.W_OK | fs.constants.R_OK);
    logger.debug('Upload directory initialized successfully', { path: UPLOAD_DIR });
  } catch (error) {
    logger.error('Failed to initialize upload directory:', {
      path: UPLOAD_DIR,
      error: error instanceof Error ? error.message : error
    });
    throw new AppError('Upload directory initialization failed', 500, 'UPLOAD_DIR_ERROR');
  }
};

// Initialize upload directory on module load
initializeUploadDir();

/**
 * Basic filename sanitization function
 */
const sanitizeFilename = (filename: string): string => {
  return filename
    .replace(/[^\w\s.-]/g, '') // Remove special characters except spaces, dots, and hyphens
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Replace multiple hyphens with single hyphen
    .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens
};

/**
 * Enhanced storage configuration using centralized validation
 */
const storage = multer.diskStorage({
  destination: (_req: Request, _file: Express.Multer.File, cb) => {
    try {
      // Ensure directory exists for each request
      if (!fs.existsSync(UPLOAD_DIR)) {
        fs.mkdirSync(UPLOAD_DIR, { recursive: true, mode: 0o755 });
      }
      cb(null, UPLOAD_DIR);
    } catch (error) {
      logger.error('Destination setup failed', error);
      cb(new AppError('Upload destination unavailable', 500, 'DESTINATION_ERROR'), '');
    }
  },

  filename: (_req: Request, file: Express.Multer.File, cb) => {
    try {
      const ext = path.extname(file.originalname).toLowerCase();
      const baseName = path.basename(file.originalname, ext);
      
      // Use local filename sanitization
      const sanitizedBase = sanitizeFilename(baseName);

      // Generate cryptographically secure random string
      const randomHash = crypto.randomBytes(8).toString('hex');
      
      // Create timestamp with milliseconds for uniqueness
      const timestamp = Date.now();
      
      // Construct final filename
      const finalName = `${timestamp}-${randomHash}-${sanitizedBase}${ext}`;
      
      logger.debug('Generated filename:', {
        original: file.originalname,
        sanitized: finalName,
        size: file.size
      });

      cb(null, finalName);
    } catch (error) {
      logger.error('Filename generation failed', error);
      cb(new AppError('Filename generation failed', 500, 'FILENAME_ERROR'), '');
    }
  }
});

/**
 * Enhanced file filter using centralized validation
 */
const fileFilter = (
  req: Request, 
  file: Express.Multer.File, 
  cb: FileFilterCallback
): void => {
  try {
    const ext = path.extname(file.originalname).toLowerCase();
    const mimeType = file.mimetype.toLowerCase();

    // Log file upload attempt
    logger.debug('File upload attempt', {
      originalname: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      clientIp: req.ip,
      userAgent: req.get('User-Agent')
    });

    // Basic validations using centralized config
    if (!IMAGE_CONFIG.FORMATS.INPUT_EXTENSIONS.includes(ext as any)) {
      logger.warn('Disallowed file extension:', { 
        extension: ext, 
        filename: file.originalname 
      });
      return cb(new AppError(`File extension '${ext}' not allowed`, 400, 'INVALID_EXTENSION'));
    }

    if (!IMAGE_CONFIG.FORMATS.INPUT_MIME_TYPES.includes(mimeType as any)) {
      logger.warn('Disallowed MIME type:', { 
        mimeType, 
        filename: file.originalname 
      });
      return cb(new AppError(`File type '${mimeType}' not allowed`, 400, 'INVALID_MIME_TYPE'));
    }

    // Check dangerous extensions
    if (IMAGE_CONFIG.SECURITY.DANGEROUS_EXTENSIONS.includes(ext as any)) {
      logger.warn('Dangerous extension detected:', { 
        extension: ext, 
        filename: file.originalname 
      });
      return cb(new AppError('Dangerous file extension detected', 400, 'DANGEROUS_EXTENSION'));
    }

    // Verify MIME type matches extension using centralized config
    const expectedExtensions = IMAGE_CONFIG.FORMATS.MIME_TO_EXTENSION[mimeType as keyof typeof IMAGE_CONFIG.FORMATS.MIME_TO_EXTENSION];
    if (expectedExtensions && Array.isArray(expectedExtensions) && !expectedExtensions.includes(ext as any)) {
      logger.warn('MIME type mismatch:', {
        extension: ext,
        mimeType,
        expectedExtensions,
        filename: file.originalname
      });
      return cb(new AppError('File extension and type mismatch', 400, 'TYPE_MISMATCH'));
    }

    // Check filename constraints
    if (file.originalname.length > IMAGE_CONFIG.FILE_LIMITS.MAX_FILENAME_LENGTH) {
      logger.warn('Filename too long', {
        length: file.originalname.length,
        maxLength: IMAGE_CONFIG.FILE_LIMITS.MAX_FILENAME_LENGTH,
        filename: file.originalname
      });
      return cb(new AppError(
        `Filename too long (max ${IMAGE_CONFIG.FILE_LIMITS.MAX_FILENAME_LENGTH} characters)`,
        400,
        'FILENAME_TOO_LONG'
      ));
    }

    // Check for null bytes in filename
    if (file.originalname.includes('\0')) {
      logger.warn('Null byte in filename detected', { filename: file.originalname });
      return cb(new AppError('Invalid filename format', 400, 'INVALID_FILENAME'));
    }

    cb(null, true);
  } catch (error) {
    logger.error('File filter error:', {
      error: error instanceof Error ? error.message : error,
      filename: file.originalname,
      mimetype: file.mimetype
    });
    cb(new AppError('File validation failed', 500, 'VALIDATION_ERROR'));
  }
};

/**
 * Multer configuration with centralized limits
 */
export const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE_BYTES || IMAGE_CONFIG.FILE_LIMITS.MAX_SIZE,
    files: 5, // Only allow single file upload
    fields: 10, // Limit form fields
    fieldNameSize: 100,
    fieldSize: 1024 * 10, // 10KB for form fields
  },
});

/**
 * Enhanced Multer error handler
 */
export const handleMulterError = (
  error: any,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (error instanceof multer.MulterError) {
    let message = 'File upload error';
    let code = 'UPLOAD_ERROR';
    
    switch (error.code) {
      case 'LIMIT_FILE_SIZE':
        const maxSizeMB = Math.round((MAX_FILE_SIZE_BYTES || IMAGE_CONFIG.FILE_LIMITS.MAX_SIZE) / (1024 * 1024));
        message = `File too large. Maximum size allowed is ${maxSizeMB}MB`;
        code = 'FILE_TOO_LARGE';
        break;
        
      case 'LIMIT_FILE_COUNT':
        message = 'Too many files. Only one file allowed per upload';
        code = 'TOO_MANY_FILES';
        break;
        
      case 'LIMIT_FIELD_COUNT':
        message = 'Too many form fields';
        code = 'TOO_MANY_FIELDS';
        break;
        
      case 'LIMIT_UNEXPECTED_FILE':
        message = 'Unexpected file field. Use "image" as the field name';
        code = 'UNEXPECTED_FIELD';
        break;
        
      case 'LIMIT_PART_COUNT':
        message = 'Too many parts in multipart data';
        code = 'TOO_MANY_PARTS';
        break;
        
      case 'LIMIT_FIELD_KEY':
        message = 'Field name too long';
        code = 'FIELD_NAME_TOO_LONG';
        break;
        
      case 'LIMIT_FIELD_VALUE':
        message = 'Field value too long';
        code = 'FIELD_VALUE_TOO_LONG';
        break;
        
      default:
        message = error.message || 'File upload error';
        break;
    }
    
    logger.warn('Multer error:', {
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
 * Cleanup utility for removing old uploaded files
 */
export const cleanupOldUploads = async (maxAgeHours = IMAGE_CONFIG.CLEANUP.MAX_AGE_HOURS): Promise<void> => {
  try {
    const files = await fs.promises.readdir(UPLOAD_DIR);
    const cutoffTime = Date.now() - (maxAgeHours * 60 * 60 * 1000);
    let deletedCount = 0;
    let failedCount = 0;

    for (const file of files) {
      const filePath = path.join(UPLOAD_DIR, file);
      
      try {
        const stats = await fs.promises.stat(filePath);
        
        if (stats.mtime.getTime() < cutoffTime) {
          await fs.promises.unlink(filePath);
          deletedCount++;
        }
      } catch (error) {
        failedCount++;
        logger.warn('Failed to process file during cleanup', { 
          filePath, 
          error: error instanceof Error ? error.message : error 
        });
      }
    }

    if (deletedCount > 0 || failedCount > 0) {
      logger.info('Upload cleanup completed', {
        deletedCount,
        failedCount,
        maxAgeHours,
        uploadDir: UPLOAD_DIR,
      });
    }

  } catch (error) {
    logger.error('Upload cleanup failed', {
      uploadDir: UPLOAD_DIR,
      maxAgeHours,
      error: error instanceof Error ? error.message : error
    });
  }
};

/**
 * Setup periodic cleanup (call this from your app initialization)
 */
export const setupPeriodicCleanup = (): NodeJS.Timeout => {
  const intervalId = setInterval(() => {
    cleanupOldUploads().catch(error => {
      logger.error('Periodic cleanup failed', error);
    });
  }, IMAGE_CONFIG.CLEANUP.CLEANUP_INTERVAL);

  logger.info('Periodic upload cleanup scheduled', {
    intervalMs: IMAGE_CONFIG.CLEANUP.CLEANUP_INTERVAL,
    maxAgeHours: IMAGE_CONFIG.CLEANUP.MAX_AGE_HOURS
  });

  return intervalId;
};