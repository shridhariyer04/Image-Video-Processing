"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ImageProcessor = void 0;
const sharp_1 = __importDefault(require("sharp"));
const path_1 = __importDefault(require("path"));
const fs_1 = require("fs");
const image_config_1 = require("../config/image.config");
const logger_1 = __importDefault(require("../utils/logger"));
const error_1 = require("../utils/error");
const perf_hooks_1 = require("perf_hooks");
// Sharp configuration for optimal performance
sharp_1.default.cache({ memory: 256 });
sharp_1.default.concurrency(2);
sharp_1.default.simd(true);
class ImageProcessor {
    static MAX_DIMENSION = 10000;
    static MIN_DIMENSION = 1;
    static DEFAULT_QUALITY = 85;
    static FORMAT_QUALITIES = {
        jpeg: 85,
        webp: 80,
        avif: 60,
        heif: 70,
    };
    // Enhanced compression settings with size reduction focus
    static COMPRESSION_SETTINGS = {
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
            preset: 'photo',
        },
        avif: {
            effort: 9, // Maximum effort for AVIF
            chromaSubsampling: '4:2:0',
            speed: 2, // Balance between speed and compression
        },
        png: {
            compressionLevel: 9, // Maximum PNG compression
            adaptiveFiltering: true,
            progressive: false,
            palette: true, // Use palette when possible
        },
    };
    static async processImage(options) {
        const startTime = perf_hooks_1.performance.now();
        try {
            const outputDir = options.outputDir || image_config_1.IMAGE_CONFIG.PROCESSED_DIR;
            await fs_1.promises.mkdir(outputDir, { recursive: true });
            const originalStats = await fs_1.promises.stat(options.inputPath);
            const originalSize = originalStats.size;
            let pipeline = (0, sharp_1.default)(options.inputPath);
            const metadata = await pipeline.metadata();
            logger_1.default.debug('Image metadata:', {
                filename: path_1.default.basename(options.inputPath),
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
            const appliedOperations = [];
            if (options.operations) {
                pipeline = await this.applyOperations(pipeline, options.operations, appliedOperations, metadata);
            }
            const outputFormat = options.operations?.format || this.getOptimalFormat(metadata.format);
            const quality = this.determineQuality(outputFormat, options.operations?.quality, options.quality);
            pipeline = this.applyFormatOptimizations(pipeline, outputFormat, quality, options.operations);
            appliedOperations.push(`format:${outputFormat}${quality ? `:q${quality}` : ''}`);
            const outputFilename = options.filename || this.generateOutputFilename(path_1.default.basename(options.inputPath), outputFormat, appliedOperations);
            const outputPath = path_1.default.join(outputDir, outputFilename);
            const info = await pipeline.toFile(outputPath);
            // Check for zero dimensions
            if (info.width === 0 || info.height === 0) {
                await fs_1.promises.unlink(outputPath).catch(() => { });
                throw new error_1.AppError('Processed image has zero dimensions. Invalid operations or input.', 500, 'ZERO_DIMENSIONS');
            }
            // Check for empty file
            const processedStats = await fs_1.promises.stat(outputPath);
            if (processedStats.size === 0) {
                await fs_1.promises.unlink(outputPath).catch(() => { });
                throw new error_1.AppError('Image processing resulted in empty file. Possible invalid operations or corrupt input.', 500, 'EMPTY_OUTPUT');
            }
            const processedSize = processedStats.size;
            const processingTime = perf_hooks_1.performance.now() - startTime;
            const finalMetadata = await (0, sharp_1.default)(outputPath).metadata();
            const result = {
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
            logger_1.default.info('Image processed successfully:', {
                inputFile: path_1.default.basename(options.inputPath),
                outputFile: outputFilename,
                originalSize: `${Math.round(originalSize / 1024)}KB`,
                processedSize: `${Math.round(processedSize / 1024)}KB`,
                compressionRatio: `${Math.round((1 - processedSize / originalSize) * 100)}%`,
                processingTime: `${processingTime.toFixed(2)}ms`,
                operations: appliedOperations,
                dimensions: `${info.width}x${info.height}`,
            });
            return result;
        }
        catch (error) {
            const processingTime = perf_hooks_1.performance.now() - startTime;
            logger_1.default.error('Image processing failed:', {
                inputPath: options.inputPath,
                operations: options.operations,
                error: error instanceof Error ? error.message : error,
                stack: error instanceof Error ? error.stack : undefined,
                processingTime: `${processingTime.toFixed(2)}ms`,
            });
            if (error instanceof Error && error.message.includes('Input file is missing')) {
                throw new error_1.AppError('Input file not found', 404, 'FILE_NOT_FOUND');
            }
            if (error instanceof Error && error.message.includes('Input file contains unsupported image format')) {
                throw new error_1.AppError('Unsupported image format', 400, 'UNSUPPORTED_FORMAT');
            }
            if (error instanceof Error && error.message.includes('Image too large')) {
                throw new error_1.AppError('Image dimensions exceed maximum allowed size', 413, 'IMAGE_TOO_LARGE');
            }
            throw new error_1.AppError(`Image processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 500, 'PROCESSING_ERROR');
        }
    }
    static async applyOperations(pipeline, operations, appliedOperations, originalMetadata) {
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
            let watermarkDesc;
            if (operations.watermark.type === "text") {
                watermarkDesc = `watermark:text:"${operations.watermark.text.substring(0, 20)}"`;
            }
            else {
                watermarkDesc = `watermark:image:"${operations.watermark.imagePath}"`;
            }
            appliedOperations.push(watermarkDesc);
        }
        return pipeline;
    }
    // NEW: Brightness adjustment
    static applyBrightness(pipeline, brightness) {
        // Brightness range: -100 to +100, convert to Sharp's modifier range
        const modifier = Math.max(-1, Math.min(1, brightness / 100));
        return pipeline.modulate({ brightness: 1 + modifier });
    }
    // NEW: Contrast adjustment
    static applyContrast(pipeline, contrast) {
        // Contrast range: -100 to +100, convert to multiplier
        const multiplier = Math.max(0.1, Math.min(3, 1 + (contrast / 100)));
        return pipeline.linear(multiplier, 0);
    }
    // NEW: Saturation adjustment
    static applySaturation(pipeline, saturation) {
        // Saturation range: -100 to +100, convert to multiplier
        const multiplier = Math.max(0, Math.min(2, 1 + (saturation / 100)));
        return pipeline.modulate({ saturation: multiplier });
    }
    // NEW: Hue rotation
    static applyHue(pipeline, hue) {
        // Hue range: -360 to +360 degrees
        const normalizedHue = ((hue % 360) + 360) % 360;
        return pipeline.modulate({ hue: normalizedHue });
    }
    // NEW: Gamma correction
    static applyGamma(pipeline, gamma) {
        // Gamma range: 0.1 to 3.0
        const clampedGamma = Math.max(0.1, Math.min(3.0, gamma));
        return pipeline.gamma(clampedGamma);
    }
    // NEW: Sepia filter
    static applySepia(pipeline) {
        // Apply sepia effect using color matrix
        return pipeline.recomb([
            [0.393, 0.769, 0.189],
            [0.349, 0.686, 0.168],
            [0.272, 0.534, 0.131]
        ]);
    }
    // NEW: Enhanced watermark support
    static async applyWatermark(pipeline, watermark) {
        try {
            if (watermark.type === "text") {
                return await this.applyTextWatermark(pipeline, watermark);
            }
            else if (watermark.type === "image") {
                return await this.applyImageWatermark(pipeline, watermark);
            }
        }
        catch (error) {
            logger_1.default.warn('Watermark application failed, continuing without watermark:', error);
        }
        return pipeline;
    }
    // Fixed text watermark method
    static async applyTextWatermark(pipeline, watermark) {
        if (watermark.type !== "text" || !watermark.text)
            return pipeline;
        const metadata = await pipeline.metadata();
        const width = metadata.width || 800;
        const height = metadata.height || 600;
        // Use custom font size or calculate based on image
        const fontSize = watermark.fontSize || Math.max(16, Math.min(72, Math.floor(width / 30)));
        const opacity = Math.max(0.1, Math.min(1, watermark.opacity || 0.5));
        const color = watermark.color || '#ffffff';
        // Get position coordinates - FIXED
        const position = this.getTextWatermarkPosition(watermark.gravity || 'bottom-right', width, height, fontSize);
        // Create SVG text watermark with proper positioning - FIXED
        const textSvg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="shadow">
          <feDropShadow dx="2" dy="2" stdDeviation="2" flood-opacity="${opacity * 0.5}"/>
        </filter>
      </defs>
      <text x="${position.x}" y="${position.y}" 
            font-family="Arial, sans-serif" 
            font-size="${fontSize}px" 
            font-weight="bold"
            fill="${color}" 
            fill-opacity="${opacity}"
            text-anchor="${position.anchor}" 
            dominant-baseline="${position.baseline}"
            filter="url(#shadow)">
        ${this.escapeXmlText(watermark.text)}
      </text>
    </svg>
  `;
        const textBuffer = Buffer.from(textSvg);
        return pipeline.composite([{
                input: textBuffer,
                blend: 'over'
            }]);
    }
    // FIXED positioning method
    static getTextWatermarkPosition(gravity, width, height, fontSize) {
        const margin = Math.max(20, fontSize * 0.5); // Dynamic margin based on font size
        switch (gravity) {
            case 'top-left':
                return {
                    x: margin,
                    y: margin + fontSize,
                    anchor: 'start',
                    baseline: 'text-before-edge'
                };
            case 'top':
                return {
                    x: width / 2,
                    y: margin + fontSize,
                    anchor: 'middle',
                    baseline: 'text-before-edge'
                };
            case 'top-right':
                return {
                    x: width - margin,
                    y: margin + fontSize,
                    anchor: 'end',
                    baseline: 'text-before-edge'
                };
            case 'left':
                return {
                    x: margin,
                    y: height / 2,
                    anchor: 'start',
                    baseline: 'central'
                };
            case 'center':
                return {
                    x: width / 2,
                    y: height / 2,
                    anchor: 'middle',
                    baseline: 'central'
                };
            case 'right':
                return {
                    x: width - margin,
                    y: height / 2,
                    anchor: 'end',
                    baseline: 'central'
                };
            case 'bottom-left':
                return {
                    x: margin,
                    y: height - margin,
                    anchor: 'start',
                    baseline: 'text-after-edge'
                };
            case 'bottom':
                return {
                    x: width / 2,
                    y: height - margin,
                    anchor: 'middle',
                    baseline: 'text-after-edge'
                };
            case 'bottom-right':
            default:
                return {
                    x: width - margin,
                    y: height - margin,
                    anchor: 'end',
                    baseline: 'text-after-edge'
                };
        }
    }
    // NEW: Add XML text escaping method
    static escapeXmlText(text) {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }
    // FIXED color conversion method
    static hexToRgb(hex) {
        // Remove # if present
        hex = hex.replace('#', '');
        // Handle shorthand hex (e.g., "fff" -> "ffffff")
        if (hex.length === 3) {
            hex = hex.split('').map(char => char + char).join('');
        }
        // Default to white if invalid
        if (hex.length !== 6 || !/^[0-9A-Fa-f]+$/.test(hex)) {
            return '255,255,255';
        }
        // Convert to RGB
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);
        return `${r},${g},${b}`;
    }
    // UPDATED image watermark method (also fixed)
    static async applyImageWatermark(pipeline, watermark) {
        if (watermark.type !== "image" || !watermark.imagePath)
            return pipeline;
        try {
            // Check if watermark image exists
            await fs_1.promises.access(watermark.imagePath);
            const metadata = await pipeline.metadata();
            const mainWidth = metadata.width || 800;
            const mainHeight = metadata.height || 600;
            // Resize watermark to 15% of main image (smaller for better appearance)
            const maxWatermarkSize = Math.min(mainWidth, mainHeight) * 0.15;
            const opacity = Math.max(0.1, Math.min(1, watermark.opacity || 0.7));
            // Get watermark metadata to preserve aspect ratio
            const watermarkMeta = await (0, sharp_1.default)(watermark.imagePath).metadata();
            const aspectRatio = (watermarkMeta.width || 1) / (watermarkMeta.height || 1);
            let watermarkWidth, watermarkHeight;
            if (aspectRatio > 1) {
                // Landscape
                watermarkWidth = maxWatermarkSize;
                watermarkHeight = Math.round(maxWatermarkSize / aspectRatio);
            }
            else {
                // Portrait or square
                watermarkHeight = maxWatermarkSize;
                watermarkWidth = Math.round(maxWatermarkSize * aspectRatio);
            }
            const watermarkBuffer = await (0, sharp_1.default)(watermark.imagePath)
                .resize(watermarkWidth, watermarkHeight, { fit: 'inside' })
                .composite([{
                    input: Buffer.from([255, 255, 255, Math.round(255 * (1 - opacity))]),
                    raw: { width: 1, height: 1, channels: 4 },
                    tile: true,
                    blend: 'dest-in'
                }])
                .png()
                .toBuffer();
            const position = this.getImageWatermarkPosition(watermark.gravity || 'bottom-right', mainWidth, mainHeight, watermarkWidth, watermarkHeight);
            return pipeline.composite([{
                    input: watermarkBuffer,
                    ...position,
                    blend: 'over'
                }]);
        }
        catch (error) {
            logger_1.default.warn('Image watermark file not found or invalid:', watermark.imagePath);
            return pipeline;
        }
    }
    // UPDATED image watermark positioning helper
    static getImageWatermarkPosition(gravity, mainWidth, mainHeight, watermarkWidth, watermarkHeight) {
        const margin = 20;
        switch (gravity) {
            case 'top-left':
                return { top: margin, left: margin };
            case 'top':
                return { top: margin, left: Math.round((mainWidth - watermarkWidth) / 2) };
            case 'top-right':
                return { top: margin, left: mainWidth - watermarkWidth - margin };
            case 'left':
                return { top: Math.round((mainHeight - watermarkHeight) / 2), left: margin };
            case 'center':
                return {
                    top: Math.round((mainHeight - watermarkHeight) / 2),
                    left: Math.round((mainWidth - watermarkWidth) / 2)
                };
            case 'right':
                return {
                    top: Math.round((mainHeight - watermarkHeight) / 2),
                    left: mainWidth - watermarkWidth - margin
                };
            case 'bottom-left':
                return { top: mainHeight - watermarkHeight - margin, left: margin };
            case 'bottom':
                return {
                    top: mainHeight - watermarkHeight - margin,
                    left: Math.round((mainWidth - watermarkWidth) / 2)
                };
            case 'bottom-right':
            default:
                return {
                    top: mainHeight - watermarkHeight - margin,
                    left: mainWidth - watermarkWidth - margin
                };
        }
    }
    static applyRotation(pipeline, degrees) {
        const normalizedDegrees = degrees % 360;
        if (normalizedDegrees === 0) {
            return pipeline;
        }
        return pipeline.rotate(normalizedDegrees, {
            background: { r: 255, g: 255, b: 255, alpha: 1 },
        });
    }
    static async applyCrop(pipeline, crop, originalMetadata) {
        const { x, y, width, height } = crop;
        if (originalMetadata.width && originalMetadata.height) {
            if (x + width > originalMetadata.width || y + height > originalMetadata.height) {
                logger_1.default.warn('Crop dimensions exceed image boundaries, adjusting...', {
                    originalDimensions: `${originalMetadata.width}x${originalMetadata.height}`,
                    cropRegion: `${width}x${height}+${x}+${y}`,
                });
                const adjustedWidth = Math.min(width, originalMetadata.width - x);
                const adjustedHeight = Math.min(height, originalMetadata.height - y);
                if (adjustedWidth <= 0 || adjustedHeight <= 0) {
                    throw new error_1.AppError('Crop dimensions result in empty image', 400, 'INVALID_CROP');
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
    static applyResize(pipeline, resize) {
        if ((resize.width ?? 0) <= 0 && (resize.height ?? 0) <= 0) {
            throw new error_1.AppError('Resize dimensions result in empty image', 400, 'INVALID_RESIZE');
        }
        const resizeOptions = {
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
    static selectResamplingKernel(resize) {
        if (!resize.width && !resize.height)
            return undefined;
        return 'lanczos3';
    }
    static applyBlur(pipeline, sigma) {
        const clampedSigma = Math.max(0.3, Math.min(1000, sigma));
        if (clampedSigma > 100) {
            logger_1.default.debug('Using optimized blur for high sigma value', { sigma: clampedSigma });
            return pipeline.blur(Math.min(clampedSigma, 100));
        }
        return pipeline.blur(clampedSigma);
    }
    // Enhanced sharpen with intensity control
    static applySharpen(pipeline, intensity) {
        const sharpening = Math.max(0.5, Math.min(10, intensity || 1.0));
        return pipeline.sharpen(sharpening);
    }
    // Enhanced format optimizations with compression support
    static applyFormatOptimizations(pipeline, format, quality, operations) {
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
                logger_1.default.warn('Unknown format, using default settings', { format });
                return pipeline;
        }
    }
    static determineQuality(format, userQuality, fallbackQuality) {
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
    static getOptimalFormat(inputFormat) {
        const normalizedFormat = inputFormat.toLowerCase();
        const formatMap = {
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
    static generateOutputFilename(originalFilename, format, operations) {
        const baseName = path_1.default.parse(originalFilename).name;
        const timestamp = Date.now();
        const operationSuffix = operations.length > 0 ? `_${operations.length}ops` : '';
        return `${baseName}_processed_${timestamp}${operationSuffix}.${format}`;
    }
    static validateImageDimensions(metadata) {
        if (!metadata.width || !metadata.height) {
            throw new error_1.AppError('Cannot determine image dimensions', 400, 'INVALID_IMAGE');
        }
        if (metadata.width > this.MAX_DIMENSION || metadata.height > this.MAX_DIMENSION) {
            throw new error_1.AppError(`Image dimensions (${metadata.width}x${metadata.height}) exceed maximum allowed (${this.MAX_DIMENSION}x${this.MAX_DIMENSION})`, 413, 'IMAGE_TOO_LARGE');
        }
        if (metadata.width < this.MIN_DIMENSION || metadata.height < this.MIN_DIMENSION) {
            throw new error_1.AppError(`Image dimensions (${metadata.width}x${metadata.height}) below minimum required (${this.MIN_DIMENSION}x${this.MIN_DIMENSION})`, 400, 'IMAGE_TOO_SMALL');
        }
    }
    static getSupportedFormats() {
        return Object.keys(this.FORMAT_QUALITIES);
    }
    static getQualityRecommendations() {
        return {
            jpeg: { min: 60, recommended: 85, max: 95 },
            webp: { min: 70, recommended: 80, max: 90 },
            avif: { min: 50, recommended: 60, max: 80 },
            heif: { min: 60, recommended: 70, max: 90 },
        };
    }
    // NEW: Get compression recommendations
    static getCompressionRecommendations() {
        return {
            web: {
                fileSize: { small: 50, medium: 200, large: 500 }, // KB
                quality: { web: 75, print: 90, archive: 95 },
                formats: { web: ['webp', 'avif'], mobile: ['webp', 'jpeg'], archive: ['png', 'tiff'] }
            }
        };
    }
    static async cleanupOldFiles(maxAgeHours = 24) {
        try {
            const files = await fs_1.promises.readdir(image_config_1.IMAGE_CONFIG.PROCESSED_DIR);
            const cutoffTime = Date.now() - (maxAgeHours * 60 * 60 * 1000);
            let deletedCount = 0;
            for (const file of files) {
                const filePath = path_1.default.join(image_config_1.IMAGE_CONFIG.PROCESSED_DIR, file);
                try {
                    const stats = await fs_1.promises.stat(filePath);
                    if (stats.mtime.getTime() < cutoffTime) {
                        await fs_1.promises.unlink(filePath);
                        deletedCount++;
                    }
                }
                catch (error) {
                    logger_1.default.warn('Failed to cleanup processed file:', { filePath, error });
                }
            }
            if (deletedCount > 0) {
                logger_1.default.info('Cleaned up old processed files:', {
                    deletedCount,
                    maxAgeHours,
                    processedDir: image_config_1.IMAGE_CONFIG.PROCESSED_DIR,
                });
            }
            return deletedCount;
        }
        catch (error) {
            logger_1.default.error('Processed files cleanup failed:', error);
            return 0;
        }
    }
}
exports.ImageProcessor = ImageProcessor;
