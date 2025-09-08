import { Worker, Job, UnrecoverableError } from 'bullmq';
import { videoQueue, VideoJobPayload, VideoJobType, VideoOperations } from '../config/videobullmq';
import { redis } from '../config/redis';
import { VideoProcessor, VideoProcessingResult } from '../processors/VideoProcessor';
import { NODE_ENV, VIDEO_PROCESSING_QUEUE_NAME } from '../config/env';
import { VIDEO_CONFIG, VideoConfigUtils } from '../config/video.image.config';
import { VideoFileValidationService } from '../service/videovalidationservice';
import { AppError, ValidationError } from '../utils/error';
import logger from '../utils/logger';
import fs from 'fs/promises';
import path from 'path';
import { performance } from 'perf_hooks';
import { EventEmitter } from 'events';

// Job status interface for API responses
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

// Worker configuration
const WORKER_CONFIG = {
  concurrency: NODE_ENV === 'production' ? 2 : 1,
  maxStalledCount: 1,
  stalledInterval: 60000, // 60 seconds for video processing
  removeOnComplete: { 
    count: VIDEO_CONFIG.WORKER.QUEUE_LIMITS.MAX_COMPLETED_JOBS,
    age: VIDEO_CONFIG.WORKER.QUEUE_LIMITS.COMPLETED_JOB_AGE * 1000
  },
  removeOnFail: { 
    count: VIDEO_CONFIG.WORKER.QUEUE_LIMITS.MAX_FAILED_JOBS,
    age: VIDEO_CONFIG.WORKER.QUEUE_LIMITS.FAILED_JOB_AGE * 1000
  },
};

// Job processing statistics
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

// Health check interface
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

class VideoWorker extends EventEmitter {
  private worker: Worker;
  private stats: VideoWorkerStats;
  private isShuttingDown = false;
  private healthCheckInterval?: NodeJS.Timeout;
  private cleanupInterval?: NodeJS.Timeout;
  
  // Simple cleanup queue
  private cleanupQueue: Set<string> = new Set();
  private processedFiles: Map<string, { jobId: string; processedAt: number }> = new Map();

  constructor() {
    super();
    
    this.stats = {
      processed: 0,
      failed: 0,
      startTime: Date.now(),
      totalProcessingTime: 0,
      averageProcessingTime: 0,
      activeJobs: 0,
      filesCleanedUp: 0,
      totalVideosDuration: 0,
      averageVideoSize: 0,
    };

    this.worker = new Worker(
      VIDEO_PROCESSING_QUEUE_NAME,
      this.processJob.bind(this),
      {
        connection: redis,
        concurrency: WORKER_CONFIG.concurrency,
        removeOnComplete: WORKER_CONFIG.removeOnComplete,
        removeOnFail: WORKER_CONFIG.removeOnFail,
        maxStalledCount: WORKER_CONFIG.maxStalledCount,
        stalledInterval: WORKER_CONFIG.stalledInterval,
        autorun: true,
       
      }
    );

    this.setupEventHandlers();
    this.setupHealthCheck();
    this.setupSimpleCleanup();
  }

  /**
   * Main job processing function
   */
  private async processJob(job: Job<VideoJobPayload>): Promise<VideoProcessingResult> {
    const jobStartTime = performance.now();
    this.stats.activeJobs++;

    console.log('🎬 === VIDEO JOB PROCESSING START ===');
    console.log('🔍 Job ID:', job.id);
    console.log('📝 Job Name:', job.name);
    console.log('📁 File Path:', job.data.filePath);
    console.log('👤 Job Data:', {
      originalName: job.data.originalName,
      fileSize: `${Math.round(job.data.fileSize / 1024 / 1024)}MB`,
      mimeType: job.data.mimeType,
      operations: job.data.operations ? Object.keys(job.data.operations) : 'none'
    });
    console.log('===============================');

    try {
      console.log('🔄 [STEP 1] Validating input file exists...');
      await this.validateFileExists(job.data.filePath);
      console.log('✅ [STEP 1] File exists validation passed');

      console.log('🔄 [STEP 2] Logging job start...');
      logger.info('Processing video job started:', {
        jobId: job.id,
        jobType: job.name,
        filename: job.data.originalName,
        fileSize: `${Math.round(job.data.fileSize / 1024 / 1024)}MB`,
        operations: job.data.operations ? Object.keys(job.data.operations) : [],
        attempt: job.attemptsMade + 1,
      });
      console.log('✅ [STEP 2] Job logging completed');

      console.log('🔄 [STEP 3] Emitting job started event...');
      this.emit('jobStarted', { jobId: job.id, jobData: job.data });
      console.log('✅ [STEP 3] Event emitted');
      
      console.log('🔄 [STEP 4] Updating progress to 10%...');
      await this.updateProgress(job, 10);
      console.log('✅ [STEP 4] Progress updated');

      console.log('🔄 [STEP 5] Validating job data...');
      await this.validateJobData(job.data);
      console.log('✅ [STEP 5] Job data validation passed');

      console.log('🔄 [STEP 6] Updating progress to 30%...');
      await this.updateProgress(job, 30);
      console.log('✅ [STEP 6] Progress updated');

      console.log('🔄 [STEP 7] *** STARTING VIDEO PROCESSING ***');
      console.log('📊 Processing details:', {
        inputPath: job.data.filePath,
        operations: job.data.operations,
        fileSize: `${Math.round(job.data.fileSize / 1024 / 1024)}MB`,
        mimeType: job.data.mimeType
      });
      
      // Process the video
      const result = await this.processVideoJob(job);
      console.log('✅ [STEP 7] *** VIDEO PROCESSING COMPLETED ***');
      console.log('📄 Result:', {
        outputPath: result.outputPath,
        originalSize: `${Math.round(result.originalSize / 1024 / 1024)}MB`,
        processedSize: `${Math.round(result.processedSize / 1024 / 1024)}MB`,
        duration: result.duration,
        operations: result.operations
      });

      console.log('🔄 [STEP 8] Updating progress to 90%...');
      await this.updateProgress(job, 90);
      console.log('✅ [STEP 8] Progress updated');

      console.log('🔄 [STEP 9] Scheduling file cleanup...');
      this.scheduleFileForCleanup(job.data.filePath, job.id as string, 'job_completed');
      console.log('✅ [STEP 9] File scheduled for cleanup');

      console.log('🔄 [STEP 10] Final progress update to 100%...');
      await this.updateProgress(job, 100);
      console.log('✅ [STEP 10] Final progress updated');

      console.log('🔄 [STEP 11] Calculating final metrics...');
       const processingTime = performance.now() - jobStartTime;
       result.processingTime = processingTime;

       this.updateStats(processingTime,true, job.data.fileSize,result.duration || 0);
      console.log('✅ [STEP 11] Metrics calculated and stats updated');

      console.log('🎉 === VIDEO JOB COMPLETED SUCCESSFULLY ===');
      console.log('🆔 Job ID:', job.id);
      console.log('⏱️  Processing Time:', `${(processingTime / 1000).toFixed(2)}s`);
      console.log('📤 Output Path:', result.outputPath);
      console.log('📊 Final Stats:', {
        originalSize: `${Math.round(result.originalSize / 1024 / 1024)}MB`,
        processedSize: `${Math.round(result.processedSize / 1024 / 1024)}MB`,
        duration: result.duration ? `${result.duration}s` : 'unknown',
        compressionRatio: `${Math.round((1 - result.processedSize / result.originalSize) * 100)}%`,
        operations: result.operations
      });
      console.log('=================================');

      logger.info('Video job completed successfully:', {
        jobId: job.id,
        filename: job.data.originalName,
        outputPath: result.outputPath,
        processingTime: `${(processingTime / 1000).toFixed(2)}s`,
        duration: result.duration,
      });

      console.log('🔄 [STEP 12] Emitting completion event...');
      this.emit('jobCompleted', { jobId: job.id, result, processingTime });
      console.log('✅ [STEP 12] Completion event emitted');

      return result;

    } catch (error) {
      const processingTime = performance.now() - jobStartTime;
      this.updateStats(processingTime, false, job.data.fileSize, 0);
      
      console.log('💥 === VIDEO JOB FAILED ===');
      console.log('🆔 Job ID:', job.id);
      console.log('❌ Error:', error);
      console.log('🔍 Error Details:', {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : 'No stack trace',
        name: error instanceof Error ? error.name : 'Unknown'
      });
      console.log('🔄 Is Recoverable:', this.isRecoverableError(error));
      console.log('📊 Attempt Info:', {
        currentAttempt: job.attemptsMade + 1,
        maxAttempts: job.opts.attempts || 3
      });
      console.log('==================');
      
      const isRecoverable = this.isRecoverableError(error);
      const isFinalFailure = !isRecoverable || (job.attemptsMade + 1) >= (job.opts.attempts || 3);
      
      if (isFinalFailure) {
        console.log('🚨 Final failure - scheduling file cleanup');
        this.scheduleFileForCleanup(
          job.data.filePath, 
          job.id as string, 
          isRecoverable ? 'max_retries_exceeded' : 'unrecoverable_error'
        );
      } else {
        console.log('⚠️ Recoverable error - keeping file for retry');
      }
      
      logger.error('Video job processing failed:', {
        jobId: job.id,
        filename: job.data.originalName,
        error: error instanceof Error ? error.message : error,
        errorStack: error instanceof Error ? error.stack : undefined,
        isRecoverable,
        isFinalFailure,
        attempt: job.attemptsMade + 1,
        processingTime: `${(processingTime / 1000).toFixed(2)}s`
      });

      this.emit('jobFailed', { 
        jobId: job.id, 
        error, 
        isRecoverable, 
        isFinalFailure,
      });

      if (!isRecoverable) {
        throw new UnrecoverableError(
          error instanceof Error ? error.message : 'Unrecoverable video processing error'
        );
      }

      throw error;
    } finally {
      this.stats.activeJobs--;
      console.log('🔄 Video job finally block - active jobs decremented to:', this.stats.activeJobs);
    }
  }

  /**
   * Simple file validation
   */
  private async validateFileExists(filePath: string): Promise<void> {
    try {
      await fs.access(filePath);
      console.log('✅ Input video file exists:', filePath);
    } catch (error) {
      console.error('❌ Input video file missing:', filePath);
      throw new UnrecoverableError(`Input video file not found: ${filePath}`);
    }
  }

  /**
   * Safe progress update
   */
  private async updateProgress(job: Job<VideoJobPayload>, progress: number): Promise<void> {
    try {
      await job.updateProgress(progress);
      console.log(`✅ Progress updated to ${progress}%`);
    } catch (error) {
      console.warn(`⚠️ Failed to update progress to ${progress}%:`, error);
    }
  }

  /**
   * Process video job - SIMPLIFIED for crop and watermark only
   */
  private async processVideoJob(job: Job<VideoJobPayload>): Promise<VideoProcessingResult> {
    console.log('=== PROCESSING VIDEO JOB ===');
    console.log('Input Path:', job.data.filePath);
    console.log('Operations:', JSON.stringify(job.data.operations, null, 2));
    
    try {
      // Verify input file
      const inputStats = await fs.stat(job.data.filePath);
      console.log('✅ Input video file verified. Size:', `${Math.round(inputStats.size / 1024 / 1024)}MB`);

      const outputFormat = job.data.operations?.format || 'mp4';
      const outputDir = VIDEO_CONFIG.PROCESSED_VIDEO_DIR;
      
      // Ensure output directory exists
      await fs.mkdir(outputDir, { recursive: true });
      console.log('✅ Output directory ready:', outputDir);
      
      console.log('🔄 Calling VideoProcessor.processVideo...');
      
      const result = await VideoProcessor.processVideo({
        inputPath: job.data.filePath,
        outputDir,
        operations: job.data.operations,
        filename: this.generateOutputFilename(job.data.originalName, outputFormat),
        preserveMetadata: false,
        quality: job.data.operations?.quality,
      });
      
      console.log(`✅ VideoProcessor completed:`, result.outputPath);
      
      // Verify output file
      const outputStats = await fs.stat(result.outputPath);
      if (outputStats.size === 0) {
        throw new AppError('Processed video file is empty', 500, 'EMPTY_OUTPUT');
      }
      console.log('✅ Output video file verified. Size:', `${Math.round(outputStats.size / 1024 / 1024)}MB`);

      return result;
    } catch (error) {
      console.error('❌ Video processing failed:', error);
      
      // Handle specific error types
      if (error instanceof Error) {
        const errorMessage = error.message.toLowerCase();
        
        if (errorMessage.includes('input file is missing') || 
            errorMessage.includes('enoent')) {
          throw new UnrecoverableError('Input video file not found');
        }
        
        if (errorMessage.includes('unsupported video format') ||
            errorMessage.includes('invalid video') ||
            errorMessage.includes('codec not supported')) {
          throw new UnrecoverableError('Unsupported or invalid video format');
        }
        
        if (errorMessage.includes('video too large') ||
            errorMessage.includes('duration too long')) {
          throw new UnrecoverableError('Video too large or too long to process');
        }

        if (errorMessage.includes('ffmpeg') ||
            errorMessage.includes('encoding failed')) {
          // These might be recoverable
          throw error;
        }
      }
      
      throw error;
    }
  }

  /**
   * Generate output filename
   */
  private generateOutputFilename(originalName: string, format?: string): string {
    const parsed = path.parse(originalName);
    const timestamp = Date.now();
    const outputFormat = format || 'mp4';
    return `${parsed.name}_processed_${timestamp}.${outputFormat}`;
  }

  /**
   * Schedule file for cleanup
   */
  private scheduleFileForCleanup(filePath: string, jobId: string, reason: string): void {
    console.log(`🗑️ Scheduling video file for cleanup: ${filePath} (reason: ${reason})`);
    this.cleanupQueue.add(filePath);
  }

  /**
   * Setup simple cleanup worker
   */
  private setupSimpleCleanup(): void {
    console.log('🧹 Setting up video cleanup worker...');
    
    // Run cleanup every 60 seconds for videos
    this.cleanupInterval = setInterval(async () => {
      await this.processCleanupQueue();
    }, 60000);
  }

  /**
   * Process cleanup queue
   */
  private async processCleanupQueue(): Promise<void> {
    if (this.cleanupQueue.size === 0) return;

    console.log(`🧹 Processing video cleanup queue (${this.cleanupQueue.size} files)`);
    
    const filesToCleanup = Array.from(this.cleanupQueue);
    this.cleanupQueue.clear();

    for (const filePath of filesToCleanup) {
      try {
        await fs.access(filePath);
        await fs.unlink(filePath);
        console.log(`✅ Video file cleaned up: ${filePath}`);
        this.stats.filesCleanedUp++;
        
      } catch (error: any) {
        if (error.code === 'ENOENT') {
          console.log(`✅ Video file already deleted: ${filePath}`);
          this.stats.filesCleanedUp++;
        } else {
          console.error(`❌ Failed to cleanup video file ${filePath}:`, error);
          this.cleanupQueue.add(filePath);
        }
      }
    }
  }

  /**
   * Validate job data - simplified for video operations
   */
  private async validateJobData(data: VideoJobPayload): Promise<void> {
    try {
      await VideoFileValidationService.validateVideoFile({
        path: data.filePath,
        originalName: data.originalName,
        size: data.fileSize,
        mimeType: data.mimeType,
      });

      // Validate video-specific operations
      if (data.operations) {
        // Validate crop operation (video trimming)
        if (data.operations.crop) {
          const { startTime, endTime } = data.operations.crop;
          if (startTime < 0) {
            throw new ValidationError('Start time cannot be negative');
          }
          if (endTime <= startTime) {
            throw new ValidationError('End time must be greater than start time');
          }
          if (endTime - startTime > VIDEO_CONFIG.DURATION_LIMITS.MAX_DURATION) {
            throw new ValidationError('Trimmed duration exceeds maximum allowed duration');
          }
        }

        // Validate watermark operation
        if (data.operations.watermark) {
          const watermark = data.operations.watermark;
          
          if (watermark.type === 'text') {
            if (!watermark.text || watermark.text.trim().length === 0) {
              throw new ValidationError('Watermark text cannot be empty');
            }
            if (watermark.fontSize && (watermark.fontSize < 8 || watermark.fontSize > 200)) {
              throw new ValidationError('Font size must be between 8 and 200');
            }
          } else if (watermark.type === 'image') {
            if (!watermark.imagePath) {
              throw new ValidationError('Watermark image path is required');
            }
            // Could add file existence check here
          }
          
          if (watermark.opacity !== undefined && 
             (watermark.opacity < 0.1 || watermark.opacity > 1.0)) {
            throw new ValidationError('Watermark opacity must be between 0.1 and 1.0');
          }
        }

        // Validate quality
        if (data.operations.quality && 
           (data.operations.quality < 1 || data.operations.quality > 100)) {
          throw new ValidationError('Quality must be between 1 and 100');
        }

        // Validate format
        if (data.operations.format && 
           !VideoConfigUtils.isSupportedOutputFormat(data.operations.format)) {
          throw new ValidationError(`Unsupported output format: ${data.operations.format}`);
        }
      }
    } catch (error) {
      if (error instanceof ValidationError || error instanceof AppError) {
        throw new UnrecoverableError(error.message);
      }
      throw error;
    }
  }

  /**
   * Check if error is recoverable
   */
  private isRecoverableError(error: unknown): boolean {
    if (error instanceof UnrecoverableError || error instanceof ValidationError) {
      return false;
    }

    if (error instanceof Error) {
      const errorMessage = error.message.toLowerCase();
      
      // Unrecoverable errors
      if (errorMessage.includes('input file is missing') ||
          errorMessage.includes('enoent') ||
          errorMessage.includes('unsupported video format') ||
          errorMessage.includes('invalid video') ||
          errorMessage.includes('codec not supported') ||
          errorMessage.includes('video too large') ||
          errorMessage.includes('duration too long')) {
        return false;
      }
      
      // Recoverable errors
      if (errorMessage.includes('timeout') ||
          errorMessage.includes('connection') ||
          errorMessage.includes('memory') ||
          errorMessage.includes('ffmpeg') ||
          errorMessage.includes('temporary failure')) {
        return true;
      }
    }

    return true; // Default to recoverable for video processing
  }

  /**
   * Get job status
   */
  public async getJobStatus(jobId: string): Promise<VideoJobStatusResponse | null> {
    try {
      const job = await videoQueue.getJob(jobId);
      if (!job) return null;

      const jobState = await job.getState();
      const progress = job.progress;
      
      let status: VideoJobStatusResponse['status'] = 'waiting';
      
      switch (jobState) {
        case 'waiting':
        case 'delayed':
        case 'paused':
          status = jobState;
          break;
        case 'active':
          status = 'active';
          break;
        case 'completed':
          status = 'completed';
          break;
        case 'failed':
          status = 'failed';
          break;
        default:
          status = 'waiting';
      }

      const response: VideoJobStatusResponse = {
        status,
        progress: typeof progress === 'number' ? progress : undefined,
        data: job.data,
        createdAt: job.timestamp ? new Date(job.timestamp) : undefined,
        processedAt: job.processedOn ? new Date(job.processedOn) : undefined,
      };

      // Add result data for completed jobs
      if (status === 'completed' && job.returnvalue) {
        const result = job.returnvalue as VideoProcessingResult;
        response.result = result;
        response.outputPath = result.outputPath;
        response.originalFileName = job.data.originalName;
        response.processedFileName = path.basename(result.outputPath);
        response.fileSize = result.processedSize;
        response.processingTime = result.processingTime;
      }

      // Add error data for failed jobs
      if (status === 'failed' && job.failedReason) {
        response.error = job.failedReason;
        response.failedReason = typeof job.failedReason === 'string' 
          ? job.failedReason 
          : job.failedReason.message || 'Unknown error';
      }

      return response;
    } catch (error) {
      logger.error('Error getting video job status:', { jobId, error });
      throw error;
    }
  }

  /**
   * Update processing statistics
   */
  private updateStats(processingTime: number, successful: boolean, fileSize: number, duration: number): void {
    this.stats.totalProcessingTime += processingTime;
    this.stats.lastProcessedAt = Date.now();

    if (successful) {
      this.stats.processed++;
      this.stats.totalVideosDuration += duration;
      
      // Update average video size
      const totalFiles = this.stats.processed + this.stats.failed;
      this.stats.averageVideoSize = totalFiles > 0 
        ? (this.stats.averageVideoSize * (totalFiles - 1) + fileSize) / totalFiles
        : fileSize;
    } else {
      this.stats.failed++;
    }

    const totalJobs = this.stats.processed + this.stats.failed;
    this.stats.averageProcessingTime = totalJobs > 0 
      ? this.stats.totalProcessingTime / totalJobs 
      : 0;
  }

  /**
   * Setup event handlers
   */
  private setupEventHandlers(): void {
    this.worker.on('ready', () => {
      logger.info('Video worker ready:', {
        concurrency: WORKER_CONFIG.concurrency,
        environment: NODE_ENV,
      });
      this.emit('ready');
    });

    this.worker.on('error', (error) => {
      logger.error('Video worker error:', { error: error.message });
      this.emit('error', error);
    });

    this.worker.on('failed', (job, error) => {
      logger.error('Video worker job failed:', {
        jobId: job?.id,
        error: error.message,
      });
    });

    this.worker.on('stalled', (jobId) => {
      logger.warn('Video worker job stalled:', { jobId });
      this.emit('stalled', jobId);
    });
  }

  /**
   * Setup health check
   */
  private setupHealthCheck(): void {
    this.healthCheckInterval = setInterval(async () => {
      try {
        const health = await this.getHealthStatus();
        this.emit('healthCheck', health);
      } catch (error) {
        logger.debug('Video health check error:', { error });
      }
    }, 300000); // 5 minutes
  }

  /**
   * Get health status
   */
  async getHealthStatus(): Promise<VideoHealthStatus> {
    const uptime = Date.now() - this.stats.startTime;
    const memoryUsage = process.memoryUsage();
    
    let queueHealth = {
      waiting: 0,
      active: 0,
      completed: 0,
      failed: 0,
    };

    try {
      const jobCounts = await videoQueue.getJobCounts('waiting', 'active', 'completed', 'failed');
      queueHealth = {
        waiting: jobCounts.waiting || 0,
        active: jobCounts.active || 0,
        completed: jobCounts.completed || 0,
        failed: jobCounts.failed || 0,
      };
    } catch (error) {
      // Continue with defaults
    }

    return {
      status: 'healthy',
      uptime,
      stats: { ...this.stats },
      memoryUsage,
      queueHealth,
    };
  }

  /**
   * Start the worker
   */
  async start(): Promise<void> {
    if (this.isShuttingDown) {
      throw new Error('Cannot start video worker during shutdown');
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Video worker ready timeout'));
      }, 15000); // Longer timeout for video worker

      if (this.worker.isRunning()) {
        clearTimeout(timeout);
        logger.info('Video worker is already running');
        resolve();
        return;
      }

      this.worker.once('ready', () => {
        clearTimeout(timeout);
        logger.info('Video worker started successfully');
        resolve();
      });

      this.worker.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  /**
   * Stop the worker
   */
  async stop(): Promise<void> {
    this.isShuttingDown = true;
    
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    await this.worker.close();
    this.emit('shutdown');
  }

  getStats(): VideoWorkerStats {
    return { ...this.stats };
  }
}

export const videoWorker = new VideoWorker();
export type { VideoOperations, VideoJobStatusResponse };
export { VideoWorker };