"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.VideoFileValidationService = void 0;
// src/services/video-file-validation.service.ts
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const logger_1 = __importDefault(require("../utils/logger"));
const error_1 = require("../utils/error");
class VideoFileValidationService {
    static DEFAULT_OPTIONS = {
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
    static DANGEROUS_EXTENSIONS = ['.exe', '.bat', '.cmd', '.scr', '.pif', '.com'];
    static VIRUS_SIGNATURES = ['MZ', '<!DOCTYPE', '<html>', '<script>', 'javascript:', 'vbscript:'];
    static MAX_FILENAME_LENGTH = 255;
    // Video format magic numbers/signatures
    static VIDEO_SIGNATURES = {
        'video/mp4': [
            [0x66, 0x74, 0x79, 0x70], // ftyp
            [0x6D, 0x64, 0x61, 0x74], // mdat
            [0x6D, 0x6F, 0x6F, 0x76] // moov
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
    static async validateVideoFile(videoInfo, options = {}) {
        const opts = { ...this.DEFAULT_OPTIONS, ...options };
        logger_1.default.info('Starting video file validation', {
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
        logger_1.default.info('Video file validation completed successfully', {
            file: videoInfo.originalName
        });
    }
    /**
     * Validate basic video file information
     */
    static validateBasicVideoFileInfo(videoInfo, opts) {
        const { originalName, size, mimeType } = videoInfo;
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
            throw new error_1.AppError(`Unsupported video type: ${mimeType}`, 400, 'UNSUPPORTED_MIME_TYPE');
        }
        // Extension validation
        const ext = path_1.default.extname(originalName).toLowerCase();
        if (!opts.allowedExtensions.includes(ext)) {
            throw new error_1.AppError(`Video extension '${ext}' not allowed`, 400, 'INVALID_EXTENSION');
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
    static async validateFileSystem(videoInfo, opts) {
        try {
            const stats = await promises_1.default.stat(videoInfo.path);
            if (!stats.isFile()) {
                throw new error_1.AppError('Path is not a file', 400, 'INVALID_FILE');
            }
            if (stats.size === 0) {
                throw new error_1.AppError('Video file is empty', 400, 'EMPTY_FILE');
            }
            if (stats.size !== videoInfo.size) {
                logger_1.default.warn('Video file size mismatch', {
                    reported: videoInfo.size,
                    actual: stats.size,
                    path: videoInfo.path
                });
            }
            // Check file accessibility
            await promises_1.default.access(videoInfo.path, promises_1.default.constants.R_OK);
        }
        catch (error) {
            if (error instanceof error_1.AppError) {
                throw error;
            }
            if (error.code === 'ENOENT') {
                throw new error_1.AppError('Video file not found', 400, 'FILE_NOT_FOUND');
            }
            if (error.code === 'EACCES') {
                throw new error_1.AppError('Video file is not readable', 400, 'FILE_NOT_READABLE');
            }
            logger_1.default.error('Video file system validation failed', {
                path: videoInfo.path,
                error: error.message
            });
            throw new error_1.AppError('Video file validation failed', 400, 'FILE_VALIDATION_ERROR');
        }
    }
    /**
     * Check if video processing operation is supported
     */
    static isVideoProcessingSupported(fromMimeType, operation) {
        const supportedOperations = {
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
    static async validateVideoFileContent(videoInfo, opts) {
        try {
            const buffer = await promises_1.default.readFile(videoInfo.path);
            // Check for virus signatures in first 2KB
            if (opts.validateContent) {
                const header = buffer.slice(0, 2048).toString();
                for (const signature of this.VIRUS_SIGNATURES) {
                    if (header.includes(signature)) {
                        logger_1.default.warn('Potential malicious content detected in video', {
                            path: videoInfo.path,
                            signature,
                            mimeType: videoInfo.mimeType
                        });
                        throw new error_1.AppError('Potentially malicious content detected', 400, 'MALICIOUS_CONTENT');
                    }
                }
            }
            // Validate video file header matches MIME type
            if (opts.validateHeader) {
                const isValidHeader = this.validateVideoFileHeader(buffer, videoInfo.mimeType);
                if (!isValidHeader) {
                    throw new error_1.AppError('Video file header does not match MIME type', 400, 'INVALID_FILE_HEADER');
                }
            }
            // Additional video-specific content validation
            await this.validateVideoContainer(buffer, videoInfo.mimeType);
        }
        catch (error) {
            if (error instanceof error_1.AppError) {
                throw error;
            }
            logger_1.default.error('Video file content validation error', {
                path: videoInfo.path,
                error: error.message
            });
            throw new error_1.AppError('Video content validation failed', 400, 'CONTENT_VALIDATION_ERROR');
        }
    }
    /**
     * Validate video properties (duration, resolution, etc.)
     */
    static async validateVideoProperties(videoInfo, opts) {
        // Duration validation
        if (videoInfo.duration !== undefined) {
            if (videoInfo.duration < opts.minDuration) {
                throw new error_1.AppError(`Video too short (min ${opts.minDuration} seconds)`, 400, 'VIDEO_TOO_SHORT');
            }
            if (videoInfo.duration > opts.maxDuration) {
                throw new error_1.AppError(`Video too long (max ${Math.round(opts.maxDuration / 60)} minutes)`, 400, 'VIDEO_TOO_LONG');
            }
        }
        // Resolution validation
        if (videoInfo.resolution) {
            const { width, height } = videoInfo.resolution;
            if (width < opts.minResolution.width || height < opts.minResolution.height) {
                throw new error_1.AppError(`Video resolution too low (min ${opts.minResolution.width}x${opts.minResolution.height})`, 400, 'RESOLUTION_TOO_LOW');
            }
            if (width > opts.maxResolution.width || height > opts.maxResolution.height) {
                throw new error_1.AppError(`Video resolution too high (max ${opts.maxResolution.width}x${opts.maxResolution.height})`, 400, 'RESOLUTION_TOO_HIGH');
            }
            // Check for valid aspect ratios (basic validation)
            const aspectRatio = width / height;
            if (aspectRatio < 0.1 || aspectRatio > 10) {
                throw new error_1.AppError('Invalid video aspect ratio', 400, 'INVALID_ASPECT_RATIO');
            }
        }
        // Validate processing operations support
        if (!this.isVideoProcessingSupported(videoInfo.mimeType, 'watermark')) {
            throw new error_1.AppError(`Watermarking not supported for ${videoInfo.mimeType}`, 400, 'WATERMARK_NOT_SUPPORTED');
        }
        if (!this.isVideoProcessingSupported(videoInfo.mimeType, 'crop')) {
            throw new error_1.AppError(`Cropping/trimming not supported for ${videoInfo.mimeType}`, 400, 'CROP_NOT_SUPPORTED');
        }
    }
    /**
     * Validate MIME type and extension match
     */
    static validateMimeTypeExtensionMatch(mimeType, extension) {
        const expectedMimeTypes = {
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
            throw new error_1.AppError('Video file extension and MIME type mismatch', 400, 'TYPE_MISMATCH');
        }
    }
    /**
     * Validate video file header matches MIME type
     */
    static validateVideoFileHeader(buffer, mimeType) {
        const normalizedMimeType = mimeType.toLowerCase();
        const signatures = this.VIDEO_SIGNATURES[normalizedMimeType];
        if (!signatures) {
            logger_1.default.debug('Video header validation skipped for MIME type:', mimeType);
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
    static async validateVideoContainer(buffer, mimeType) {
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
                logger_1.default.debug('Container validation skipped for MIME type:', mimeType);
        }
    }
    /**
     * Validate MP4 container structure
     */
    static validateMP4Container(buffer) {
        const header = buffer.slice(0, 100).toString('ascii', 0, 100);
        // Check for required MP4 atoms
        const requiredAtoms = ['ftyp'];
        const foundAtoms = requiredAtoms.filter(atom => header.includes(atom));
        if (foundAtoms.length === 0) {
            throw new error_1.AppError('Invalid MP4 container structure', 400, 'INVALID_MP4_CONTAINER');
        }
    }
    /**
     * Validate AVI container structure
     */
    static validateAVIContainer(buffer) {
        const header = buffer.slice(0, 20).toString('ascii');
        if (!header.includes('RIFF') || !header.includes('AVI ')) {
            throw new error_1.AppError('Invalid AVI container structure', 400, 'INVALID_AVI_CONTAINER');
        }
    }
    /**
     * Validate WebM container structure
     */
    static validateWebMContainer(buffer) {
        // WebM uses EBML (Extensible Binary Meta Language)
        if (buffer.length < 4 || buffer[0] !== 0x1A || buffer[1] !== 0x45 || buffer[2] !== 0xDF || buffer[3] !== 0xA3) {
            throw new error_1.AppError('Invalid WebM container structure', 400, 'INVALID_WEBM_CONTAINER');
        }
    }
    /**
     * Validate crop parameters
     */
    static validateCropParameters(startTime, endTime, videoDuration) {
        if (startTime < 0) {
            throw new error_1.AppError('Start time cannot be negative', 400, 'INVALID_START_TIME');
        }
        if (endTime <= startTime) {
            throw new error_1.AppError('End time must be greater than start time', 400, 'INVALID_END_TIME');
        }
        if (videoDuration && endTime > videoDuration) {
            throw new error_1.AppError('End time exceeds video duration', 400, 'END_TIME_EXCEEDS_DURATION');
        }
        const cropDuration = endTime - startTime;
        if (cropDuration < 1) {
            throw new error_1.AppError('Crop duration must be at least 1 second', 400, 'CROP_DURATION_TOO_SHORT');
        }
        if (cropDuration > 3600) {
            throw new error_1.AppError('Crop duration cannot exceed 1 hour', 400, 'CROP_DURATION_TOO_LONG');
        }
    }
    /**
     * Sanitize video filename
     */
    static sanitizeVideoFilename(filename) {
        let sanitized = filename.replace(/[\/\\:*?"<>|]/g, '');
        // Remove null bytes and control characters
        sanitized = sanitized.replace(/[\x00-\x1F\x7F]/g, '');
        // Normalize Unicode characters
        sanitized = sanitized.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        // Ensure video extension
        const ext = path_1.default.extname(sanitized).toLowerCase();
        if (!this.DEFAULT_OPTIONS.allowedExtensions.includes(ext)) {
            sanitized = path_1.default.basename(sanitized, ext) + '.mp4';
        }
        if (!sanitized || sanitized.trim().length === 0) {
            sanitized = 'video.mp4';
        }
        return sanitized.trim();
    }
    /**
     * Check if video MIME type is supported
     */
    static isSupportedVideoMimeType(mimeType) {
        return this.DEFAULT_OPTIONS.allowedMimeTypes.includes(mimeType.toLowerCase());
    }
    /**
     * Get recommended video settings for processing
     */
    static getRecommendedVideoSettings(mimeType) {
        const settings = {
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
exports.VideoFileValidationService = VideoFileValidationService;
