import { ImageJobPayload } from '../config/bullmq';
import { ProcessingResult } from '../processors/ImageProcessor';
import { EventEmitter } from 'events';
interface ImageOperations {
    resize?: {
        width?: number;
        height?: number;
        fit?: 'cover' | 'contain' | 'fill' | 'inside' | 'outside';
    };
    crop?: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    rotate?: number;
    flip?: boolean;
    flop?: boolean;
    blur?: number;
    sharpen?: number;
    brightness?: number;
    contrast?: number;
    saturation?: number;
    hue?: number;
    gamma?: number;
    grayscale?: boolean;
    sepia?: boolean;
    negate?: boolean;
    normalize?: boolean;
    quality?: number;
    format?: 'jpeg' | 'png' | 'webp' | 'avif' | 'tiff' | 'gif';
    progressive?: boolean;
    lossless?: boolean;
    compression?: number;
    watermark?: {
        type: 'text' | 'image';
        text?: string;
        imagePath?: string;
        opacity: number;
        gravity: string;
        fontSize?: number;
        color?: string;
    };
}
interface JobStatusResponse {
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
interface WorkerStats {
    processed: number;
    failed: number;
    startTime: number;
    totalProcessingTime: number;
    averageProcessingTime: number;
    activeJobs: number;
    lastProcessedAt?: number;
    filesCleanedUp: number;
}
interface HealthStatus {
    status: 'healthy' | 'degraded' | 'unhealthy';
    uptime: number;
    stats: WorkerStats;
    memoryUsage: NodeJS.MemoryUsage;
    queueHealth: {
        waiting: number;
        active: number;
        completed: number;
        failed: number;
    };
}
declare class ImageWorker extends EventEmitter {
    private worker;
    private stats;
    private isShuttingDown;
    private healthCheckInterval?;
    private cleanupInterval?;
    private cleanupQueue;
    private processedFiles;
    constructor();
    /**
     * Main job processing function - SIMPLIFIED
     */
    private processJob;
    /**
     * Simple file validation
     */
    private validateFileExists;
    /**
     * Safe progress update
     */
    private updateProgress;
    /**
     * Process image job - SIMPLIFIED
     */
    private processImageJob;
    /**
     * Generate output filename
     */
    private generateOutputFilename;
    /**
     * Schedule file for cleanup - SIMPLE VERSION
     */
    private scheduleFileForCleanup;
    /**
     * Setup simple cleanup worker
     */
    private setupSimpleCleanup;
    /**
     * Process cleanup queue - SIMPLIFIED
     */
    private processCleanupQueue;
    /**
     * Validate job data
     */
    /**
   * Validate job data
   */
    private validateJobData;
    /**
     * Check if error is recoverable
     */
    private isRecoverableError;
    /**
     * Get job status
     */
    getJobStatus(jobId: string): Promise<JobStatusResponse | null>;
    /**
     * Update processing statistics
     */
    private updateStats;
    /**
     * Setup event handlers
     */
    private setupEventHandlers;
    /**
     * Setup health check
     */
    private setupHealthCheck;
    /**
     * Get health status
     */
    getHealthStatus(): Promise<HealthStatus>;
    /**
     * Start the worker
     */
    start(): Promise<void>;
    /**
     * Stop the worker
     */
    stop(): Promise<void>;
    getStats(): WorkerStats;
}
export declare const imageWorker: ImageWorker;
export type { ImageOperations, JobStatusResponse };
export { ImageWorker };
