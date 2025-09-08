export interface VideoProcessingResult {
    outputPath: string;
    originalSize: number;
    processedSize: number;
    duration?: number;
    operations: string[];
    processingTime?: number;
    metadata?: {
        width: number;
        height: number;
        codec: string;
        bitrate?: number;
        fps?: number;
    };
}
export interface CropOperation {
    startTime: number;
    endTime: number;
}
export interface WatermarkOperation {
    type: 'text' | 'image';
    text?: string;
    imagePath?: string;
    position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';
    opacity?: number;
    fontSize?: number;
    fontColor?: string;
    margin?: number;
}
export interface VideoOperations {
    crop?: CropOperation;
    watermark?: WatermarkOperation;
    quality?: number;
    format?: string;
}
export interface VideoProcessingOptions {
    inputPath: string;
    outputDir: string;
    filename: string;
    operations?: VideoOperations;
    preserveMetadata?: boolean;
    quality?: number;
}
export declare class VideoProcessor {
    /**
     * Main video processing function
     */
    static processVideo(options: VideoProcessingOptions): Promise<VideoProcessingResult>;
    /**
     * Validate input video file
     */
    private static validateInputFile;
    /**
     * Get video metadata using ffprobe
     */
    private static getVideoMetadata;
    /**
     * Validate operations against video metadata
     */
    private static validateOperations;
    /**
     * Execute video processing with ffmpeg
     */
    private static executeVideoProcessing;
    /**
     * Apply watermark to ffmpeg command
     */
    private static applyWatermark;
    /**
     * Get supported formats
     */
    static getSupportedFormats(): {
        input: readonly ["video/mp4", "video/avi", "video/mov", "video/mkv", "video/webm", "video/quicktime"];
        output: readonly ["mp4", "avi", "mov", "mkv", "webm"];
    };
    /**
     * Validate if format is supported
     */
    static isFormatSupported(mimeType: string, type?: 'input' | 'output'): boolean;
}
