// src/types/index.ts
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
}

export interface TextWatermark {
  type: 'text';
  text: string;
  fontSize?: number;
  fontFamily?: string;
  color?: string;
  opacity?: number;
  gravity?: 'north' | 'south' | 'east' | 'west' | 'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  dx?: number;
  dy?: number;
}

export interface ImageWatermark {
  type: 'image';
  imagePath: string;
  width?: number;
  height?: number;
  opacity?: number;
  gravity?: 'north' | 'south' | 'east' | 'west' | 'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  dx?: number;
  dy?: number;
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

export interface JobResult {
  jobId: string;
  filename: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'waiting' | 'active';
  progress?: number;
  outputPath?: string;
  error?: string;
  originalSize?: string;
  processedSize?: string;
  operations?: string[];
  result?: ProcessingResult;
  estimatedProcessingTime?: string;
  queuePosition?: number;
  priority?: string;
}

export type ConnectionStatus = 'unknown' | 'connected' | 'error';

// Legacy types for backward compatibility
export interface ResizeOptions {
  width: number;
  height: number;
}