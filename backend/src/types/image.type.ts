// src/types/image.types.ts
import { Sharp } from 'sharp';

export interface CropOperation {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ResizeOperation {
  width?: number;
  height?: number;
  fit?: 'cover' | 'contain' | 'fill' | 'inside' | 'outside';
  position?: 'centre' | 'center' | 'top' | 'right' | 'bottom' | 'left' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  kernel?: keyof Sharp['constructor']['prototype']['resize']['arguments'][1]['kernel'];
}

export interface TextWatermark {
  type: 'text';
  text: string;
  gravity?: 'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  opacity?: number;
}

export interface ImageWatermark {
  type: 'image';
  imagePath: string;
  gravity?: 'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  opacity?: number;
}

export type WatermarkOperation = TextWatermark | ImageWatermark;

export interface ImageOperations {
  // Basic transformations
  resize?: ResizeOperation;
  crop?: CropOperation;
  rotate?: number;
  flip?: boolean;
  flop?: boolean;
  
  // Color adjustments
  brightness?: number; // -100 to +100
  contrast?: number;   // -100 to +100
  saturation?: number; // -100 to +100
  hue?: number;        // -360 to +360
  gamma?: number;      // 0.1 to 3.0
  
  // Filters
  grayscale?: boolean;
  sepia?: boolean;
  negate?: boolean;
  normalize?: boolean;
  
  // Image enhancement
  blur?: number;       // 0.3 to 1000
  sharpen?: number;    // 0.5 to 10
  
  // Output format and quality
  format?: 'jpeg' | 'jpg' | 'png' | 'webp' | 'avif' | 'heif' | 'tiff' | 'gif';
  quality?: number;    // 1 to 100
  progressive?: boolean;
  lossless?: boolean;
  compression?: number; // 0 to 9 (for PNG)
  
  // Watermark
  watermark?: WatermarkOperation;
}

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

// Job-related types
export interface ImageJobPayload {
  filePath: string;
  originalName: string;
  fileSize: number;
  mimeType: string;
  uploadedAt: Date;
  operations?: ImageOperations;
}

export interface JobStatusResponse {
  status: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | 'paused';
  progress?: number;
  data?: ImageJobPayload;
  result?: ProcessingResult;
  error?: any;
  outputPath?: string;
  originalFileName?: string;
  processedFileName?: string;
  fileSize?: number;
  processingTime?: number;
  createdAt?: Date;
  processedAt?: Date;
  failedReason?: string;
}

// Validation types
export interface FileInfo {
  path: string;
  originalName: string;
  size: number;
  mimeType: string;
}

export interface ValidationContext {
  fileSize: number;
  mimeType: string;
  fileName: string;
}