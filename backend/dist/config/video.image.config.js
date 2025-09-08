"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.VideoConfigUtils = exports.VIDEO_CONFIG = void 0;
const path_1 = __importDefault(require("path"));
// Video configuration constants
exports.VIDEO_CONFIG = {
    // Upload directories
    VIDEO_UPLOAD_DIR: process.env.VIDEO_UPLOAD_DIR || path_1.default.join(process.cwd(), 'uploads', 'videos'),
    PROCESSED_VIDEO_DIR: process.env.PROCESSED_VIDEO_DIR || path_1.default.join(process.cwd(), 'processed', 'videos'),
    // File size limits
    FILE_LIMITS: {
        MAX_SIZE: 500 * 1024 * 1024, // 500MB
        MIN_SIZE: 1024, // 1KB
        MAX_FILES: 10, // Maximum number of files per upload
    },
    // Duration limits
    DURATION_LIMITS: {
        MIN_DURATION: 1, // 1 second
        MAX_DURATION: 7200, // 2 hours in seconds
    },
    // Processing limits
    PROCESSING_LIMITS: {
        MAX_OPERATIONS: 2, // Only crop and watermark
        MAX_CONCURRENT_JOBS: 5,
    },
    // Supported formats
    FORMATS: {
        INPUT_FORMATS: [
            'video/mp4',
            'video/avi',
            'video/mov',
            'video/mkv',
            'video/webm',
            'video/quicktime',
        ],
        OUTPUT_FORMATS: [
            'mp4',
            'avi',
            'mov',
            'mkv',
            'webm',
        ],
    },
    // Audio formats (for compatibility)
    AUDIO: {
        OUTPUT_FORMATS: [
            'mp3',
            'aac',
            'wav',
        ],
    },
    // Dimension limits
    DIMENSION_LIMITS: {
        MAX_WIDTH: 3840, // 4K width
        MAX_HEIGHT: 2160, // 4K height
        MIN_WIDTH: 128,
        MIN_HEIGHT: 128,
    },
    // Performance settings
    PERFORMANCE: {
        LARGE_FILE_THRESHOLD: 100 * 1024 * 1024, // 100MB
        MEMORY_LIMIT: '2gb',
        CPU_CORES: 2,
    },
    // Worker settings
    WORKER: {
        TIMEOUTS: {
            JOB_TIMEOUT: 30 * 60 * 1000, // 30 minutes
            RETRY_DELAY: 5000, // 5 seconds
        },
        QUEUE_LIMITS: {
            MAX_COMPLETED_JOBS: 100,
            MAX_FAILED_JOBS: 50,
            COMPLETED_JOB_AGE: 24 * 60 * 60, // 24 hours in seconds
            FAILED_JOB_AGE: 7 * 24 * 60 * 60, // 7 days in seconds
        },
    },
};
// Utility class for video configuration
class VideoConfigUtils {
    /**
     * Determine job priority based on file size and duration
     */
    static determineJobPriority(fileSize, estimatedDuration) {
        // Small files get high priority
        if (fileSize < 50 * 1024 * 1024) { // < 50MB
            return 'high';
        }
        // Very large files get low priority
        if (fileSize > exports.VIDEO_CONFIG.PERFORMANCE.LARGE_FILE_THRESHOLD) {
            return 'low';
        }
        // Long videos get low priority
        if (estimatedDuration > 1800) { // > 30 minutes
            return 'low';
        }
        return 'normal';
    }
    /**
     * Estimate processing time based on file size and operations
     */
    static estimateProcessingTime(fileSize, duration, operations) {
        let baseTime = Math.max(30, duration * 2); // Base: 2 seconds per video second, min 30s
        // Add time for operations
        if (operations?.crop) {
            baseTime += 15; // 15 seconds for cropping
        }
        if (operations?.watermark) {
            baseTime += 20; // 20 seconds for watermarking
        }
        // Adjust for file size
        const sizeFactor = fileSize / (50 * 1024 * 1024); // 50MB baseline
        baseTime *= Math.max(0.5, Math.min(3, sizeFactor));
        // Convert to readable format
        if (baseTime < 60) {
            return `${Math.round(baseTime)}s`;
        }
        else if (baseTime < 3600) {
            return `${Math.round(baseTime / 60)}m`;
        }
        else {
            return `${Math.round(baseTime / 3600)}h`;
        }
    }
    /**
     * Check if output format is supported
     */
    static isSupportedOutputFormat(format) {
        return exports.VIDEO_CONFIG.FORMATS.OUTPUT_FORMATS.includes(format);
    }
    /**
     * Check if input format is supported
     */
    static isSupportedInputFormat(mimeType) {
        return exports.VIDEO_CONFIG.FORMATS.INPUT_FORMATS.includes(mimeType);
    }
    /**
     * Check if audio format is supported
     */
    static isSupportedAudioFormat(format) {
        return exports.VIDEO_CONFIG.AUDIO.OUTPUT_FORMATS.includes(format);
    }
    /**
     * Get safe filename
     */
    static getSafeFilename(originalName) {
        return originalName
            .replace(/[^a-zA-Z0-9.-]/g, '_')
            .replace(/_+/g, '_')
            .toLowerCase();
    }
    /**
     * Validate video dimensions
     */
    static validateDimensions(width, height) {
        return (width >= exports.VIDEO_CONFIG.DIMENSION_LIMITS.MIN_WIDTH &&
            width <= exports.VIDEO_CONFIG.DIMENSION_LIMITS.MAX_WIDTH &&
            height >= exports.VIDEO_CONFIG.DIMENSION_LIMITS.MIN_HEIGHT &&
            height <= exports.VIDEO_CONFIG.DIMENSION_LIMITS.MAX_HEIGHT);
    }
}
exports.VideoConfigUtils = VideoConfigUtils;
exports.default = exports.VIDEO_CONFIG;
