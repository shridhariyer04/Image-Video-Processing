import { Worker, Job, UnrecoverableError } from 'bullmq';
import { imageQueue, ImageJobPayload, ImageJobType } from '../config/bullmq';
import { redis } from '../config/redis';
import { ImageProcessor, ProcessingResult } from '../processors/ImageProcessor';
import { NODE_ENV, PROCESSING_QUEUE_NAME } from '../config/env';
import { IMAGE_CONFIG, ImageConfigUtils } from '../config/image.config';
import { FileValidationService } from '../service/validationservice';
import { AppError, ValidationError } from '../utils/error';
import logger from '../utils/logger';
import fs from 'fs/promises';
import path from 'path';
import { performance } from 'perf_hooks';
import { EventEmitter } from 'events';

// Define ImageOperations interface
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
  sharpen?: number; // Standardized to number | undefined
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
    text?: string;
    image?: string;
    position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';
    opacity?: number;
  };
}

// Job status interface for API responses
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

// Worker configuration using centralized config
const WORKER_CONFIG = {
  concurrency: NODE_ENV === 'production' 
    ? IMAGE_CONFIG.WORKER.CONCURRENCY.PRODUCTION 
    : IMAGE_CONFIG.WORKER.CONCURRENCY.DEVELOPMENT,
  maxStalledCount: 1,
  stalledInterval: IMAGE_CONFIG.WORKER.TIMEOUTS.STALLED_INTERVAL,
  removeOnComplete: { 
    count: IMAGE_CONFIG.WORKER.QUEUE_LIMITS.MAX_COMPLETED_JOBS, 
    age: IMAGE_CONFIG.WORKER.QUEUE_LIMITS.COMPLETED_JOB_AGE 
  },
  removeOnFail: { 
    count: IMAGE_CONFIG.WORKER.QUEUE_LIMITS.MAX_FAILED_JOBS, 
    age: IMAGE_CONFIG.WORKER.QUEUE_LIMITS.FAILED_JOB_AGE 
  },
};

// Job processing statistics
interface WorkerStats {
  processed: number;
  failed: number;
  startTime: number;
  totalProcessingTime: number;
  averageProcessingTime: number;
  activeJobs: number;
  lastProcessedAt?: number;
}

// Health check interface
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
    stalled: number;
  };
}

class ImageWorker extends EventEmitter {
  private worker: Worker;
  private stats: WorkerStats;
  private isShuttingDown = false;
  private healthCheckInterval?: NodeJS.Timeout;
  private cleanupInterval?: NodeJS.Timeout;

  constructor() {
    super();
    
    this.stats = {
      processed: 0,
      failed: 0,
      startTime: Date.now(),
      totalProcessingTime: 0,
      averageProcessingTime: 0,
      activeJobs: 0,
    };

    this.worker = new Worker(
      PROCESSING_QUEUE_NAME,
      this.processJob.bind(this),
      {
        connection: redis,
        concurrency: WORKER_CONFIG.concurrency,
        removeOnComplete: WORKER_CONFIG.removeOnComplete,
        removeOnFail: WORKER_CONFIG.removeOnFail,
        maxStalledCount: WORKER_CONFIG.maxStalledCount,
        stalledInterval: WORKER_CONFIG.stalledInterval,
        autorun: false,
      }
    );

    this.setupEventHandlers();
    this.setupHealthCheck();
    this.setupCleanupScheduler();
  }

  /**
   * Get job status by job ID - NEW METHOD
   */
  public async getJobStatus(jobId: string): Promise<JobStatusResponse | null> {
    try {
      const job = await imageQueue.getJob(jobId);
      
      if (!job) {
        return null;
      }

      const jobState = await job.getState();
      const progress = job.progress;
      
      let status: JobStatusResponse['status'] = 'waiting';
      
      // Map BullMQ states to our API states
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

      const response: JobStatusResponse = {
        status,
        progress: typeof progress === 'number' ? progress : undefined,
        data: job.data,
        createdAt: job.timestamp ? new Date(job.timestamp) : undefined,
        processedAt: job.processedOn ? new Date(job.processedOn) : undefined,
      };

      // Add result data for completed jobs
      if (status === 'completed' && job.returnvalue) {
        const result = job.returnvalue as ProcessingResult;
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
      logger.error('Error getting job status:', {
        jobId,
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    }
  }

  /**
   * Get multiple job statuses - NEW METHOD
   */
  public async getJobStatuses(jobIds: string[]): Promise<{ [jobId: string]: JobStatusResponse | null }> {
    const results: { [jobId: string]: JobStatusResponse | null } = {};
    
    await Promise.all(
      jobIds.map(async (jobId) => {
        try {
          results[jobId] = await this.getJobStatus(jobId);
        } catch (error) {
          logger.error(`Error getting status for job ${jobId}:`, error);
          results[jobId] = null;
        }
      })
    );

    return results;
  }

  /**
   * Check if processed file exists - NEW METHOD
   */
  public async checkProcessedFile(jobId: string): Promise<{ exists: boolean; filePath?: string; fileSize?: number }> {
    try {
      const jobStatus = await this.getJobStatus(jobId);
      
      if (!jobStatus || jobStatus.status !== 'completed' || !jobStatus.outputPath) {
        return { exists: false };
      }

      const filePath = path.resolve(jobStatus.outputPath);
      
      try {
        const stats = await fs.stat(filePath);
        return {
          exists: true,
          filePath,
          fileSize: stats.size,
        };
      } catch (error: any) {
        if (error.code === 'ENOENT') {
          return { exists: false };
        }
        throw error;
      }
    } catch (error) {
      logger.error('Error checking processed file:', {
        jobId,
        error: error instanceof Error ? error.message : error,
      });
      return { exists: false };
    }
  }

  public async testOperations(operation: any): Promise<any> {
    console.log('Testing operations:', JSON.stringify(operation, null, 2));
    const testResult = await ImageProcessor.processImage({
      inputPath: "C:/Users/Shridhar/OneDrive/Pictures/Screenshots/email.png",
      outputDir: IMAGE_CONFIG.PROCESSED_DIR,
      operations: operation,
      filename: 'test_output.png'
    });
    console.log('Direct processor result:', testResult);
    return testResult;
  }

  /**
   * Main job processing function
   */
  private async processJob(job: Job<ImageJobPayload>): Promise<ProcessingResult> {
    const jobStartTime = performance.now();
    this.stats.activeJobs++;

    console.log('=== WORKER PROCESSING DEBUG ===');
    console.log('Job ID:', job.id);
    console.log('Job data:', JSON.stringify(job.data, null, 2));
    console.log('Operations received in worker:', JSON.stringify(job.data.operations, null, 2));
    console.log('Has operations?', !!job.data.operations);
    console.log('Operations keys:', job.data.operations ? Object.keys(job.data.operations) : 'none');
    
    try {
      logger.info('Processing image job started:', {
        jobId: job.id,
        jobType: job.name,
        filename: job.data.originalName,
        fileSize: `${Math.round(job.data.fileSize / 1024)}KB`,
        operations: job.data.operations ? Object.keys(job.data.operations) : [],
        attempt: job.attemptsMade + 1,
        maxAttempts: job.opts.attempts,
        userId: job.data.userId,
        priority: job.opts.priority,
        estimatedTime: ImageConfigUtils.estimateProcessingTime(job.data.fileSize, job.data.operations),
      });

      this.emit('jobStarted', { jobId: job.id, jobData: job.data });
      await job.updateProgress(10);

      // Validate job data and operations using centralized validation
      await this.validateJobData(job.data);
      await job.updateProgress(30);

      // Process based on job type
      let result: ProcessingResult;
      
      switch (job.name) {
        case ImageJobType.PROCESS_IMAGE:
          result = await this.processImageJob(job);
          break;
        case ImageJobType.BULK_PROCESS:
          result = await this.processBulkJob(job);
          break;
        case ImageJobType.CLEANUP_TEMP:
          result = await this.processCleanupJob(job);
          break;
        default:
          throw new UnrecoverableError(`Unknown job type: ${job.name}`);
      }

      await job.updateProgress(90);

      // Clean up input file after successful processing
      if (job.name !== ImageJobType.CLEANUP_TEMP) {
        await this.cleanupInputFile(job.data.filePath);
      }
      await job.updateProgress(100);

      const processingTime = performance.now() - jobStartTime;
      result.processingTime = processingTime; // Add processing time to result
      this.updateStats(processingTime, true);

      logger.info('Image job completed successfully:', {
        jobId: job.id,
        jobType: job.name,
        filename: job.data.originalName,
        outputPath: result.outputPath,
        originalSize: `${Math.round(result.originalSize / 1024)}KB`,
        processedSize: `${Math.round(result.processedSize / 1024)}KB`,
        compressionRatio: `${Math.round((1 - result.processedSize / result.originalSize) * 100)}%`,
        processingTime: `${processingTime.toFixed(2)}ms`,
        operations: result.operations,
        dimensions: `${result.width}x${result.height}`,
        userId: job.data.userId,
      });

      this.emit('jobCompleted', { jobId: job.id, result, processingTime });
      return result;

    } catch (error) {
      const processingTime = performance.now() - jobStartTime;
      this.updateStats(processingTime, false);
      
      const isRecoverable = this.isRecoverableError(error);
      
      logger.error('Image job processing failed:', {
        jobId: job.id,
        jobType: job.name,
        filename: job.data.originalName,
        error: error instanceof Error ? error.message : error,
        errorCode: error instanceof AppError ? error.code : undefined,
        stack: error instanceof Error ? error.stack : undefined,
        isRecoverable,
        attempt: job.attemptsMade + 1,
        maxAttempts: job.opts.attempts,
        processingTime: `${processingTime.toFixed(2)}ms`,
        userId: job.data.userId,
      });

      this.emit('jobFailed', { 
        jobId: job.id, 
        error, 
        isRecoverable, 
        attempt: job.attemptsMade + 1,
        processingTime 
      });

      // Clean up input file even on failure
      try {
        if (job.name !== ImageJobType.CLEANUP_TEMP) {
          await this.cleanupInputFile(job.data.filePath);
        }
      } catch (cleanupError) {
        logger.warn('Failed to cleanup input file after job failure:', {
          jobId: job.id,
          filePath: job.data.filePath,
          cleanupError,
        });
      }

      if (!isRecoverable) {
        throw new UnrecoverableError(
          error instanceof Error ? error.message : 'Unrecoverable processing error'
        );
      }

      throw error;
    } finally {
      this.stats.activeJobs--;
    }
  }

  /**
   * Validate job data using centralized validation service
   */
  private async validateJobData(data: ImageJobPayload): Promise<void> {
    try {
      // Use centralized validation service
      await FileValidationService.validateFile({
        path: data.filePath,
        originalName: data.originalName,
        size: data.fileSize,
        mimeType: data.mimeType,
      });

      // Check if validateImageOperations method exists
      if (data.operations) {
        if ('validateImageOperations' in FileValidationService && 
            typeof FileValidationService.validateImageOperations === 'function') {
          await FileValidationService.validateImageOperations(data.operations, {
            fileSize: data.fileSize,
            mimeType: data.mimeType,
            filename: data.originalName,
          });
        } else {
          // Fallback validation if method doesn't exist
          await this.validateImageOperationsLocal(data.operations, data);
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
   * Local fallback validation for image operations
   */
  private async validateImageOperationsLocal(operations: ImageOperations, data: ImageJobPayload): Promise<void> {
    // Basic validation logic
    if (operations.resize) {
      if (operations.resize.width && (operations.resize.width < 1 || operations.resize.width > 10000)) {
        throw new ValidationError('Invalid resize width');
      }
      if (operations.resize.height && (operations.resize.height < 1 || operations.resize.height > 10000)) {
        throw new ValidationError('Invalid resize height');
      }
    }

    if (operations.quality && (operations.quality < 1 || operations.quality > 100)) {
      throw new ValidationError('Quality must be between 1 and 100');
    }

    if (operations.blur && (operations.blur < 0 || operations.blur > 1000)) {
      throw new ValidationError('Invalid blur value');
    }

    if (operations.rotate && (operations.rotate < -360 || operations.rotate > 360)) {
      throw new ValidationError('Invalid rotation angle');
    }

    if (operations.sharpen && (operations.sharpen < 0 || operations.sharpen > 100)) {
      throw new ValidationError('Invalid sharpen value');
    }

    // Validate format if specified
    if (operations.format) {
      const supportedFormats = ['jpeg', 'png', 'webp', 'avif', 'tiff', 'gif'];
      if (!supportedFormats.includes(operations.format)) {
        throw new ValidationError(`Unsupported format: ${operations.format}`);
      }
    }
  }

  /**
   * Process single image job
   */
  private async processImageJob(job: Job<ImageJobPayload>): Promise<ProcessingResult> {
    logger.debug('Starting single image processing...', {
      jobId: job.id,
      inputPath: job.data.filePath,
      operations: job.data.operations,
    });

    // Add debug logging to see what operations are being passed
    console.log('=== WORKER DEBUG ===');
    console.log('Job data operations:', JSON.stringify(job.data.operations, null, 2));
    console.log('Operations type:', typeof job.data.operations);

    const outputFormat = job.data.operations?.format || IMAGE_CONFIG.DEFAULTS.OUTPUT_FORMAT;
    
    const result = await ImageProcessor.processImage({
      inputPath: job.data.filePath,
      outputDir: IMAGE_CONFIG.PROCESSED_DIR,
      operations: job.data.operations,
      filename: this.generateOutputFilename(job.data.originalName, outputFormat),
      preserveMetadata: false,
      quality: job.data.operations?.quality,
    });

    return result;
  }

  /**
   * Process bulk image job
   */
  private async processBulkJob(job: Job<ImageJobPayload>): Promise<ProcessingResult> {
    logger.debug('Starting bulk image processing...', {
      jobId: job.id,
      inputPath: job.data.filePath,
    });

    return this.processImageJob(job);
  }

  /**
   * Process cleanup job
   */
  private async processCleanupJob(job: Job<ImageJobPayload>): Promise<ProcessingResult> {
    logger.debug('Starting cleanup job...', {
      jobId: job.id,
      targetPath: job.data.filePath,
    });

    try {
      await fs.unlink(job.data.filePath);
      
      return {
        outputPath: job.data.filePath,
        originalSize: job.data.fileSize,
        processedSize: 0,
        format: 'cleanup',
        width: 0,
        height: 0,
        processingTime: 0,
        operations: ['cleanup'],
        metadata: {
          hasAlpha: false,
          channels: 0,
          colorspace: 'unknown',
        },
      };
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        logger.debug('Cleanup target file already deleted:', {
          jobId: job.id,
          filePath: job.data.filePath,
        });
        
        return {
          outputPath: job.data.filePath,
          originalSize: job.data.fileSize,
          processedSize: 0,
          format: 'cleanup',
          width: 0,
          height: 0,
          processingTime: 0,
          operations: ['cleanup:already_deleted'],
          metadata: {
            hasAlpha: false,
            channels: 0,
            colorspace: 'unknown',
          },
        };
      }
      
      throw error;
    }
  }

  /**
   * Clean up input file after processing
   */
  private async cleanupInputFile(filePath: string): Promise<void> {
    try {
      await fs.unlink(filePath);
      logger.debug('Input file cleaned up:', { filePath });
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        logger.warn('Failed to cleanup input file:', {
          filePath,
          error: error.message,
        });
      }
    }
  }

  /**
   * Generate output filename with proper extension
   */
  private generateOutputFilename(originalName: string, format?: string): string {
    const parsed = path.parse(originalName);
    const timestamp = Date.now();
    const outputFormat = format || IMAGE_CONFIG.DEFAULTS.OUTPUT_FORMAT;
    
    return `${parsed.name}_processed_${timestamp}.${outputFormat}`;
  }

  /**
   * Determine if an error is recoverable using centralized logic
   */
  private isRecoverableError(error: unknown): boolean {
    if (error instanceof UnrecoverableError || error instanceof ValidationError) {
      return false;
    }

    if (error instanceof AppError) {
      const nonRecoverableCodes = [
        'INVALID_FILE_TYPE',
        'FILE_TOO_LARGE',
        'INVALID_OPERATIONS',
        'MALICIOUS_CONTENT'
      ];
      return !nonRecoverableCodes.includes(error.code);
    }

    if (error instanceof Error) {
      const recoverableErrorCodes = [
        'EMFILE',    // Too many open files
        'ENFILE',    // File table overflow
        'ENOSPC',    // No space left on device
        'ECONNRESET', // Connection reset
        'ETIMEDOUT', // Timeout
        'ENOTFOUND', // DNS lookup failed
        'ECONNREFUSED', // Connection refused
      ];

      const errorCode = (error as any).code;
      if (recoverableErrorCodes.includes(errorCode)) {
        return true;
      }

      const recoverableMessages = [
        'out of memory',
        'memory allocation',
        'insufficient memory',
        'timeout',
        'connection',
        'network',
      ];

      const errorMessage = error.message.toLowerCase();
      return recoverableMessages.some(msg => errorMessage.includes(msg));
    }

    return true;
  }

  /**
   * Update processing statistics
   */
  private updateStats(processingTime: number, successful: boolean): void {
    this.stats.totalProcessingTime += processingTime;
    this.stats.lastProcessedAt = Date.now();

    if (successful) {
      this.stats.processed++;
    } else {
      this.stats.failed++;
    }

    const totalJobs = this.stats.processed + this.stats.failed;
    this.stats.averageProcessingTime = totalJobs > 0 
      ? this.stats.totalProcessingTime / totalJobs 
      : 0;
  }

  /**
   * Setup event handlers for the worker
   */
  private setupEventHandlers(): void {
    this.worker.on('ready', () => {
      logger.info('Image worker ready:', {
        concurrency: WORKER_CONFIG.concurrency,
        environment: NODE_ENV,
      });
      this.emit('ready');
    });

    this.worker.on('error', (error) => {
      logger.error('Worker error:', {
        error: error.message,
        stack: error.stack,
      });
      this.emit('error', error);
    });

    this.worker.on('failed', (job, error) => {
      logger.error('Worker job failed:', {
        jobId: job?.id,
        jobType: job?.name,
        error: error.message,
        attempts: job?.attemptsMade,
        maxAttempts: job?.opts.attempts,
      });
    });

    this.worker.on('stalled', (jobId) => {
      logger.warn('Worker job stalled:', { jobId });
      this.emit('stalled', jobId);
    });
  }

  /**
   * Setup health check monitoring
   */
  private setupHealthCheck(): void {
    const startupGracePeriod = 120000; // 2 minutes
    const healthCheckInterval = 300000; // 5 minutes between checks
    
    setTimeout(() => {
      this.healthCheckInterval = setInterval(async () => {
        try {
          const health = await this.getHealthStatus();
          
          if (health.status === 'unhealthy') {
            logger.warn('Worker health degraded (non-critical):', {
              status: health.status,
              memoryUsage: health.memoryUsage,
              queueHealth: health.queueHealth,
              stats: health.stats
            });
            this.emit('healthWarning', health);
          } else {
            logger.debug('Worker health check passed:', { status: health.status });
          }
          
          this.emit('healthCheck', health);
        } catch (error) {
          logger.debug('Health check error (non-critical):', {
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }, healthCheckInterval);
    }, startupGracePeriod);
  }

  /**
   * Setup cleanup scheduler for processed files
   */
  private setupCleanupScheduler(): void {
    this.cleanupInterval = setInterval(async () => {
      try {
        const deletedCount = await ImageProcessor.cleanupOldFiles(IMAGE_CONFIG.CLEANUP.MAX_AGE_HOURS);
        if (deletedCount > 0) {
          logger.info('Scheduled cleanup completed:', { deletedFiles: deletedCount });
        }
      } catch (error) {
        logger.error('Scheduled cleanup error:', error);
      }
    }, IMAGE_CONFIG.CLEANUP.CLEANUP_INTERVAL);
  }

  /**
   * Get worker health status
   */
  async getHealthStatus(): Promise<HealthStatus> {
    const uptime = Date.now() - this.stats.startTime;
    const memoryUsage = process.memoryUsage();
    
    const CRITICAL_MEMORY_RATIO = 0.99;
    const HIGH_MEMORY_RATIO = 0.95;
    const MAX_WAITING = 1000;
    
    let queueHealth = {
      waiting: 0,
      active: 0,
      completed: 0,
      failed: 0,
      stalled: 0,
    };

    try {
      const jobCounts = await imageQueue.getJobCounts('waiting', 'active', 'completed', 'failed');
      queueHealth = {
        waiting: jobCounts.waiting || 0,
        active: jobCounts.active || 0,
        completed: jobCounts.completed || 0,
        failed: jobCounts.failed || 0,
        stalled: jobCounts.stalled || 0,
      };
    } catch (queueError) {
      // Silently continue with defaults
    }

    try {
      let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
      
      const totalProcessed = this.stats.processed + this.stats.failed;
      const failureRate = totalProcessed > 0 ? this.stats.failed / totalProcessed : 0;
      const memoryUsageMB = memoryUsage.rss / (1024 * 1024);
      const heapRatio = memoryUsage.heapUsed / memoryUsage.heapTotal;

      if (heapRatio > CRITICAL_MEMORY_RATIO && memoryUsageMB > 2048) {
        status = 'unhealthy';
      } else if (queueHealth.waiting > MAX_WAITING) {
        status = 'unhealthy';
      } else if (failureRate > 0.95 && totalProcessed > 10) {
        status = 'unhealthy';
      } else if (heapRatio > HIGH_MEMORY_RATIO) {
        status = 'degraded';
      } else if (queueHealth.waiting > MAX_WAITING / 2) {
        status = 'degraded';
      } else if (failureRate > 0.8 && totalProcessed > 5) {
        status = 'degraded';
      }

      const healthStatus = {
        status,
        uptime,
        stats: { ...this.stats },
        memoryUsage,
        queueHealth,
      };

      return healthStatus;

    } catch (statusError) {
      return {
        status: 'healthy',
        uptime,
        stats: { ...this.stats },
        memoryUsage,
        queueHealth,
      };
    }
  }

  /**
   * Start the worker
   */
  async start(): Promise<void> {
    if (this.isShuttingDown) {
      throw new Error('Cannot start worker during shutdown');
    }

    try {
      await this.worker.run();
      logger.info('Image worker started successfully');
    } catch (error) {
      logger.error('Failed to start image worker:', error);
      throw error;
    }
  }

  /**
   * Stop the worker gracefully
   */
  async stop(): Promise<void> {
    await this.gracefulShutdown();
  }

  /**
   * Graceful shutdown process
   */
  private async gracefulShutdown(): Promise<void> {
    if (this.isShuttingDown) {
      return;
    }

    this.isShuttingDown = true;
    logger.info('Starting graceful shutdown of image worker...');

    try {
      if (this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval);
      }
      
      if (this.cleanupInterval) {
        clearInterval(this.cleanupInterval);
      }

      await this.worker.close();
      
      logger.info('Image worker shutdown completed successfully');
      this.emit('shutdown');
      
    } catch (error) {
      logger.error('Error during worker shutdown:', error);
      this.emit('shutdownError', error);
      throw error;
    }
  }

  async close(): Promise<void> {
    return this.gracefulShutdown();
  }

  getStats(): WorkerStats {
    return { ...this.stats };
  }

  resetStats(): void {
    this.stats = {
      processed: 0,
      failed: 0,
      startTime: Date.now(),
      totalProcessingTime: 0,
      averageProcessingTime: 0,
      activeJobs: 0,
    };
  }
}

export const imageWorker = new ImageWorker();
export type { ImageOperations, JobStatusResponse };
export { ImageWorker };

if (require.main === module) {
  imageWorker.start().catch((error) => {
    logger.error('Failed to start image worker:', error);
    process.exit(1);
  });
}