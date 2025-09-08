"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FileValidationService = void 0;
// src/services/file-validation.service.ts
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const logger_1 = __importDefault(require("../utils/logger"));
const error_1 = require("../utils/error");
class FileValidationService {
    static DEFAULT_OPTIONS = {
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
    static DANGEROUS_EXTENSIONS = ['.exe', '.bat', '.cmd', '.scr', '.pif', '.com'];
    static VIRUS_SIGNATURES = ['PK', 'MZ', '<!DOCTYPE', '<html>', '<script>'];
    static MAX_FILENAME_LENGTH = 255;
    /**
     * Comprehensive file validation
     */
    static async validateFile(fileInfo, options = {}) {
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
    static validateBasicFileInfo(fileInfo, opts) {
        const { originalName, size, mimeType } = fileInfo;
        // Filename validation
        if (!originalName || originalName.trim().length === 0) {
            throw new error_1.AppError('Invalid filename', 400, 'INVALID_FILENAME');
        }
        if (originalName.length > this.MAX_FILENAME_LENGTH) {
            throw new error_1.AppError(`Filename too long (max ${this.MAX_FILENAME_LENGTH} characters)`, 400, 'FILENAME_TOO_LONG');
        }
        if (originalName.includes('\0')) {
            throw new error_1.AppError('Invalid filename format', 400, 'INVALID_FILENAME');
        }
        // Size validation
        if (size < opts.minSize) {
            throw new error_1.AppError(`File too small (min ${opts.minSize} bytes)`, 400, 'FILE_TOO_SMALL');
        }
        if (size > opts.maxSize) {
            throw new error_1.AppError(`File too large (max ${Math.round(opts.maxSize / (1024 * 1024))}MB)`, 400, 'FILE_TOO_LARGE');
        }
        // MIME type validation
        if (!opts.allowedMimeTypes.includes(mimeType.toLowerCase())) {
            throw new error_1.AppError(`Unsupported file type: ${mimeType}`, 400, 'UNSUPPORTED_MIME_TYPE');
        }
        // Extension validation
        const ext = path_1.default.extname(originalName).toLowerCase();
        if (!opts.allowedExtensions.includes(ext)) {
            throw new error_1.AppError(`File extension '${ext}' not allowed`, 400, 'INVALID_EXTENSION');
        }
        if (this.DANGEROUS_EXTENSIONS.includes(ext)) {
            throw new error_1.AppError('Dangerous file extension detected', 400, 'DANGEROUS_EXTENSION');
        }
        // MIME type and extension consistency
        this.validateMimeTypeExtensionMatch(mimeType, ext);
    }
    /**
     * Validate file system properties
     */
    static async validateFileSystem(fileInfo, opts) {
        try {
            const stats = await promises_1.default.stat(fileInfo.path);
            if (!stats.isFile()) {
                throw new error_1.AppError('Path is not a file', 400, 'INVALID_FILE');
            }
            if (stats.size === 0) {
                throw new error_1.AppError('File is empty', 400, 'EMPTY_FILE');
            }
            if (stats.size !== fileInfo.size) {
                logger_1.default.warn('File size mismatch', {
                    reported: fileInfo.size,
                    actual: stats.size,
                    path: fileInfo.path
                });
            }
            // Check file accessibility
            await promises_1.default.access(fileInfo.path, promises_1.default.constants.R_OK);
        }
        catch (error) {
            if (error instanceof error_1.AppError) {
                throw error;
            }
            if (error.code === 'ENOENT') {
                throw new error_1.AppError('File not found', 400, 'FILE_NOT_FOUND');
            }
            if (error.code === 'EACCES') {
                throw new error_1.AppError('File is not readable', 400, 'FILE_NOT_READABLE');
            }
            logger_1.default.error('File system validation failed', {
                path: fileInfo.path,
                error: error.message
            });
            throw new error_1.AppError('File validation failed', 400, 'FILE_VALIDATION_ERROR');
        }
    }
    static isConversionSUpported(fromMimeType, toFormat) {
        const conversionMap = {
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
    static async validateFileContent(fileInfo, opts) {
        try {
            const buffer = await promises_1.default.readFile(fileInfo.path);
            // Check for virus signatures in first 1KB
            if (opts.validateContent) {
                const header = buffer.slice(0, 1024).toString();
                for (const signature of this.VIRUS_SIGNATURES) {
                    if (header.includes(signature)) {
                        logger_1.default.warn('Potential malicious content detected', {
                            path: fileInfo.path,
                            signature,
                            mimeType: fileInfo.mimeType
                        });
                        throw new error_1.AppError('Potentially malicious content detected', 400, 'MALICIOUS_CONTENT');
                    }
                }
            }
            // Validate file header matches MIME type
            if (opts.validateHeader) {
                const isValidHeader = this.validateFileHeader(buffer, fileInfo.mimeType);
                if (!isValidHeader) {
                    throw new error_1.AppError('File header does not match MIME type', 400, 'INVALID_FILE_HEADER');
                }
            }
        }
        catch (error) {
            if (error instanceof error_1.AppError) {
                throw error;
            }
            logger_1.default.error('File content validation error', {
                path: fileInfo.path,
                error: error.message
            });
            throw new error_1.AppError('File content validation failed', 400, 'CONTENT_VALIDATION_ERROR');
        }
    }
    /**
     * Validate MIME type and extension match
     */
    static validateMimeTypeExtensionMatch(mimeType, extension) {
        const expectedMimeTypes = {
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
            throw new error_1.AppError('File extension and MIME type mismatch', 400, 'TYPE_MISMATCH');
        }
    }
    /**
     * Validate file header matches MIME type
     */
    static validateFileHeader(buffer, mimeType) {
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
                logger_1.default.debug('File header validation skipped for MIME type:', mimeType);
                return true;
        }
    }
    /**
     * Sanitize filename
     */
    static sanitizeFilename(filename) {
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
    static isSupportedMimeType(mimeType) {
        return this.DEFAULT_OPTIONS.allowedMimeTypes.includes(mimeType.toLowerCase());
    }
}
exports.FileValidationService = FileValidationService;
