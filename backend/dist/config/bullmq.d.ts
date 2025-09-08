import { Queue } from 'bullmq';
export declare const imageQueue: Queue<any, any, string, any, any, string>;
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
    position?: 'center' | 'top' | 'right' | 'bottom' | 'left';
}
export type watermark = {
    type: "text";
    text: string;
    fontSize?: number;
    fontFamily?: string;
    color?: string;
    opacity?: number;
    gravity?: "north" | "south" | "east" | "west" | "center";
    dx?: number;
    dy?: number;
} | {
    type: "image";
    imagePath: string;
    width?: number;
    height?: number;
    opacity?: number;
    gravity?: "north" | "south" | "east" | "west" | "center";
    dx?: number;
    dy?: number;
};
export declare const SUPPORTED_FORMATS: readonly ["jpeg", "png", "webp", "avif"];
export type SupportedFormat = typeof SUPPORTED_FORMATS[number];
export interface ImageOperations {
    crop?: CropOperation;
    resize?: ResizeOperation;
    rotate?: number;
    format?: SupportedFormat;
    quality?: number;
    grayscale?: boolean;
    blur?: number;
    sharpen?: number;
    flip?: boolean;
    flop?: boolean;
    brightness?: number;
    saturation?: number;
    hue?: number;
    contrast?: number;
    gamma?: number;
    negate?: boolean;
    normalize?: boolean;
    sepia?: boolean;
    watermark?: watermark;
    progressive?: boolean;
    compression?: number;
    lossless?: boolean;
}
export interface ImageJobPayload {
    filePath: string;
    originalName: string;
    fileSize: number;
    mimeType: string;
    uploadedAt: Date;
    operations?: ImageOperations;
    userId?: string;
    metadata?: Record<string, any>;
}
export declare enum ImageJobType {
    PROCESS_IMAGE = "process-image",
    BULK_PROCESS = "bulk-process",
    CLEANUP_TEMP = "cleanup-temp"
}
export declare enum JobPriority {
    LOW = 1,
    NORMAL = 5,
    HIGH = 10,
    CRITICAL = 15
}
