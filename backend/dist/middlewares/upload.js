"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupPeriodicCleanup = exports.cleanupOldUploads = exports.handleMulterError = exports.upload = void 0;
// src/middleware/upload.middleware.ts
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const crypto_1 = __importDefault(require("crypto"));
const env_1 = require("../config/env");
const logger_1 = __importDefault(require("../utils/logger"));
const error_1 = require("../utils/error");
const image_config_1 = require("../config/image.config");
/**
 * Initialize upload directory with proper permissions
 */
const initializeUploadDir = () => {
    try {
        if (!fs_1.default.existsSync(env_1.UPLOAD_DIR)) {
            fs_1.default.mkdirSync(env_1.UPLOAD_DIR, { recursive: true, mode: 0o755 });
            logger_1.default.info('Upload directory created', { path: env_1.UPLOAD_DIR });
        }
        fs_1.default.accessSync(env_1.UPLOAD_DIR, fs_1.default.constants.W_OK | fs_1.default.constants.R_OK);
        logger_1.default.debug('Upload directory initialized successfully', { path: env_1.UPLOAD_DIR });
    }
    catch (error) {
        logger_1.default.error('Failed to initialize upload directory:', {
            path: env_1.UPLOAD_DIR,
            error: error instanceof Error ? error.message : error
        });
        throw new error_1.AppError('Upload directory initialization failed', 500, 'UPLOAD_DIR_ERROR');
    }
};
// Initialize upload directory on module load
initializeUploadDir();
/**
 * Basic filename sanitization function
 */
const sanitizeFilename = (filename) => {
    return filename
        .replace(/[^\w\s.-]/g, '') // Remove special characters except spaces, dots, and hyphens
        .replace(/\s+/g, '-') // Replace spaces with hyphens
        .replace(/-+/g, '-') // Replace multiple hyphens with single hyphen
        .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens
};
/**
 * Enhanced storage configuration using centralized validation
 */
const storage = multer_1.default.diskStorage({
    destination: (_req, _file, cb) => {
        try {
            // Ensure directory exists for each request
            if (!fs_1.default.existsSync(env_1.UPLOAD_DIR)) {
                fs_1.default.mkdirSync(env_1.UPLOAD_DIR, { recursive: true, mode: 0o755 });
            }
            cb(null, env_1.UPLOAD_DIR);
        }
        catch (error) {
            logger_1.default.error('Destination setup failed', error);
            cb(new error_1.AppError('Upload destination unavailable', 500, 'DESTINATION_ERROR'), '');
        }
    },
    filename: (_req, file, cb) => {
        try {
            const ext = path_1.default.extname(file.originalname).toLowerCase();
            const baseName = path_1.default.basename(file.originalname, ext);
            // Use local filename sanitization
            const sanitizedBase = sanitizeFilename(baseName);
            // Generate cryptographically secure random string
            const randomHash = crypto_1.default.randomBytes(8).toString('hex');
            // Create timestamp with milliseconds for uniqueness
            const timestamp = Date.now();
            // Construct final filename
            const finalName = `${timestamp}-${randomHash}-${sanitizedBase}${ext}`;
            logger_1.default.debug('Generated filename:', {
                original: file.originalname,
                sanitized: finalName,
                size: file.size
            });
            cb(null, finalName);
        }
        catch (error) {
            logger_1.default.error('Filename generation failed', error);
            cb(new error_1.AppError('Filename generation failed', 500, 'FILENAME_ERROR'), '');
        }
    }
});
/**
 * Enhanced file filter using centralized validation
 */
const fileFilter = (req, file, cb) => {
    try {
        const ext = path_1.default.extname(file.originalname).toLowerCase();
        const mimeType = file.mimetype.toLowerCase();
        // Log file upload attempt
        logger_1.default.debug('File upload attempt', {
            originalname: file.originalname,
            mimeType: file.mimetype,
            size: file.size,
            clientIp: req.ip,
            userAgent: req.get('User-Agent')
        });
        // Basic validations using centralized config
        if (!image_config_1.IMAGE_CONFIG.FORMATS.INPUT_EXTENSIONS.includes(ext)) {
            logger_1.default.warn('Disallowed file extension:', {
                extension: ext,
                filename: file.originalname
            });
            return cb(new error_1.AppError(`File extension '${ext}' not allowed`, 400, 'INVALID_EXTENSION'));
        }
        if (!image_config_1.IMAGE_CONFIG.FORMATS.INPUT_MIME_TYPES.includes(mimeType)) {
            logger_1.default.warn('Disallowed MIME type:', {
                mimeType,
                filename: file.originalname
            });
            return cb(new error_1.AppError(`File type '${mimeType}' not allowed`, 400, 'INVALID_MIME_TYPE'));
        }
        // Check dangerous extensions
        if (image_config_1.IMAGE_CONFIG.SECURITY.DANGEROUS_EXTENSIONS.includes(ext)) {
            logger_1.default.warn('Dangerous extension detected:', {
                extension: ext,
                filename: file.originalname
            });
            return cb(new error_1.AppError('Dangerous file extension detected', 400, 'DANGEROUS_EXTENSION'));
        }
        // Verify MIME type matches extension using centralized config
        const expectedExtensions = image_config_1.IMAGE_CONFIG.FORMATS.MIME_TO_EXTENSION[mimeType];
        if (expectedExtensions && Array.isArray(expectedExtensions) && !expectedExtensions.includes(ext)) {
            logger_1.default.warn('MIME type mismatch:', {
                extension: ext,
                mimeType,
                expectedExtensions,
                filename: file.originalname
            });
            return cb(new error_1.AppError('File extension and type mismatch', 400, 'TYPE_MISMATCH'));
        }
        // Check filename constraints
        if (file.originalname.length > image_config_1.IMAGE_CONFIG.FILE_LIMITS.MAX_FILENAME_LENGTH) {
            logger_1.default.warn('Filename too long', {
                length: file.originalname.length,
                maxLength: image_config_1.IMAGE_CONFIG.FILE_LIMITS.MAX_FILENAME_LENGTH,
                filename: file.originalname
            });
            return cb(new error_1.AppError(`Filename too long (max ${image_config_1.IMAGE_CONFIG.FILE_LIMITS.MAX_FILENAME_LENGTH} characters)`, 400, 'FILENAME_TOO_LONG'));
        }
        // Check for null bytes in filename
        if (file.originalname.includes('\0')) {
            logger_1.default.warn('Null byte in filename detected', { filename: file.originalname });
            return cb(new error_1.AppError('Invalid filename format', 400, 'INVALID_FILENAME'));
        }
        cb(null, true);
    }
    catch (error) {
        logger_1.default.error('File filter error:', {
            error: error instanceof Error ? error.message : error,
            filename: file.originalname,
            mimetype: file.mimetype
        });
        cb(new error_1.AppError('File validation failed', 500, 'VALIDATION_ERROR'));
    }
};
/**
 * Multer configuration with centralized limits
 */
exports.upload = (0, multer_1.default)({
    storage,
    fileFilter,
    limits: {
        fileSize: env_1.MAX_FILE_SIZE_BYTES || image_config_1.IMAGE_CONFIG.FILE_LIMITS.MAX_SIZE,
        files: 5, // Only allow single file upload
        fields: 10, // Limit form fields
        fieldNameSize: 100,
        fieldSize: 1024 * 10, // 10KB for form fields
    },
});
/**
 * Enhanced Multer error handler
 */
const handleMulterError = (error, req, res, next) => {
    if (error instanceof multer_1.default.MulterError) {
        let message = 'File upload error';
        let code = 'UPLOAD_ERROR';
        switch (error.code) {
            case 'LIMIT_FILE_SIZE':
                const maxSizeMB = Math.round((env_1.MAX_FILE_SIZE_BYTES || image_config_1.IMAGE_CONFIG.FILE_LIMITS.MAX_SIZE) / (1024 * 1024));
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
        logger_1.default.warn('Multer error:', {
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
                details: env_1.NODE_ENV === 'development' ? error.message : undefined
            },
            timestamp: new Date().toISOString()
        });
        return;
    }
    next(error);
};
exports.handleMulterError = handleMulterError;
/**
 * Cleanup utility for removing old uploaded files
 */
const cleanupOldUploads = async (maxAgeHours = image_config_1.IMAGE_CONFIG.CLEANUP.MAX_AGE_HOURS) => {
    try {
        const files = await fs_1.default.promises.readdir(env_1.UPLOAD_DIR);
        const cutoffTime = Date.now() - (maxAgeHours * 60 * 60 * 1000);
        let deletedCount = 0;
        let failedCount = 0;
        for (const file of files) {
            const filePath = path_1.default.join(env_1.UPLOAD_DIR, file);
            try {
                const stats = await fs_1.default.promises.stat(filePath);
                if (stats.mtime.getTime() < cutoffTime) {
                    await fs_1.default.promises.unlink(filePath);
                    deletedCount++;
                }
            }
            catch (error) {
                failedCount++;
                logger_1.default.warn('Failed to process file during cleanup', {
                    filePath,
                    error: error instanceof Error ? error.message : error
                });
            }
        }
        if (deletedCount > 0 || failedCount > 0) {
            logger_1.default.info('Upload cleanup completed', {
                deletedCount,
                failedCount,
                maxAgeHours,
                uploadDir: env_1.UPLOAD_DIR,
            });
        }
    }
    catch (error) {
        logger_1.default.error('Upload cleanup failed', {
            uploadDir: env_1.UPLOAD_DIR,
            maxAgeHours,
            error: error instanceof Error ? error.message : error
        });
    }
};
exports.cleanupOldUploads = cleanupOldUploads;
/**
 * Setup periodic cleanup (call this from your app initialization)
 */
const setupPeriodicCleanup = () => {
    const intervalId = setInterval(() => {
        (0, exports.cleanupOldUploads)().catch(error => {
            logger_1.default.error('Periodic cleanup failed', error);
        });
    }, image_config_1.IMAGE_CONFIG.CLEANUP.CLEANUP_INTERVAL);
    logger_1.default.info('Periodic upload cleanup scheduled', {
        intervalMs: image_config_1.IMAGE_CONFIG.CLEANUP.CLEANUP_INTERVAL,
        maxAgeHours: image_config_1.IMAGE_CONFIG.CLEANUP.MAX_AGE_HOURS
    });
    return intervalId;
};
exports.setupPeriodicCleanup = setupPeriodicCleanup;
