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
sharp.concurrency(2);
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
  
  // Enhanced compression settings with size reduction focus
  private static readonly COMPRESSION_SETTINGS = {
    jpeg: {
      progressive: true,
      mozjpeg: true,
      trellisQuantisation: true,
      optimiseScans: true,
      quantisationTable: 3, // More aggressive compression
    },
    webp: {
      effort: 6, // Maximum effort for better compression
      nearLossless: false,
      smartSubsample: true,
      preset: 'photo' as const,
    },
    avif: {
      effort: 9, // Maximum effort for AVIF
      chromaSubsampling: '4:2:0' as const,
      speed: 2, // Balance between speed and compression
    },
    png: {
      compressionLevel: 9, // Maximum PNG compression
      adaptiveFiltering: true,
      progressive: false,
      palette: true, // Use palette when possible
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
      
      pipeline = this.applyFormatOptimizations(pipeline, outputFormat, quality, options.operations);
      appliedOperations.push(`format:${outputFormat}${quality ? `:q${quality}` : ''}`);
      
      const outputFilename = options.filename || this.generateOutputFilename(
        path.basename(options.inputPath),
        outputFormat,
        appliedOperations
      );
      const outputPath = path.join(outputDir, outputFilename);
      
      const info = await pipeline.toFile(outputPath);
      
      // Check for zero dimensions
      if (info.width === 0 || info.height === 0) {
        await fs.unlink(outputPath).catch(() => {});
        throw new AppError('Processed image has zero dimensions. Invalid operations or input.', 500, 'ZERO_DIMENSIONS');
      }
      
      // Check for empty file
      const processedStats = await fs.stat(outputPath);
      if (processedStats.size === 0) {
        await fs.unlink(outputPath).catch(() => {});
        throw new AppError('Image processing resulted in empty file. Possible invalid operations or corrupt input.', 500, 'EMPTY_OUTPUT');
      }
      
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
    // Apply rotate first as it affects dimensions
    if (operations.rotate !== undefined && operations.rotate !== 0) {
      pipeline = this.applyRotation(pipeline, operations.rotate);
      appliedOperations.push(`rotate:${operations.rotate}°`);
    }
    
    // Apply flip/flop transformations
    if (operations.flip) {
      pipeline = pipeline.flip();
      appliedOperations.push('flip');
    }
    
    if (operations.flop) {
      pipeline = pipeline.flop();
      appliedOperations.push('flop');
    }
    
    // Apply crop before resize
    if (operations.crop) {
      pipeline = await this.applyCrop(pipeline, operations.crop, originalMetadata);
      appliedOperations.push(`crop:${operations.crop.width}x${operations.crop.height}+${operations.crop.x}+${operations.crop.y}`);
    }
    
    // Apply resize
    if (operations.resize) {
      pipeline = this.applyResize(pipeline, operations.resize);
      const resizeDesc = `resize:${operations.resize.width || 'auto'}x${operations.resize.height || 'auto'}`;
      appliedOperations.push(resizeDesc);
    }
    
    // Apply color adjustments
    if (operations.brightness !== undefined) {
      pipeline = this.applyBrightness(pipeline, operations.brightness);
      appliedOperations.push(`brightness:${operations.brightness}`);
    }
    
    if (operations.contrast !== undefined) {
      pipeline = this.applyContrast(pipeline, operations.contrast);
      appliedOperations.push(`contrast:${operations.contrast}`);
    }
    
    if (operations.saturation !== undefined) {
      pipeline = this.applySaturation(pipeline, operations.saturation);
      appliedOperations.push(`saturation:${operations.saturation}`);
    }
    
    if (operations.hue !== undefined) {
      pipeline = this.applyHue(pipeline, operations.hue);
      appliedOperations.push(`hue:${operations.hue}`);
    }
    
    if (operations.gamma !== undefined) {
      pipeline = this.applyGamma(pipeline, operations.gamma);
      appliedOperations.push(`gamma:${operations.gamma}`);
    }
    
    // Apply filters
    if (operations.grayscale) {
      pipeline = pipeline.greyscale(true);
      appliedOperations.push('grayscale');
    }
    
    if (operations.sepia) {
      pipeline = this.applySepia(pipeline);
      appliedOperations.push('sepia');
    }
    
    if (operations.negate) {
      pipeline = pipeline.negate();
      appliedOperations.push('negate');
    }
    
    if (operations.normalize) {
      pipeline = pipeline.normalise();
      appliedOperations.push('normalize');
    }
    
    // Apply blur and sharpen
    if (operations.blur !== undefined && operations.blur > 0) {
      pipeline = this.applyBlur(pipeline, operations.blur);
      appliedOperations.push(`blur:${operations.blur}`);
    }
    
    if (operations.sharpen) {
      pipeline = this.applySharpen(pipeline, operations.sharpen);
      appliedOperations.push(`sharpen:${operations.sharpen}`);
    }
    
    // Apply watermark last (after all other operations)
    if (operations.watermark) {
      pipeline = await this.applyWatermark(pipeline, operations.watermark);
     
      let watermarkDesc:string;
      if(operations.watermark.type ==="text"){
        watermarkDesc = `watermark:text:"${operations.watermark.text.substring(0,20)}"`;
      }
      else{
        watermarkDesc = `watermark:image:"${operations.watermark.imagePath}"`;
      }

      appliedOperations.push(watermarkDesc);
    }
    
    return pipeline;
  }

  // NEW: Brightness adjustment
  private static applyBrightness(pipeline: Sharp, brightness: number): Sharp {
    // Brightness range: -100 to +100, convert to Sharp's modifier range
    const modifier = Math.max(-1, Math.min(1, brightness / 100));
    return pipeline.modulate({ brightness: 1 + modifier });
  }

  // NEW: Contrast adjustment
  private static applyContrast(pipeline: Sharp, contrast: number): Sharp {
    // Contrast range: -100 to +100, convert to multiplier
    const multiplier = Math.max(0.1, Math.min(3, 1 + (contrast / 100)));
    return pipeline.linear(multiplier, 0);
  }

  // NEW: Saturation adjustment
  private static applySaturation(pipeline: Sharp, saturation: number): Sharp {
    // Saturation range: -100 to +100, convert to multiplier
    const multiplier = Math.max(0, Math.min(2, 1 + (saturation / 100)));
    return pipeline.modulate({ saturation: multiplier });
  }

  // NEW: Hue rotation
  private static applyHue(pipeline: Sharp, hue: number): Sharp {
    // Hue range: -360 to +360 degrees
    const normalizedHue = ((hue % 360) + 360) % 360;
    return pipeline.modulate({ hue: normalizedHue });
  }

  // NEW: Gamma correction
  private static applyGamma(pipeline: Sharp, gamma: number): Sharp {
    // Gamma range: 0.1 to 3.0
    const clampedGamma = Math.max(0.1, Math.min(3.0, gamma));
    return pipeline.gamma(clampedGamma);
  }

  // NEW: Sepia filter
  private static applySepia(pipeline: Sharp): Sharp {
    // Apply sepia effect using color matrix
    return pipeline.recomb([
      [0.393, 0.769, 0.189],
      [0.349, 0.686, 0.168],
      [0.272, 0.534, 0.131]
    ]);
  }

  // NEW: Enhanced watermark support
  private static async applyWatermark(
    pipeline: Sharp, 
    watermark: NonNullable<ImageOperations['watermark']>
  ): Promise<Sharp> {
    try {
      if (watermark.type==="text") {
        return await this.applyTextWatermark(pipeline, watermark);
      } else if (watermark.type === "image") {
        return await this.applyImageWatermark(pipeline, watermark);
      }
    } catch (error) {
      logger.warn('Watermark application failed, continuing without watermark:', error);
    }
    
    return pipeline;
  }

  // NEW: Text watermark
  private static async applyTextWatermark(
    pipeline: Sharp, 
    watermark: NonNullable<ImageOperations['watermark']>
  ): Promise<Sharp> {
    if (watermark.type!=="text") return pipeline;

    const metadata = await pipeline.metadata();
    const width = metadata.width || 800;
    const height = metadata.height || 600;
    
    // Calculate font size based on image dimensions
    const fontSize = Math.max(12, Math.min(72, Math.floor(width / 20)));
    const opacity = Math.max(0.1, Math.min(1, watermark.opacity || 0.5));
    
    // Create SVG text watermark
    const textSvg = `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <text x="50%" y="50%" 
              font-family="Arial, sans-serif" 
              font-size="${fontSize}px" 
              fill="rgba(255,255,255,${opacity})" 
              stroke="rgba(0,0,0,${opacity * 0.5})" 
              stroke-width="1"
              text-anchor="middle" 
              dominant-baseline="middle">
          ${watermark.text}
        </text>
      </svg>
    `;
    
    const textBuffer = Buffer.from(textSvg);
    const position = this.getWatermarkPosition(watermark.gravity || 'center');
    
    return pipeline.composite([{
      input: textBuffer,
      ...position,
      blend: 'over'
    }]);
  }

  // NEW: Image watermark
  private static async applyImageWatermark(
    pipeline: Sharp, 
    watermark: NonNullable<ImageOperations['watermark']>
  ): Promise<Sharp> {
    if (watermark.type!=="image") return pipeline;

    try {
      // Check if watermark image exists
      await fs.access(watermark.imagePath);
      
      const metadata = await pipeline.metadata();
      const mainWidth = metadata.width || 800;
      const mainHeight = metadata.height || 600;
      
      // Resize watermark to 20% of main image
      const watermarkSize = Math.min(mainWidth, mainHeight) * 0.2;
      const opacity = Math.max(0.1, Math.min(1, watermark.opacity || 0.7));
      
      const watermarkBuffer = await sharp(watermark.imagePath)
        .resize(watermarkSize, watermarkSize, { fit: 'inside' })
        .composite([{
          input: Buffer.from([255, 255, 255, Math.round(255 * (1 - opacity))]),
          raw: { width: 1, height: 1, channels: 4 },
          tile: true,
          blend: 'dest-in'
        }])
        .png()
        .toBuffer();
      
      const position = this.getWatermarkPosition(watermark.gravity || 'bottom-right');
      
      return pipeline.composite([{
        input: watermarkBuffer,
        ...position,
        blend: 'over'
      }]);
    } catch (error) {
      logger.warn('Image watermark file not found or invalid:', watermark.imagePath);
      return pipeline;
    }
  }

  // NEW: Watermark positioning helper
  private static getWatermarkPosition(position: string): { top?: number; left?: number; gravity?: string } {
    switch (position) {
      case 'top-left':
        return { top: 10, left: 10 };
      case 'top-right':
        return { gravity: 'northeast' };
      case 'bottom-left':
        return { gravity: 'southwest' };
      case 'bottom-right':
        return { gravity: 'southeast' };
      case 'center':
      default:
        return { gravity: 'center' };
    }
  }

  private static applyRotation(pipeline: Sharp, degrees: number): Sharp {
    const normalizedDegrees = degrees % 360;
    if (normalizedDegrees === 0) {
      return pipeline;
    }
    
    return pipeline.rotate(normalizedDegrees, {
      background: { r: 255, g: 255, b: 255, alpha: 1 },
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
        
        if (adjustedWidth <= 0 || adjustedHeight <= 0) {
          throw new AppError('Crop dimensions result in empty image', 400, 'INVALID_CROP');
        }
        
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
    if ((resize.width ?? 0) <= 0 && (resize.height ?? 0) <= 0) {
      throw new AppError('Resize dimensions result in empty image', 400, 'INVALID_RESIZE');
    }
    
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

  // Enhanced sharpen with intensity control
  private static applySharpen(pipeline: Sharp, intensity?: number): Sharp {
    const sharpening = Math.max(0.5, Math.min(10, intensity || 1.0));
    return pipeline.sharpen(sharpening);
  }

  // Enhanced format optimizations with compression support
private static applyFormatOptimizations(
  pipeline: Sharp,
  format: string,
  quality?: number,
  operations?: ImageOperations
): Sharp {
  const useProgressive = operations?.progressive !== false;
  const compressionLevel = operations?.compression;
  
  switch (format.toLowerCase()) {
    case 'jpeg':
    case 'jpg':
      return pipeline.jpeg({
        ...this.COMPRESSION_SETTINGS.jpeg,
        quality: quality || this.FORMAT_QUALITIES.jpeg,
        progressive: useProgressive,
      });
      
    case 'webp':
      return pipeline.webp({
        ...this.COMPRESSION_SETTINGS.webp,
        quality: operations?.lossless ? undefined : (quality || this.FORMAT_QUALITIES.webp),
        lossless: operations?.lossless || false,
      });
      
    case 'avif':
      return pipeline.avif({
        ...this.COMPRESSION_SETTINGS.avif,
        quality: operations?.lossless ? undefined : (quality || this.FORMAT_QUALITIES.avif),
        lossless: operations?.lossless || false,
      });
      
    case 'png':
      return pipeline.png({
        ...this.COMPRESSION_SETTINGS.png,
        compressionLevel: compressionLevel !== undefined ? 
          Math.max(0, Math.min(9, compressionLevel)) : 
          this.COMPRESSION_SETTINGS.png.compressionLevel,
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

  // NEW: Get compression recommendations
  static getCompressionRecommendations(): Record<string, { 
    fileSize: { small: number; medium: number; large: number }; 
    quality: { web: number; print: number; archive: number };
    formats: { web: string[]; mobile: string[]; archive: string[] };
  }> {
    return {
      web: {
        fileSize: { small: 50, medium: 200, large: 500 }, // KB
        quality: { web: 75, print: 90, archive: 95 },
        formats: { web: ['webp', 'avif'], mobile: ['webp', 'jpeg'], archive: ['png', 'tiff'] }
      }
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