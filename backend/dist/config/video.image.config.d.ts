export declare const VIDEO_CONFIG: {
    readonly VIDEO_UPLOAD_DIR: string;
    readonly PROCESSED_VIDEO_DIR: string;
    readonly FILE_LIMITS: {
        readonly MAX_SIZE: number;
        readonly MIN_SIZE: 1024;
        readonly MAX_FILES: 10;
    };
    readonly DURATION_LIMITS: {
        readonly MIN_DURATION: 1;
        readonly MAX_DURATION: 7200;
    };
    readonly PROCESSING_LIMITS: {
        readonly MAX_OPERATIONS: 2;
        readonly MAX_CONCURRENT_JOBS: 5;
    };
    readonly FORMATS: {
        readonly INPUT_FORMATS: readonly ["video/mp4", "video/avi", "video/mov", "video/mkv", "video/webm", "video/quicktime"];
        readonly OUTPUT_FORMATS: readonly ["mp4", "avi", "mov", "mkv", "webm"];
    };
    readonly AUDIO: {
        readonly OUTPUT_FORMATS: readonly ["mp3", "aac", "wav"];
    };
    readonly DIMENSION_LIMITS: {
        readonly MAX_WIDTH: 3840;
        readonly MAX_HEIGHT: 2160;
        readonly MIN_WIDTH: 128;
        readonly MIN_HEIGHT: 128;
    };
    readonly PERFORMANCE: {
        readonly LARGE_FILE_THRESHOLD: number;
        readonly MEMORY_LIMIT: "2gb";
        readonly CPU_CORES: 2;
    };
    readonly WORKER: {
        readonly TIMEOUTS: {
            readonly JOB_TIMEOUT: number;
            readonly RETRY_DELAY: 5000;
        };
        readonly QUEUE_LIMITS: {
            readonly MAX_COMPLETED_JOBS: 100;
            readonly MAX_FAILED_JOBS: 50;
            readonly COMPLETED_JOB_AGE: number;
            readonly FAILED_JOB_AGE: number;
        };
    };
};
export declare class VideoConfigUtils {
    /**
     * Determine job priority based on file size and duration
     */
    static determineJobPriority(fileSize: number, estimatedDuration: number): 'low' | 'normal' | 'high';
    /**
     * Estimate processing time based on file size and operations
     */
    static estimateProcessingTime(fileSize: number, duration: number, operations?: any): string;
    /**
     * Check if output format is supported
     */
    static isSupportedOutputFormat(format: string): boolean;
    /**
     * Check if input format is supported
     */
    static isSupportedInputFormat(mimeType: string): boolean;
    /**
     * Check if audio format is supported
     */
    static isSupportedAudioFormat(format: string): boolean;
    /**
     * Get safe filename
     */
    static getSafeFilename(originalName: string): string;
    /**
     * Validate video dimensions
     */
    static validateDimensions(width: number, height: number): boolean;
}
export default VIDEO_CONFIG;
