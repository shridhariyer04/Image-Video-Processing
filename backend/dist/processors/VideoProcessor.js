"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.VideoProcessor = void 0;
const fluent_ffmpeg_1 = __importDefault(require("fluent-ffmpeg"));
const path_1 = __importDefault(require("path"));
const promises_1 = __importDefault(require("fs/promises"));
const video_image_config_1 = require("../config/video.image.config");
const error_1 = require("../utils/error");
const logger_1 = __importDefault(require("../utils/logger"));
const perf_hooks_1 = require("perf_hooks");
class VideoProcessor {
    /**
     * Main video processing function
     */
    static async processVideo(options) {
        const startTime = perf_hooks_1.performance.now();
        console.log('🎬 VideoProcessor.processVideo called');
        console.log('📁 Input:', options.inputPath);
        console.log('📁 Output Dir:', options.outputDir);
        console.log('📝 Operations:', JSON.stringify(options.operations, null, 2));
        try {
            // Validate input file
            await this.validateInputFile(options.inputPath);
            // Get video metadata
            const metadata = await this.getVideoMetadata(options.inputPath);
            console.log('📊 Video metadata:', metadata);
            // Validate operations against metadata
            if (options.operations) {
                await this.validateOperations(options.operations, metadata);
            }
            // Generate output path
            const outputPath = path_1.default.join(options.outputDir, options.filename);
            console.log('📤 Output path:', outputPath);
            // Get original file size
            const originalStats = await promises_1.default.stat(options.inputPath);
            const originalSize = originalStats.size;
            // Process video based on operations
            const processedPath = await this.executeVideoProcessing(options.inputPath, outputPath, options.operations || {}, metadata, options.quality);
            // Get processed file size
            const processedStats = await promises_1.default.stat(processedPath);
            const processedSize = processedStats.size;
            // Calculate processing time
            const processingTime = perf_hooks_1.performance.now() - startTime;
            // Build operations list
            const operations = [];
            if (options.operations?.crop)
                operations.push('crop');
            if (options.operations?.watermark)
                operations.push('watermark');
            const result = {
                outputPath: processedPath,
                originalSize,
                processedSize,
                duration: metadata.format?.duration
                    ? parseFloat(metadata.format.duration)
                    : 0,
                operations,
                processingTime,
                metadata: {
                    width: metadata.width,
                    height: metadata.height,
                    codec: metadata.codec || 'unknown',
                    bitrate: metadata.format?.duration
                        ? parseFloat(metadata.format.duration)
                        : 0,
                    fps: metadata.fps,
                },
            };
            console.log('✅ Video processing completed successfully');
            console.log('📊 Result summary:', {
                outputPath: result.outputPath,
                originalSize: `${Math.round(originalSize / 1024 / 1024)}MB`,
                processedSize: `${Math.round(processedSize / 1024 / 1024)}MB`,
                duration: metadata.duration ? `${metadata.duration}s` : 'unknown',
                operations: result.operations,
                processingTime: `${(processingTime / 1000).toFixed(2)}s`
            });
            return result;
        }
        catch (error) {
            console.error('❌ Video processing failed:', error);
            const processingTime = perf_hooks_1.performance.now() - startTime;
            logger_1.default.error('Video processing failed:', {
                inputPath: options.inputPath,
                error: error instanceof Error ? error.message : error,
                processingTime: `${(processingTime / 1000).toFixed(2)}s`
            });
            throw error;
        }
    }
    /**
     * Validate input video file
     */
    static async validateInputFile(inputPath) {
        try {
            await promises_1.default.access(inputPath);
            const stats = await promises_1.default.stat(inputPath);
            if (stats.size === 0) {
                throw new error_1.AppError('Input video file is empty', 400, 'EMPTY_FILE');
            }
            if (stats.size > video_image_config_1.VIDEO_CONFIG.FILE_LIMITS.MAX_SIZE) {
                throw new error_1.AppError('Input video file is too large', 400, 'FILE_TOO_LARGE');
            }
            console.log(`✅ Input file validated: ${Math.round(stats.size / 1024 / 1024)}MB`);
        }
        catch (error) {
            if (error.code === 'ENOENT') {
                throw new error_1.AppError('Input video file not found', 404, 'FILE_NOT_FOUND');
            }
            throw error;
        }
    }
    /**
     * Get video metadata using ffprobe
     */
    static async getVideoMetadata(inputPath) {
        return new Promise((resolve, reject) => {
            fluent_ffmpeg_1.default.ffprobe(inputPath, (error, metadata) => {
                if (error) {
                    console.error('❌ FFprobe error:', error);
                    reject(new error_1.AppError('Failed to read video metadata', 400, 'METADATA_ERROR'));
                    return;
                }
                if (!metadata.streams || metadata.streams.length === 0) {
                    reject(new error_1.AppError('No video streams found', 400, 'NO_VIDEO_STREAMS'));
                    return;
                }
                // Find the first video stream
                const videoStream = metadata.streams.find(stream => stream.codec_type === 'video');
                if (!videoStream) {
                    reject(new error_1.AppError('No video stream found', 400, 'NO_VIDEO_STREAM'));
                    return;
                }
                const result = {
                    duration: metadata.format.duration,
                    width: videoStream.width || 0,
                    height: videoStream.height || 0,
                    codec: videoStream.codec_name || 'unknown',
                    bitrate: metadata.format.bit_rate,
                    fps: videoStream.r_frame_rate ? eval(videoStream.r_frame_rate) : undefined,
                    format: metadata.format.format_name || 'unknown',
                };
                console.log('✅ Metadata extracted:', result);
                resolve(result);
            });
        });
    }
    /**
     * Validate operations against video metadata
     */
    static async validateOperations(operations, metadata) {
        // Validate crop operation
        if (operations.crop) {
            const { startTime, endTime } = operations.crop;
            if (startTime < 0) {
                throw new error_1.AppError('Start time cannot be negative', 400, 'INVALID_START_TIME');
            }
            if (endTime <= startTime) {
                throw new error_1.AppError('End time must be greater than start time', 400, 'INVALID_TIME_RANGE');
            }
            if (metadata.duration && endTime > metadata.duration) {
                throw new error_1.AppError('End time exceeds video duration', 400, 'TIME_EXCEEDS_DURATION');
            }
            const cropDuration = endTime - startTime;
            if (cropDuration > video_image_config_1.VIDEO_CONFIG.DURATION_LIMITS.MAX_DURATION) {
                throw new error_1.AppError('Crop duration exceeds maximum allowed', 400, 'DURATION_TOO_LONG');
            }
            console.log(`✅ Crop validation passed: ${startTime}s to ${endTime}s (${cropDuration}s duration)`);
        }
        // Validate watermark operation
        if (operations.watermark) {
            const watermark = operations.watermark;
            if (watermark.type === 'text') {
                if (!watermark.text || watermark.text.trim().length === 0) {
                    throw new error_1.AppError('Watermark text cannot be empty', 400, 'EMPTY_WATERMARK_TEXT');
                }
                if (watermark.fontSize && (watermark.fontSize < 8 || watermark.fontSize > 200)) {
                    throw new error_1.AppError('Font size must be between 8 and 200', 400, 'INVALID_FONT_SIZE');
                }
            }
            else if (watermark.type === 'image') {
                if (!watermark.imagePath) {
                    throw new error_1.AppError('Watermark image path is required', 400, 'MISSING_IMAGE_PATH');
                }
                try {
                    await promises_1.default.access(watermark.imagePath);
                    console.log('✅ Watermark image found:', watermark.imagePath);
                }
                catch (error) {
                    throw new error_1.AppError('Watermark image not found', 404, 'WATERMARK_IMAGE_NOT_FOUND');
                }
            }
            if (watermark.opacity !== undefined && (watermark.opacity < 0.1 || watermark.opacity > 1.0)) {
                throw new error_1.AppError('Watermark opacity must be between 0.1 and 1.0', 400, 'INVALID_OPACITY');
            }
            console.log('✅ Watermark validation passed');
        }
        // Validate quality
        if (operations.quality && (operations.quality < 1 || operations.quality > 100)) {
            throw new error_1.AppError('Quality must be between 1 and 100', 400, 'INVALID_QUALITY');
        }
    }
    /**
     * Execute video processing with ffmpeg
     */
    static async executeVideoProcessing(inputPath, outputPath, operations, metadata, quality) {
        return new Promise((resolve, reject) => {
            console.log('🔄 Starting FFmpeg processing...');
            let command = (0, fluent_ffmpeg_1.default)(inputPath);
            // Set output format
            const outputFormat = operations.format || 'mp4';
            command = command.format(outputFormat);
            // Apply crop operation (video trimming)
            if (operations.crop) {
                const { startTime, endTime } = operations.crop;
                const duration = endTime - startTime;
                console.log(`🔄 Applying crop: ${startTime}s to ${endTime}s (${duration}s duration)`);
                command = command.seekInput(startTime).duration(duration);
            }
            // Apply watermark operation
            if (operations.watermark) {
                command = this.applyWatermark(command, operations.watermark, metadata);
            }
            // Set quality/bitrate
            if (quality || operations.quality) {
                const targetQuality = quality || operations.quality || 75;
                const crf = Math.round(51 - (targetQuality * 0.51)); // Convert 1-100 to CRF 51-0
                console.log(`🔄 Setting quality: ${targetQuality}% (CRF: ${crf})`);
                command = command.videoCodec('libx264').addOption('-crf', crf.toString());
            }
            else {
                // Default encoding settings
                command = command.videoCodec('libx264').addOption('-crf', '23');
            }
            // Audio codec
            command = command.audioCodec('aac');
            // Additional options for better compatibility
            command = command
                .addOption('-movflags', '+faststart') // Enable fast start for mp4
                .addOption('-pix_fmt', 'yuv420p'); // Ensure wide compatibility
            // Set output path
            command = command.output(outputPath);
            // Handle progress
            command.on('progress', (progress) => {
                if (progress.percent) {
                    console.log(`🔄 FFmpeg progress: ${Math.round(progress.percent)}%`);
                }
            });
            // Handle completion
            command.on('end', () => {
                console.log('✅ FFmpeg processing completed');
                resolve(outputPath);
            });
            // Handle errors
            command.on('error', (error) => {
                console.error('❌ FFmpeg error:', error);
                // Clean up partial output file
                promises_1.default.unlink(outputPath).catch(() => { });
                // Provide more specific error messages
                const errorMessage = error.message.toLowerCase();
                if (errorMessage.includes('no such file')) {
                    reject(new error_1.AppError('Input file not found during processing', 404, 'INPUT_NOT_FOUND'));
                }
                else if (errorMessage.includes('invalid data')) {
                    reject(new error_1.AppError('Invalid video data or corrupted file', 400, 'CORRUPTED_VIDEO'));
                }
                else if (errorMessage.includes('codec')) {
                    reject(new error_1.AppError('Unsupported video codec', 400, 'UNSUPPORTED_CODEC'));
                }
                else if (errorMessage.includes('permission denied')) {
                    reject(new error_1.AppError('Permission denied accessing files', 500, 'PERMISSION_DENIED'));
                }
                else {
                    reject(new error_1.AppError(`Video processing failed: ${error.message}`, 500, 'PROCESSING_FAILED'));
                }
            });
            // Start processing
            console.log('🚀 Starting FFmpeg command execution...');
            command.run();
        });
    }
    /**
     * Apply watermark to ffmpeg command
     */
    static applyWatermark(command, watermark, metadata) {
        console.log('🔄 Applying watermark:', watermark.type);
        if (watermark.type === 'text') {
            // Text watermark
            const text = watermark.text || 'Watermark';
            const fontSize = watermark.fontSize || 24;
            const fontColor = watermark.fontColor || 'white';
            const opacity = watermark.opacity || 0.7;
            const margin = watermark.margin || 20;
            // Calculate position
            let x = `${margin}`;
            let y = `${margin}`;
            switch (watermark.position) {
                case 'top-right':
                    x = `w-tw-${margin}`;
                    y = `${margin}`;
                    break;
                case 'bottom-left':
                    x = `${margin}`;
                    y = `h-th-${margin}`;
                    break;
                case 'bottom-right':
                    x = `w-tw-${margin}`;
                    y = `h-th-${margin}`;
                    break;
                case 'center':
                    x = '(w-tw)/2';
                    y = '(h-th)/2';
                    break;
                default: // top-left
                    x = `${margin}`;
                    y = `${margin}`;
            }
            const drawTextFilter = `drawtext=text='${text}':fontsize=${fontSize}:fontcolor=${fontColor}@${opacity}:x=${x}:y=${y}:shadowcolor=black@0.5:shadowx=2:shadowy=2`;
            console.log('✅ Text watermark filter:', drawTextFilter);
            return command.videoFilters(drawTextFilter);
        }
        else if (watermark.type === 'image') {
            // Image watermark
            const opacity = watermark.opacity || 0.7;
            const margin = watermark.margin || 20;
            // Calculate position for image overlay
            let overlayX;
            let overlayY;
            switch (watermark.position) {
                case 'top-right':
                    overlayX = `main_w-overlay_w-${margin}`;
                    overlayY = `${margin}`;
                    break;
                case 'bottom-left':
                    overlayX = `${margin}`;
                    overlayY = `main_h-overlay_h-${margin}`;
                    break;
                case 'bottom-right':
                    overlayX = `main_w-overlay_w-${margin}`;
                    overlayY = `main_h-overlay_h-${margin}`;
                    break;
                case 'center':
                    overlayX = '(main_w-overlay_w)/2';
                    overlayY = '(main_h-overlay_h)/2';
                    break;
                default: // top-left
                    overlayX = `${margin}`;
                    overlayY = `${margin}`;
            }
            // Add watermark image as input and apply overlay
            command = command.input(watermark.imagePath);
            const overlayFilter = `[1:v]format=rgba,colorchannelmixer=aa=${opacity}[watermark];[0:v][watermark]overlay=${overlayX}:${overlayY}`;
            console.log('✅ Image watermark filter:', overlayFilter);
            return command.complexFilter(overlayFilter);
        }
        return command;
    }
    /**
     * Get supported formats
     */
    static getSupportedFormats() {
        return {
            input: video_image_config_1.VIDEO_CONFIG.FORMATS.INPUT_FORMATS,
            output: video_image_config_1.VIDEO_CONFIG.FORMATS.OUTPUT_FORMATS,
        };
    }
    /**
     * Validate if format is supported
     */
    static isFormatSupported(mimeType, type = 'input') {
        if (type === 'input') {
            return video_image_config_1.VIDEO_CONFIG.FORMATS.INPUT_FORMATS.includes(mimeType);
        }
        else {
            return video_image_config_1.VIDEO_CONFIG.FORMATS.OUTPUT_FORMATS.includes(mimeType);
        }
    }
}
exports.VideoProcessor = VideoProcessor;
