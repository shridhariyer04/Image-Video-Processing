import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import fs from 'fs/promises';
import { VIDEO_CONFIG } from '../config/video.image.config';
import { AppError } from '../utils/error';
import logger from '../utils/logger';
import { performance } from 'perf_hooks';

// Video processing result interface
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

// Video operations interfaces
export interface CropOperation {
  startTime: number;  // Start time in seconds
  endTime: number;    // End time in seconds
}

export interface WatermarkOperation {
  type: 'text' | 'image';
  text?: string;
  imagePath?: string;
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';
  opacity?: number;    // 0.1 to 1.0
  fontSize?: number;   // For text watermarks
  fontColor?: string;  // For text watermarks
  margin?: number;     // Margin from edges in pixels
}

export interface VideoOperations {
  crop?: CropOperation;
  watermark?: WatermarkOperation;
  quality?: number;    // 1-100
  format?: string;     // Output format
}

// Processing options
export interface VideoProcessingOptions {
  inputPath: string;
  outputDir: string;
  filename: string;
  operations?: VideoOperations;
  preserveMetadata?: boolean;
  quality?: number;
}

export class VideoProcessor {
  /**
   * Main video processing function
   */
  static async processVideo(options: VideoProcessingOptions): Promise<VideoProcessingResult> {
    const startTime = performance.now();
    
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
      const outputPath = path.join(options.outputDir, options.filename);
      console.log('📤 Output path:', outputPath);

      // Get original file size
      const originalStats = await fs.stat(options.inputPath);
      const originalSize = originalStats.size;

      // Process video based on operations
      const processedPath = await this.executeVideoProcessing(
        options.inputPath,
        outputPath,
        options.operations || {},
        metadata,
        options.quality
      );

      // Get processed file size
      const processedStats = await fs.stat(processedPath);
      const processedSize = processedStats.size;

      // Calculate processing time
      const processingTime = performance.now() - startTime;

      // Build operations list
      const operations: string[] = [];
      if (options.operations?.crop) operations.push('crop');
      if (options.operations?.watermark) operations.push('watermark');

      const result: VideoProcessingResult = {
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

    } catch (error) {
      console.error('❌ Video processing failed:', error);
      const processingTime = performance.now() - startTime;
      
      logger.error('Video processing failed:', {
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
  private static async validateInputFile(inputPath: string): Promise<void> {
    try {
      await fs.access(inputPath);
      const stats = await fs.stat(inputPath);
      
      if (stats.size === 0) {
        throw new AppError('Input video file is empty', 400, 'EMPTY_FILE');
      }
      
      if (stats.size > VIDEO_CONFIG.FILE_LIMITS.MAX_SIZE) {
        throw new AppError('Input video file is too large', 400, 'FILE_TOO_LARGE');
      }
      
      console.log(`✅ Input file validated: ${Math.round(stats.size / 1024 / 1024)}MB`);
      
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        throw new AppError('Input video file not found', 404, 'FILE_NOT_FOUND');
      }
      throw error;
    }
  }

  /**
   * Get video metadata using ffprobe
   */
  private static async getVideoMetadata(inputPath: string): Promise<any> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(inputPath, (error, metadata) => {
        if (error) {
          console.error('❌ FFprobe error:', error);
          reject(new AppError('Failed to read video metadata', 400, 'METADATA_ERROR'));
          return;
        }

        if (!metadata.streams || metadata.streams.length === 0) {
          reject(new AppError('No video streams found', 400, 'NO_VIDEO_STREAMS'));
          return;
        }

        // Find the first video stream
        const videoStream = metadata.streams.find(stream => stream.codec_type === 'video');
        if (!videoStream) {
          reject(new AppError('No video stream found', 400, 'NO_VIDEO_STREAM'));
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
  private static async validateOperations(operations: VideoOperations, metadata: any): Promise<void> {
    // Validate crop operation
    if (operations.crop) {
      const { startTime, endTime } = operations.crop;
      
      if (startTime < 0) {
        throw new AppError('Start time cannot be negative', 400, 'INVALID_START_TIME');
      }
      
      if (endTime <= startTime) {
        throw new AppError('End time must be greater than start time', 400, 'INVALID_TIME_RANGE');
      }
      
      if (metadata.duration && endTime > metadata.duration) {
        throw new AppError('End time exceeds video duration', 400, 'TIME_EXCEEDS_DURATION');
      }
      
      const cropDuration = endTime - startTime;
      if (cropDuration > VIDEO_CONFIG.DURATION_LIMITS.MAX_DURATION) {
        throw new AppError('Crop duration exceeds maximum allowed', 400, 'DURATION_TOO_LONG');
      }
      
      console.log(`✅ Crop validation passed: ${startTime}s to ${endTime}s (${cropDuration}s duration)`);
    }

    // Validate watermark operation
    if (operations.watermark) {
      const watermark = operations.watermark;
      
      if (watermark.type === 'text') {
        if (!watermark.text || watermark.text.trim().length === 0) {
          throw new AppError('Watermark text cannot be empty', 400, 'EMPTY_WATERMARK_TEXT');
        }
        
        if (watermark.fontSize && (watermark.fontSize < 8 || watermark.fontSize > 200)) {
          throw new AppError('Font size must be between 8 and 200', 400, 'INVALID_FONT_SIZE');
        }
      } else if (watermark.type === 'image') {
        if (!watermark.imagePath) {
          throw new AppError('Watermark image path is required', 400, 'MISSING_IMAGE_PATH');
        }
        
        try {
          await fs.access(watermark.imagePath);
          console.log('✅ Watermark image found:', watermark.imagePath);
        } catch (error) {
          throw new AppError('Watermark image not found', 404, 'WATERMARK_IMAGE_NOT_FOUND');
        }
      }
      
      if (watermark.opacity !== undefined && (watermark.opacity < 0.1 || watermark.opacity > 1.0)) {
        throw new AppError('Watermark opacity must be between 0.1 and 1.0', 400, 'INVALID_OPACITY');
      }
      
      console.log('✅ Watermark validation passed');
    }

    // Validate quality
    if (operations.quality && (operations.quality < 1 || operations.quality > 100)) {
      throw new AppError('Quality must be between 1 and 100', 400, 'INVALID_QUALITY');
    }
  }

  /**
   * Execute video processing with ffmpeg
   */
  private static async executeVideoProcessing(
    inputPath: string,
    outputPath: string,
    operations: VideoOperations,
    metadata: any,
    quality?: number
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      console.log('🔄 Starting FFmpeg processing...');
      
      let command = ffmpeg(inputPath);
      
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
      } else {
        // Default encoding settings
        command = command.videoCodec('libx264').addOption('-crf', '23');
      }

      // Audio codec
      command = command.audioCodec('aac');

      // Additional options for better compatibility
      command = command
        .addOption('-movflags', '+faststart') // Enable fast start for mp4
        .addOption('-pix_fmt', 'yuv420p');    // Ensure wide compatibility

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
        fs.unlink(outputPath).catch(() => {});
        
        // Provide more specific error messages
        const errorMessage = error.message.toLowerCase();
        
        if (errorMessage.includes('no such file')) {
          reject(new AppError('Input file not found during processing', 404, 'INPUT_NOT_FOUND'));
        } else if (errorMessage.includes('invalid data')) {
          reject(new AppError('Invalid video data or corrupted file', 400, 'CORRUPTED_VIDEO'));
        } else if (errorMessage.includes('codec')) {
          reject(new AppError('Unsupported video codec', 400, 'UNSUPPORTED_CODEC'));
        } else if (errorMessage.includes('permission denied')) {
          reject(new AppError('Permission denied accessing files', 500, 'PERMISSION_DENIED'));
        } else {
          reject(new AppError(`Video processing failed: ${error.message}`, 500, 'PROCESSING_FAILED'));
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
  private static applyWatermark(command: ffmpeg.FfmpegCommand, watermark: WatermarkOperation, metadata: any): ffmpeg.FfmpegCommand {
    console.log('🔄 Applying watermark:', watermark.type);
    
    if (watermark.type === 'text') {
      // Text watermark
      const text = watermark.text || 'Watermark';
      const fontSize = watermark.fontSize || 24;
      const fontColor = watermark.fontColor || 'white';
      const opacity = watermark.opacity || 0.7;
      const margin = watermark.margin || 20;
      
      // Calculate position
      let x: string = `${margin}`;
let y: string = `${margin}`;

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
      
    } else if (watermark.type === 'image') {
      // Image watermark
      const opacity = watermark.opacity || 0.7;
      const margin = watermark.margin || 20;
      
      // Calculate position for image overlay
let overlayX: string;
let overlayY: string;

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
      command = command.input(watermark.imagePath!);
      
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
      input: VIDEO_CONFIG.FORMATS.INPUT_FORMATS,
      output: VIDEO_CONFIG.FORMATS.OUTPUT_FORMATS,
    };
  }

  /**
   * Validate if format is supported
   */
  static isFormatSupported(mimeType: string, type: 'input' | 'output' = 'input'): boolean {
    if (type === 'input') {
      return VIDEO_CONFIG.FORMATS.INPUT_FORMATS.includes(mimeType as any);
    } else {
      return VIDEO_CONFIG.FORMATS.OUTPUT_FORMATS.includes(mimeType as any);
    }
  }
}