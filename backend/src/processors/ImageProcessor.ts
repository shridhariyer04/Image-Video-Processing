// src/processors/imageProcessor.ts
import sharp, { Sharp, FormatEnum, ResizeOptions } from 'sharp';
import path from 'path';
import { promises as fs } from 'fs';
import { ImageOperations, CropOperation, ResizeOperation } from '../config/bullmq';
import { IMAGE_CONFIG } from '../config/image.config';
import logger from '../utils/logger';
import { AppError } from '../utils/error';
import { performance } from 'perf_hooks';

// Sharp configuration for optimal performance
sharp.cache({ memory: 256 });
sharp.concurrency(1);
sharp.simd(true);

export interface ProcessingResult {
  outputPath: string;
  originalSize: number;
  processedSize: number;
  format: string;
  width: number;
  height: number;
  processingTime: number;
  operations: string[];
  metadata: {
    density?: number;
    hasAlpha: boolean;
    channels: number;
    colorspace: string;
  };
}

export interface ProcessingOptions {
  inputPath: string;
  outputDir?: string;
  filename?: string;
  operations?: ImageOperations;
  quality?: number;
  preserveMetadata?: boolean;
}

export class ImageProcessor {
  private static readonly MAX_DIMENSION = 10000;
  private static readonly MIN_DIMENSION = 1;
  private static readonly DEFAULT_QUALITY = 85;
  private static readonly FORMAT_QUALITIES: Record<string, number> = {
    jpeg: 85,
    webp: 80,
    avif: 60,
    heif: 70,
  };
  private static readonly COMPRESSION_SETTINGS = {
    jpeg: {
      progressive: true,
      mozjpeg: true,
      trellisQuantisation: true,
      optimiseScans: true,
    },
    webp: {
      effort: 4,
      nearLossless: false,
      smartSubsample: true,
    },
    avif: {
      effort: 4,
      chromaSubsampling: '4:2:0' as const,
    },
    png: {
      compressionLevel: 6,
      adaptiveFiltering: true,
      progressive: false,
    },
  };

  static async processImage(options: ProcessingOptions): Promise<ProcessingResult> {
    const startTime = performance.now();
    try {
      const outputDir = options.outputDir || IMAGE_CONFIG.PROCESSED_DIR;
      await fs.mkdir(outputDir, { recursive: true });
      const originalStats = await fs.stat(options.inputPath);
      const originalSize = originalStats.size;
      let pipeline = sharp(options.inputPath);
      const metadata = await pipeline.metadata();
      logger.debug('Image metadata:', {
        filename: path.basename(options.inputPath),
        format: metadata.format,
        width: metadata.width,
        height: metadata.height,
        channels: metadata.channels,
        density: metadata.density,
        hasAlpha: metadata.hasAlpha,
        colorspace: metadata.space,
        size: originalSize,
      });
      this.validateImageDimensions(metadata);
      const appliedOperations: string[] = [];
      if (options.operations) {
        pipeline = await this.applyOperations(pipeline, options.operations, appliedOperations, metadata);
      }
      const outputFormat = options.operations?.format || this.getOptimalFormat(metadata.format!);
      const quality = this.determineQuality(outputFormat, options.operations?.quality, options.quality);
      pipeline = this.applyFormatOptimizations(pipeline, outputFormat, quality);
      appliedOperations.push(`format:${outputFormat}${quality ? `:q${quality}` : ''}`);
      const outputFilename = options.filename || this.generateOutputFilename(
        path.basename(options.inputPath),
        outputFormat,
        appliedOperations
      );
      const outputPath = path.join(outputDir, outputFilename);
      const info = await pipeline.toFile(outputPath);
      const processedStats = await fs.stat(outputPath);
      const processedSize = processedStats.size;
      const processingTime = performance.now() - startTime;
      const finalMetadata = await sharp(outputPath).metadata();
      const result: ProcessingResult = {
        outputPath,
        originalSize,
        processedSize,
        format: outputFormat,
        width: info.width,
        height: info.height,
        processingTime: Math.round(processingTime),
        operations: appliedOperations,
        metadata: {
          density: finalMetadata.density,
          hasAlpha: finalMetadata.hasAlpha || false,
          channels: finalMetadata.channels || 3,
          colorspace: finalMetadata.space || 'unknown',
        },
      };
      logger.info('Image processed successfully:', {
        inputFile: path.basename(options.inputPath),
        outputFile: outputFilename,
        originalSize: `${Math.round(originalSize / 1024)}KB`,
        processedSize: `${Math.round(processedSize / 1024)}KB`,
        compressionRatio: `${Math.round((1 - processedSize / originalSize) * 100)}%`,
        processingTime: `${processingTime.toFixed(2)}ms`,
        operations: appliedOperations,
        dimensions: `${info.width}x${info.height}`,
      });
      return result;
    } catch (error) {
      const processingTime = performance.now() - startTime;
      logger.error('Image processing failed:', {
        inputPath: options.inputPath,
        operations: options.operations,
        error: error instanceof Error ? error.message : error,
        stack: error instanceof Error ? error.stack : undefined,
        processingTime: `${processingTime.toFixed(2)}ms`,
      });
      if (error instanceof Error && error.message.includes('Input file is missing')) {
        throw new AppError('Input file not found', 404, 'FILE_NOT_FOUND');
      }
      if (error instanceof Error && error.message.includes('Input file contains unsupported image format')) {
        throw new AppError('Unsupported image format', 400, 'UNSUPPORTED_FORMAT');
      }
      if (error instanceof Error && error.message.includes('Image too large')) {
        throw new AppError('Image dimensions exceed maximum allowed size', 413, 'IMAGE_TOO_LARGE');
      }
      throw new AppError(
        `Image processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        500,
        'PROCESSING_ERROR'
      );
    }
  }

  private static async applyOperations(
    pipeline: Sharp,
    operations: ImageOperations,
    appliedOperations: string[],
    originalMetadata: sharp.Metadata
  ): Promise<Sharp> {
    if (operations.rotate !== undefined && operations.rotate !== 0) {
      pipeline = this.applyRotation(pipeline, operations.rotate);
      appliedOperations.push(`rotate:${operations.rotate}°`);
    }
    if (operations.crop) {
      pipeline = await this.applyCrop(pipeline, operations.crop, originalMetadata);
      appliedOperations.push(`crop:${operations.crop.width}x${operations.crop.height}+${operations.crop.x}+${operations.crop.y}`);
    }
    if (operations.resize) {
      pipeline = this.applyResize(pipeline, operations.resize);
      const resizeDesc = `resize:${operations.resize.width || 'auto'}x${operations.resize.height || 'auto'}`;
      appliedOperations.push(resizeDesc);
    }
    if (operations.grayscale) {
      pipeline = pipeline.greyscale(true);
      appliedOperations.push('grayscale');
    }
    if (operations.blur !== undefined && operations.blur > 0) {
      pipeline = this.applyBlur(pipeline, operations.blur);
      appliedOperations.push(`blur:${operations.blur}`);
    }
    if (operations.sharpen) {
      pipeline = this.applySharpen(pipeline);
      appliedOperations.push('sharpen');
    }
    return pipeline;
  }

  private static applyRotation(pipeline: Sharp, degrees: number): Sharp {
    const normalizedDegrees = degrees % 360;
    if (normalizedDegrees === 0) {
      return pipeline;
    }
    const needsBackground = normalizedDegrees % 90 !== 0;
    return pipeline.rotate(normalizedDegrees, {
      background: needsBackground ? { r: 255, g: 255, b: 255, alpha: 1 } : undefined,
    });
  }

  private static async applyCrop(
    pipeline: Sharp,
    crop: CropOperation,
    originalMetadata: sharp.Metadata
  ): Promise<Sharp> {
    const { x, y, width, height } = crop;
    if (originalMetadata.width && originalMetadata.height) {
      if (x + width > originalMetadata.width || y + height > originalMetadata.height) {
        logger.warn('Crop dimensions exceed image boundaries, adjusting...', {
          originalDimensions: `${originalMetadata.width}x${originalMetadata.height}`,
          cropRegion: `${width}x${height}+${x}+${y}`,
        });
        const adjustedWidth = Math.min(width, originalMetadata.width - x);
        const adjustedHeight = Math.min(height, originalMetadata.height - y);
        return pipeline.extract({
          left: x,
          top: y,
          width: adjustedWidth,
          height: adjustedHeight,
        });
      }
    }
    return pipeline.extract({
      left: x,
      top: y,
      width,
      height,
    });
  }

  private static applyResize(pipeline: Sharp, resize: ResizeOperation): Sharp {
    const resizeOptions: ResizeOptions = {
      width: resize.width,
      height: resize.height,
      fit: resize.fit || 'cover',
      position: resize.position || 'center',
      withoutEnlargement: false,
      fastShrinkOnLoad: true,
    };
    const kernel = this.selectResamplingKernel(resize);
    if (kernel) {
      resizeOptions.kernel = kernel;
    }
    return pipeline.resize(resizeOptions);
  }

  private static selectResamplingKernel(resize: ResizeOperation): keyof sharp.KernelEnum | undefined {
    if (!resize.width && !resize.height) return undefined;
    return 'lanczos3';
  }

  private static applyBlur(pipeline: Sharp, sigma: number): Sharp {
    const clampedSigma = Math.max(0.3, Math.min(1000, sigma));
    if (clampedSigma > 100) {
      logger.debug('Using optimized blur for high sigma value', { sigma: clampedSigma });
      return pipeline.blur(Math.min(clampedSigma, 100));
    }
    return pipeline.blur(clampedSigma);
  }

  private static applySharpen(pipeline: Sharp): Sharp {
    return pipeline.sharpen(1.0);
  }

  private static applyFormatOptimizations(
    pipeline: Sharp,
    format: string,
    quality?: number
  ): Sharp {
    switch (format.toLowerCase()) {
      case 'jpeg':
      case 'jpg':
        return pipeline.jpeg({
          quality: quality || this.FORMAT_QUALITIES.jpeg,
          ...this.COMPRESSION_SETTINGS.jpeg,
        });
      case 'webp':
        return pipeline.webp({
          quality: quality || this.FORMAT_QUALITIES.webp,
          ...this.COMPRESSION_SETTINGS.webp,
        });
      case 'avif':
        return pipeline.avif({
          quality: quality || this.FORMAT_QUALITIES.avif,
          ...this.COMPRESSION_SETTINGS.avif,
        });
      case 'png':
        return pipeline.png({
          ...this.COMPRESSION_SETTINGS.png,
        });
      case 'heif':
        return pipeline.heif({
          quality: quality || this.FORMAT_QUALITIES.heif,
        });
      default:
        logger.warn('Unknown format, using default settings', { format });
        return pipeline;
    }
  }

  private static determineQuality(
    format: string,
    userQuality?: number,
    fallbackQuality?: number
  ): number | undefined {
    if (format.toLowerCase() === 'png') {
      return undefined;
    }
    if (userQuality !== undefined) {
      return Math.max(1, Math.min(100, userQuality));
    }
    if (fallbackQuality !== undefined) {
      return Math.max(1, Math.min(100, fallbackQuality));
    }
    return this.FORMAT_QUALITIES[format.toLowerCase()] || this.DEFAULT_QUALITY;
  }

  private static getOptimalFormat(inputFormat: string): string {
    const normalizedFormat = inputFormat.toLowerCase();
    const formatMap: Record<string, string> = {
      'jpeg': 'jpeg',
      'jpg': 'jpeg',
      'png': 'png',
      'webp': 'webp',
      'avif': 'avif',
      'tiff': 'jpeg',
      'tif': 'jpeg',
      'bmp': 'jpeg',
      'gif': 'png',
    };
    return formatMap[normalizedFormat] || 'jpeg';
  }

  private static generateOutputFilename(
    originalFilename: string,
    format: string,
    operations: string[]
  ): string {
    const baseName = path.parse(originalFilename).name;
    const timestamp = Date.now();
    const operationSuffix = operations.length > 0 ? `_${operations.length}ops` : '';
    return `${baseName}_processed_${timestamp}${operationSuffix}.${format}`;
  }

  private static validateImageDimensions(metadata: sharp.Metadata): void {
    if (!metadata.width || !metadata.height) {
      throw new AppError('Cannot determine image dimensions', 400, 'INVALID_IMAGE');
    }
    if (metadata.width > this.MAX_DIMENSION || metadata.height > this.MAX_DIMENSION) {
      throw new AppError(
        `Image dimensions (${metadata.width}x${metadata.height}) exceed maximum allowed (${this.MAX_DIMENSION}x${this.MAX_DIMENSION})`,
        413,
        'IMAGE_TOO_LARGE'
      );
    }
    if (metadata.width < this.MIN_DIMENSION || metadata.height < this.MIN_DIMENSION) {
      throw new AppError(
        `Image dimensions (${metadata.width}x${metadata.height}) below minimum required (${this.MIN_DIMENSION}x${this.MIN_DIMENSION})`,
        400,
        'IMAGE_TOO_SMALL'
      );
    }
  }

  static getSupportedFormats(): string[] {
    return Object.keys(this.FORMAT_QUALITIES);
  }

  static getQualityRecommendations(): Record<string, { min: number; recommended: number; max: number }> {
    return {
      jpeg: { min: 60, recommended: 85, max: 95 },
      webp: { min: 70, recommended: 80, max: 90 },
      avif: { min: 50, recommended: 60, max: 80 },
      heif: { min: 60, recommended: 70, max: 90 },
    };
  }

  static async cleanupOldFiles(maxAgeHours = 24): Promise<number> {
    try {
      const files = await fs.readdir(IMAGE_CONFIG.PROCESSED_DIR);
      const cutoffTime = Date.now() - (maxAgeHours * 60 * 60 * 1000);
      let deletedCount = 0;
      for (const file of files) {
        const filePath = path.join(IMAGE_CONFIG.PROCESSED_DIR, file);
        try {
          const stats = await fs.stat(filePath);
          if (stats.mtime.getTime() < cutoffTime) {
            await fs.unlink(filePath);
            deletedCount++;
          }
        } catch (error) {
          logger.warn('Failed to cleanup processed file:', { filePath, error });
        }
      }
      if (deletedCount > 0) {
        logger.info('Cleaned up old processed files:', {
          deletedCount,
          maxAgeHours,
          processedDir: IMAGE_CONFIG.PROCESSED_DIR,
        });
      }
      return deletedCount;
    } catch (error) {
      logger.error('Processed files cleanup failed:', error);
      return 0;
    }
  }
}