export interface VideoValidationOptions {
    maxSize?: number;
    minSize?: number;
    allowedMimeTypes?: string[];
    allowedExtensions?: string[];
    validateHeader?: boolean;
    validateContent?: boolean;
    maxDuration?: number;
    minDuration?: number;
    maxResolution?: {
        width: number;
        height: number;
    };
    minResolution?: {
        width: number;
        height: number;
    };
}
export interface VideoFileInfo {
    path: string;
    originalName: string;
    size: number;
    mimeType: string;
    duration?: number;
    resolution?: {
        width: number;
        height: number;
    };
    bitrate?: number;
    fps?: number;
}
export declare class VideoFileValidationService {
    private static readonly DEFAULT_OPTIONS;
    private static readonly DANGEROUS_EXTENSIONS;
    private static readonly VIRUS_SIGNATURES;
    private static readonly MAX_FILENAME_LENGTH;
    private static readonly VIDEO_SIGNATURES;
    /**
     * Comprehensive video file validation
     */
    static validateVideoFile(videoInfo: VideoFileInfo, options?: VideoValidationOptions): Promise<void>;
    /**
     * Validate basic video file information
     */
    private static validateBasicVideoFileInfo;
    /**
     * Validate file system properties
     */
    private static validateFileSystem;
    /**
     * Check if video processing operation is supported
     */
    private static isVideoProcessingSupported;
    /**
     * Validate video file content and headers
     */
    private static validateVideoFileContent;
    /**
     * Validate video properties (duration, resolution, etc.)
     */
    private static validateVideoProperties;
    /**
     * Validate MIME type and extension match
     */
    private static validateMimeTypeExtensionMatch;
    /**
     * Validate video file header matches MIME type
     */
    private static validateVideoFileHeader;
    /**
     * Validate video container format
     */
    private static validateVideoContainer;
    /**
     * Validate MP4 container structure
     */
    private static validateMP4Container;
    /**
     * Validate AVI container structure
     */
    private static validateAVIContainer;
    /**
     * Validate WebM container structure
     */
    private static validateWebMContainer;
    /**
     * Validate crop parameters
     */
    static validateCropParameters(startTime: number, endTime: number, videoDuration?: number): void;
    /**
     * Sanitize video filename
     */
    static sanitizeVideoFilename(filename: string): string;
    /**
     * Check if video MIME type is supported
     */
    static isSupportedVideoMimeType(mimeType: string): boolean;
    /**
     * Get recommended video settings for processing
     */
    static getRecommendedVideoSettings(mimeType: string): {
        maxBitrate: number;
        recommendedCodec: string;
        recommendedFormat: string;
    };
}
