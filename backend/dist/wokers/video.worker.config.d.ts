import { VideoJobPayload, VideoOperations } from '../config/videobullmq';
import { VideoProcessingResult } from '../processors/VideoProcessor';
import { EventEmitter } from 'events';
interface VideoJobStatusResponse {
    status: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | 'paused';
    progress?: number;
    data?: VideoJobPayload;
    result?: VideoProcessingResult;
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
interface VideoWorkerStats {
    processed: number;
    failed: number;
    startTime: number;
    totalProcessingTime: number;
    averageProcessingTime: number;
    activeJobs: number;
    lastProcessedAt?: number;
    filesCleanedUp: number;
    totalVideosDuration: number;
    averageVideoSize: number;
}
interface VideoHealthStatus {
    status: 'healthy' | 'degraded' | 'unhealthy';
    uptime: number;
    stats: VideoWorkerStats;
    memoryUsage: NodeJS.MemoryUsage;
    queueHealth: {
        waiting: number;
        active: number;
        completed: number;
        failed: number;
    };
}
declare class VideoWorker extends EventEmitter {
    private worker;
    private stats;
    private isShuttingDown;
    private healthCheckInterval?;
    private cleanupInterval?;
    private cleanupQueue;
    private processedFiles;
    constructor();
    /**
     * Main job processing function
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
     * Process video job - SIMPLIFIED for crop and watermark only
     */
    private processVideoJob;
    /**
     * Generate output filename
     */
    private generateOutputFilename;
    /**
     * Schedule file for cleanup
     */
    private scheduleFileForCleanup;
    /**
     * Setup simple cleanup worker
     */
    private setupSimpleCleanup;
    /**
     * Process cleanup queue
     */
    private processCleanupQueue;
    /**
     * Validate job data - simplified for video operations
     */
    private validateJobData;
    /**
     * Check if error is recoverable
     */
    private isRecoverableError;
    /**
     * Get job status
     */
    getJobStatus(jobId: string): Promise<VideoJobStatusResponse | null>;
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
    getHealthStatus(): Promise<VideoHealthStatus>;
    /**
     * Start the worker
     */
    start(): Promise<void>;
    /**
     * Stop the worker
     */
    stop(): Promise<void>;
    getStats(): VideoWorkerStats;
}
export declare const videoWorker: VideoWorker;
export type { VideoOperations, VideoJobStatusResponse };
export { VideoWorker };
