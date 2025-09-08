export declare const IMAGE_CONFIG: {
    readonly UPLOAD_DIR: string;
    readonly PROCESSED_DIR: string;
    readonly FILE_LIMITS: {
        readonly MAX_SIZE: number;
        readonly MIN_SIZE: 100;
        readonly MAX_FILENAME_LENGTH: 255;
    };
    readonly DIMENSION_LIMITS: {
        readonly MAX_WIDTH: 10000;
        readonly MAX_HEIGHT: 10000;
        readonly MIN_WIDTH: 10;
        readonly MIN_HEIGHT: 10;
    };
    readonly PROCESSING_LIMITS: {
        readonly MAX_QUALITY: 100;
        readonly MIN_QUALITY: 1;
        readonly MAX_BLUR: 1000;
        readonly MIN_BLUR: 0.3;
        readonly MAX_ROTATION: 360;
        readonly MIN_ROTATION: -360;
        readonly MAX_OPERATIONS: 5;
    };
    readonly FORMATS: {
        readonly INPUT_MIME_TYPES: readonly ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/avif", "image/tiff", "image/bmp", "image/gif", "image/heic", "image/heif"];
        readonly INPUT_EXTENSIONS: readonly [".jpg", ".jpeg", ".png", ".webp", ".avif", ".tiff", ".tif", ".bmp", ".gif"];
        readonly OUTPUT_FORMATS: readonly ["jpeg", "png", "webp", "avif"];
        readonly MIME_TO_EXTENSION: {
            readonly 'image/jpeg': readonly [".jpg", ".jpeg"];
            readonly 'image/jpg': readonly [".jpg", ".jpeg"];
            readonly 'image/png': readonly [".png"];
            readonly 'image/webp': readonly [".webp"];
            readonly 'image/avif': readonly [".avif"];
            readonly 'image/tiff': readonly [".tiff", ".tif"];
            readonly 'image/bmp': readonly [".bmp"];
            readonly 'image/gif': readonly [".gif"];
        };
        readonly CONVERSION_MATRIX: {
            readonly 'image/jpeg': readonly ["jpeg", "png", "webp"];
            readonly 'image/jpg': readonly ["jpeg", "png", "webp"];
            readonly 'image/png': readonly ["jpeg", "png", "webp", "avif"];
            readonly 'image/webp': readonly ["jpeg", "png", "webp"];
            readonly 'image/avif': readonly ["jpeg", "png", "webp", "avif"];
            readonly 'image/tiff': readonly ["jpeg", "png"];
            readonly 'image/bmp': readonly ["jpeg", "png"];
            readonly 'image/gif': readonly ["jpeg", "png"];
        };
    };
    readonly SECURITY: {
        readonly DANGEROUS_EXTENSIONS: readonly [".exe", ".bat", ".cmd", ".scr", ".pif", ".com"];
        readonly VIRUS_SIGNATURES: readonly ["PK", "MZ", "<!DOCTYPE", "<html>", "<script>"];
        readonly HEADER_CHECK_SIZE: 1024;
    };
    readonly WORKER: {
        readonly CONCURRENCY: {
            readonly DEVELOPMENT: 1;
            readonly PRODUCTION: 2;
        };
        readonly TIMEOUTS: {
            readonly JOB_TIMEOUT: number;
            readonly STALLED_INTERVAL: number;
            readonly RETRY_DELAY: 5000;
        };
        readonly QUEUE_LIMITS: {
            readonly MAX_WAITING: 1000;
            readonly MAX_COMPLETED_JOBS: 100;
            readonly MAX_FAILED_JOBS: 50;
            readonly COMPLETED_JOB_AGE: number;
            readonly FAILED_JOB_AGE: number;
        };
    };
    readonly DEFAULTS: {
        readonly RESIZE_FIT: "cover";
        readonly RESIZE_POSITION: "center";
        readonly OUTPUT_FORMAT: "jpeg";
        readonly QUALITY: 80;
    };
    readonly CLEANUP: {
        readonly MAX_AGE_HOURS: 24;
        readonly CLEANUP_INTERVAL: number;
    };
    readonly PERFORMANCE: {
        readonly LARGE_FILE_THRESHOLD: number;
        readonly COMPLEX_OPERATIONS_THRESHOLD: 2;
        readonly HIGH_MEMORY_WARNING: 0.7;
        readonly CRITICAL_MEMORY_WARNING: 0.9;
    };
};
export type InputMimeType = typeof IMAGE_CONFIG.FORMATS.INPUT_MIME_TYPES[number];
export type InputExtension = typeof IMAGE_CONFIG.FORMATS.INPUT_EXTENSIONS[number];
export type OutputFormat = typeof IMAGE_CONFIG.FORMATS.OUTPUT_FORMATS[number];
export type ResizeFit = typeof IMAGE_CONFIG.DEFAULTS.RESIZE_FIT;
export type ResizePosition = typeof IMAGE_CONFIG.DEFAULTS.RESIZE_POSITION;
export declare class ImageConfigUtils {
    static isSupportedInputMimeType(mimeType: string): boolean;
    static isSupportedInputExtension(extension: string): boolean;
    static isSupportedOutputFormat(format: string): boolean;
    static determineJobPriority(fileSize: number, operationsCount: number): 'low' | 'normal' | 'high';
    static estimateProcessingTime(fileSize: number, operations?: Record<string, any>): string;
}
