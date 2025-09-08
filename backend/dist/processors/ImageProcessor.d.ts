import { ImageOperations } from '../config/bullmq';
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
export interface WatermarkOptions {
    type: 'text' | 'image';
    text?: string;
    imagePath?: string;
    opacity: number;
    gravity: string;
    fontSize?: number;
    color?: string;
}
export declare class ImageProcessor {
    private static readonly MAX_DIMENSION;
    private static readonly MIN_DIMENSION;
    private static readonly DEFAULT_QUALITY;
    private static readonly FORMAT_QUALITIES;
    private static readonly COMPRESSION_SETTINGS;
    static processImage(options: ProcessingOptions): Promise<ProcessingResult>;
    private static applyOperations;
    private static applyBrightness;
    private static applyContrast;
    private static applySaturation;
    private static applyHue;
    private static applyGamma;
    private static applySepia;
    private static applyWatermark;
    private static applyTextWatermark;
    private static getTextWatermarkPosition;
    private static escapeXmlText;
    private static hexToRgb;
    private static applyImageWatermark;
    private static getImageWatermarkPosition;
    private static applyRotation;
    private static applyCrop;
    private static applyResize;
    private static selectResamplingKernel;
    private static applyBlur;
    private static applySharpen;
    private static applyFormatOptimizations;
    private static determineQuality;
    private static getOptimalFormat;
    private static generateOutputFilename;
    private static validateImageDimensions;
    static getSupportedFormats(): string[];
    static getQualityRecommendations(): Record<string, {
        min: number;
        recommended: number;
        max: number;
    }>;
    static getCompressionRecommendations(): Record<string, {
        fileSize: {
            small: number;
            medium: number;
            large: number;
        };
        quality: {
            web: number;
            print: number;
            archive: number;
        };
        formats: {
            web: string[];
            mobile: string[];
            archive: string[];
        };
    }>;
    static cleanupOldFiles(maxAgeHours?: number): Promise<number>;
}
