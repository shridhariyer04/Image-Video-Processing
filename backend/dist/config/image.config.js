"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ImageConfigUtils = exports.IMAGE_CONFIG = void 0;
// src/config/image.config.ts
const env_1 = require("./env");
// Validate PROCESSED_DIR to ensure it's a string
const PROCESSED_DIR = process.env.PROCESSED_DIR || './processed_images';
if (!PROCESSED_DIR) {
    throw new Error('PROCESSED_DIR environment variable is not defined');
}
exports.IMAGE_CONFIG = {
    UPLOAD_DIR: env_1.UPLOAD_DIR,
    PROCESSED_DIR, // Guaranteed string
    FILE_LIMITS: {
        MAX_SIZE: 100 * 1024 * 1024, // 100MB
        MIN_SIZE: 100, // 100 bytes
        MAX_FILENAME_LENGTH: 255,
    },
    DIMENSION_LIMITS: {
        MAX_WIDTH: 10000,
        MAX_HEIGHT: 10000,
        MIN_WIDTH: 10,
        MIN_HEIGHT: 10,
    },
    PROCESSING_LIMITS: {
        MAX_QUALITY: 100,
        MIN_QUALITY: 1,
        MAX_BLUR: 1000,
        MIN_BLUR: 0.3,
        MAX_ROTATION: 360,
        MIN_ROTATION: -360,
        MAX_OPERATIONS: 5,
    },
    FORMATS: {
        INPUT_MIME_TYPES: [
            'image/jpeg',
            'image/jpg',
            'image/png',
            'image/webp',
            'image/avif',
            'image/tiff',
            'image/bmp',
            'image/gif',
            'image/heic',
            'image/heif',
        ],
        INPUT_EXTENSIONS: [
            '.jpg',
            '.jpeg',
            '.png',
            '.webp',
            '.avif',
            '.tiff',
            '.tif',
            '.bmp',
            '.gif',
        ],
        OUTPUT_FORMATS: ['jpeg', 'png', 'webp', 'avif'],
        MIME_TO_EXTENSION: {
            'image/jpeg': ['.jpg', '.jpeg'],
            'image/jpg': ['.jpg', '.jpeg'],
            'image/png': ['.png'],
            'image/webp': ['.webp'],
            'image/avif': ['.avif'],
            'image/tiff': ['.tiff', '.tif'],
            'image/bmp': ['.bmp'],
            'image/gif': ['.gif'],
        },
        CONVERSION_MATRIX: {
            'image/jpeg': ['jpeg', 'png', 'webp'],
            'image/jpg': ['jpeg', 'png', 'webp'],
            'image/png': ['jpeg', 'png', 'webp', 'avif'],
            'image/webp': ['jpeg', 'png', 'webp'],
            'image/avif': ['jpeg', 'png', 'webp', 'avif'],
            'image/tiff': ['jpeg', 'png'],
            'image/bmp': ['jpeg', 'png'],
            'image/gif': ['jpeg', 'png'],
        },
    },
    SECURITY: {
        DANGEROUS_EXTENSIONS: ['.exe', '.bat', '.cmd', '.scr', '.pif', '.com'],
        VIRUS_SIGNATURES: ['PK', 'MZ', '<!DOCTYPE', '<html>', '<script>'],
        HEADER_CHECK_SIZE: 1024,
    },
    WORKER: {
        CONCURRENCY: {
            DEVELOPMENT: 1,
            PRODUCTION: 2,
        },
        TIMEOUTS: {
            JOB_TIMEOUT: 5 * 60 * 1000,
            STALLED_INTERVAL: 30 * 1000,
            RETRY_DELAY: 5000,
        },
        QUEUE_LIMITS: {
            MAX_WAITING: 1000,
            MAX_COMPLETED_JOBS: 100,
            MAX_FAILED_JOBS: 50,
            COMPLETED_JOB_AGE: 60 * 60,
            FAILED_JOB_AGE: 24 * 60 * 60,
        },
    },
    DEFAULTS: {
        RESIZE_FIT: 'cover',
        RESIZE_POSITION: 'center',
        OUTPUT_FORMAT: 'jpeg',
        QUALITY: 80,
    },
    CLEANUP: {
        MAX_AGE_HOURS: 24,
        CLEANUP_INTERVAL: 60 * 60 * 1000,
    },
    PERFORMANCE: {
        LARGE_FILE_THRESHOLD: 10 * 1024 * 1024,
        COMPLEX_OPERATIONS_THRESHOLD: 2,
        HIGH_MEMORY_WARNING: 0.7,
        CRITICAL_MEMORY_WARNING: 0.9,
    },
};
class ImageConfigUtils {
    static isSupportedInputMimeType(mimeType) {
        return exports.IMAGE_CONFIG.FORMATS.INPUT_MIME_TYPES.includes(mimeType);
    }
    static isSupportedInputExtension(extension) {
        return exports.IMAGE_CONFIG.FORMATS.INPUT_EXTENSIONS.includes(extension);
    }
    static isSupportedOutputFormat(format) {
        return exports.IMAGE_CONFIG.FORMATS.OUTPUT_FORMATS.includes(format);
    }
    static determineJobPriority(fileSize, operationsCount) {
        if (fileSize > exports.IMAGE_CONFIG.PERFORMANCE.LARGE_FILE_THRESHOLD) {
            return 'low';
        }
        if (operationsCount > exports.IMAGE_CONFIG.PERFORMANCE.COMPLEX_OPERATIONS_THRESHOLD) {
            return 'high';
        }
        return 'normal';
    }
    static estimateProcessingTime(fileSize, operations) {
        let baseTime = Math.max(2, Math.ceil(fileSize / (1024 * 1024)));
        if (operations) {
            if (operations.resize)
                baseTime += 2;
            if (operations.crop)
                baseTime += 1;
            if (operations.rotate)
                baseTime += 1;
            if (operations.format === 'avif')
                baseTime += 3;
            if (operations.blur)
                baseTime += 2;
        }
        return `${baseTime}-${baseTime + 5} seconds`;
    }
}
exports.ImageConfigUtils = ImageConfigUtils;
