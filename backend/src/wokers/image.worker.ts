import { Worker, Job, UnrecoverableError } from 'bullmq';
import { imageQueue, ImageJobPayload, ImageJobType, watermark } from '../config/bullmq';
import { redis } from '../config/redis';
import { ImageProcessor, ProcessingResult } from '../processors/ImageProcessor';
import { NODE_ENV, PROCESSING_QUEUE_NAME } from '../config/env';
import { IMAGE_CONFIG } from '../config/image.config';
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

// Worker configuration
const WORKER_CONFIG = {
  concurrency: NODE_ENV === 'production' ? 2 : 1,
  maxStalledCount: 1,
  stalledInterval: 30000,
  removeOnComplete: { 
    count: 100, 
    age: 24 * 60 * 60 * 1000 // 24 hours
  },
  removeOnFail: { 
    count: 50, 
    age: 7 * 24 * 60 * 60 * 1000 // 7 days
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
  filesCleanedUp: number;
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
  };
}

// Simple cleanup tracking
interface CleanupFile {
  filePath: string;
  scheduledAt: number;
  jobId: string;
  reason: string;
}

class ImageWorker extends EventEmitter {
  private worker: Worker;
  private stats: WorkerStats;
  private isShuttingDown = false;
  private healthCheckInterval?: NodeJS.Timeout;
  private cleanupInterval?: NodeJS.Timeout;
  
  // Simple cleanup queue - no complex reference counting
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
        autorun: true,
      }
    );

    this.setupEventHandlers();
    this.setupHealthCheck();
    this.setupSimpleCleanup();
  }

  /**
   * Main job processing function - SIMPLIFIED
   */

private async processJob(job: Job<ImageJobPayload>): Promise<ProcessingResult> {
  const jobStartTime = performance.now();
  this.stats.activeJobs++;

  console.log('🚀 === JOB PROCESSING START ===');
  console.log('🔍 Job ID:', job.id);
  console.log('📝 Job Name:', job.name);
  console.log('📁 File Path:', job.data.filePath);
  console.log('👤 Job Data:', {
    originalName: job.data.originalName,
    fileSize: job.data.fileSize,
    mimeType: job.data.mimeType,
    operations: job.data.operations ? Object.keys(job.data.operations) : 'none'
  });
  console.log('===============================');

  try {
    console.log('🔄 [STEP 1] Validating input file exists...');
    // Validate input file exists
    await this.validateFileExists(job.data.filePath);
    console.log('✅ [STEP 1] File exists validation passed');

    console.log('🔄 [STEP 2] Logging job start...');
    logger.info('Processing image job started:', {
      jobId: job.id,
      jobType: job.name,
      filename: job.data.originalName,
      fileSize: `${Math.round(job.data.fileSize / 1024)}KB`,
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
    // Validate job data
    await this.validateJobData(job.data);
    console.log('✅ [STEP 5] Job data validation passed');

    console.log('🔄 [STEP 6] Updating progress to 30%...');
    await this.updateProgress(job, 30);
    console.log('✅ [STEP 6] Progress updated');

    console.log('🔄 [STEP 7] *** STARTING IMAGE PROCESSING ***');
    console.log('📊 Processing details:', {
      inputPath: job.data.filePath,
      operations: job.data.operations,
      fileSize: job.data.fileSize,
      mimeType: job.data.mimeType
    });
    
    // Process the image
    const result = await this.processImageJob(job);
    console.log('✅ [STEP 7] *** IMAGE PROCESSING COMPLETED ***');
    console.log('📄 Result:', {
      outputPath: result.outputPath,
      originalSize: result.originalSize,
      processedSize: result.processedSize,
      operations: result.operations
    });

    console.log('🔄 [STEP 8] Updating progress to 90%...');
    await this.updateProgress(job, 90);
    console.log('✅ [STEP 8] Progress updated');

    console.log('🔄 [STEP 9] Scheduling file cleanup...');
    // Schedule original file for cleanup AFTER successful processing
    this.scheduleFileForCleanup(job.data.filePath, job.id as string, 'job_completed');
    console.log('✅ [STEP 9] File scheduled for cleanup');

    console.log('🔄 [STEP 10] Final progress update to 100%...');
    await this.updateProgress(job, 100);
    console.log('✅ [STEP 10] Final progress updated');

    console.log('🔄 [STEP 11] Calculating final metrics...');
    const processingTime = performance.now() - jobStartTime;
    result.processingTime = processingTime;
    this.updateStats(processingTime, true);

    // Track processed file
    this.processedFiles.set(job.data.filePath, {
      jobId: job.id as string,
      processedAt: Date.now()
    });
    console.log('✅ [STEP 11] Metrics calculated and stats updated');

    console.log('🎉 === JOB COMPLETED SUCCESSFULLY ===');
    console.log('🆔 Job ID:', job.id);
    console.log('⏱️  Processing Time:', `${processingTime.toFixed(2)}ms`);
    console.log('📤 Output Path:', result.outputPath);
    console.log('📊 Final Stats:', {
      originalSize: `${Math.round(result.originalSize / 1024)}KB`,
      processedSize: `${Math.round(result.processedSize / 1024)}KB`,
      compressionRatio: `${Math.round((1 - result.processedSize / result.originalSize) * 100)}%`,
      operations: result.operations
    });
    console.log('=================================');

    logger.info('Image job completed successfully:', {
      jobId: job.id,
      filename: job.data.originalName,
      outputPath: result.outputPath,
      processingTime: `${processingTime.toFixed(2)}ms`,
    });

    console.log('🔄 [STEP 12] Emitting completion event...');
    this.emit('jobCompleted', { jobId: job.id, result, processingTime });
    console.log('✅ [STEP 12] Completion event emitted');

    return result;

  } catch (error) {
    const processingTime = performance.now() - jobStartTime;
    this.updateStats(processingTime, false);
    
    console.log('💥 === JOB FAILED ===');
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
    
    // Only schedule cleanup on final failure
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
    
    logger.error('Image job processing failed:', {
      jobId: job.id,
      filename: job.data.originalName,
      error: error instanceof Error ? error.message : error,
      errorStack: error instanceof Error ? error.stack : undefined,
      isRecoverable,
      isFinalFailure,
      attempt: job.attemptsMade + 1,
      processingTime: `${processingTime.toFixed(2)}ms`
    });

    this.emit('jobFailed', { 
      jobId: job.id, 
      error, 
      isRecoverable, 
      isFinalFailure,
    });

    if (!isRecoverable) {
      throw new UnrecoverableError(
        error instanceof Error ? error.message : 'Unrecoverable processing error'
      );
    }

    throw error;
  } finally {
    this.stats.activeJobs--;
    console.log('🔄 Job finally block - active jobs decremented to:', this.stats.activeJobs);
  }
}

  /**
   * Simple file validation
   */
  private async validateFileExists(filePath: string): Promise<void> {
    try {
      await fs.access(filePath);
      console.log('✅ Input file exists:', filePath);
    } catch (error) {
      console.error('❌ Input file missing:', filePath);
      throw new UnrecoverableError(`Input file not found: ${filePath}`);
    }
  }

  /**
   * Safe progress update
   */
  private async updateProgress(job: Job<ImageJobPayload>, progress: number): Promise<void> {
    try {
      await job.updateProgress(progress);
      console.log(`✅ Progress updated to ${progress}%`);
    } catch (error) {
      console.warn(`⚠️ Failed to update progress to ${progress}%:`, error);
    }
  }

  /**
   * Process image job - SIMPLIFIED
   */
  private async processImageJob(job: Job<ImageJobPayload>): Promise<ProcessingResult> {
    console.log('=== PROCESSING IMAGE JOB ===');
    console.log('Input Path:', job.data.filePath);
    console.log('Operations:', JSON.stringify(job.data.operations, null, 2));
    
    try {
      // Verify input file
      const inputStats = await fs.stat(job.data.filePath);
      console.log('✅ Input file verified. Size:', inputStats.size, 'bytes');

      const outputFormat = job.data.operations?.format || 'jpeg';
      const outputDir = IMAGE_CONFIG.PROCESSED_DIR;
      
      // Ensure output directory exists
      await fs.mkdir(outputDir, { recursive: true });
      console.log('✅ Output directory ready:', outputDir);
      
      console.log('🔄 Calling ImageProcessor.processImage...');
      
      const result = await ImageProcessor.processImage({
        inputPath: job.data.filePath,
        outputDir,
        operations: job.data.operations,
        filename: this.generateOutputFilename(job.data.originalName, outputFormat),
        preserveMetadata: false,
        quality: job.data.operations?.quality,
      });
      
      console.log(`✅ ImageProcessor completed:`, result.outputPath);
      
      // Verify output file
      const outputStats = await fs.stat(result.outputPath);
      if (outputStats.size === 0) {
        throw new AppError('Processed file is empty', 500, 'EMPTY_OUTPUT');
      }
      console.log('✅ Output file verified. Size:', outputStats.size, 'bytes');

      return result;
    } catch (error) {
      console.error('❌ Image processing failed:', error);
      
      // Handle specific error types
      if (error instanceof Error) {
        const errorMessage = error.message.toLowerCase();
        
        if (errorMessage.includes('input file is missing') || 
            errorMessage.includes('enoent')) {
          throw new UnrecoverableError('Input file not found');
        }
        
        if (errorMessage.includes('unsupported image format') ||
            errorMessage.includes('invalid image')) {
          throw new UnrecoverableError('Unsupported or invalid image format');
        }
        
        if (errorMessage.includes('image too large')) {
          throw new UnrecoverableError('Image too large to process');
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
    const outputFormat = format || 'jpeg';
    return `${parsed.name}_processed_${timestamp}.${outputFormat}`;
  }

  /**
   * Schedule file for cleanup - SIMPLE VERSION
   */
  private scheduleFileForCleanup(filePath: string, jobId: string, reason: string): void {
    console.log(`🗑️ Scheduling file for cleanup: ${filePath} (reason: ${reason})`);
    this.cleanupQueue.add(filePath);
  }

  /**
   * Setup simple cleanup worker
   */
  private setupSimpleCleanup(): void {
    console.log('🧹 Setting up simple cleanup worker...');
    
    // Run cleanup every 30 seconds
    this.cleanupInterval = setInterval(async () => {
      await this.processCleanupQueue();
    }, 30000);
  }

  /**
   * Process cleanup queue - SIMPLIFIED
   */
  private async processCleanupQueue(): Promise<void> {
    if (this.cleanupQueue.size === 0) return;

    console.log(`🧹 Processing cleanup queue (${this.cleanupQueue.size} files)`);
    
    const filesToCleanup = Array.from(this.cleanupQueue);
    this.cleanupQueue.clear(); // Clear queue to prevent duplicates

    for (const filePath of filesToCleanup) {
      try {
        // Check if file still exists
        await fs.access(filePath);
        
        // Delete the file
        await fs.unlink(filePath);
        console.log(`✅ File cleaned up: ${filePath}`);
        this.stats.filesCleanedUp++;
        
      } catch (error: any) {
        if (error.code === 'ENOENT') {
          console.log(`✅ File already deleted: ${filePath}`);
          this.stats.filesCleanedUp++;
        } else {
          console.error(`❌ Failed to cleanup file ${filePath}:`, error);
          // Re-add to queue for retry
          this.cleanupQueue.add(filePath);
        }
      }
    }
  }

  /**
   * Validate job data
   */
  /**
 * Validate job data
 */
private async validateJobData(data: ImageJobPayload): Promise<void> {
  try {
    await FileValidationService.validateFile({
      path: data.filePath,
      originalName: data.originalName,
      size: data.fileSize,
      mimeType: data.mimeType,
    });

    // Enhanced operations validation
    if (data.operations) {
      if (data.operations.resize) {
        const { width, height } = data.operations.resize;
        if (width && (width < 1 || width > 10000)) {
          throw new ValidationError('Invalid resize width');
        }
        if (height && (height < 1 || height > 10000)) {
          throw new ValidationError('Invalid resize height');
        }
      }
      
      if (data.operations.quality && 
         (data.operations.quality < 1 || data.operations.quality > 100)) {
        throw new ValidationError('Quality must be between 1 and 100');
      }

      // NEW: Add validation for new operations
      if (data.operations.brightness !== undefined && 
         (data.operations.brightness < -100 || data.operations.brightness > 100)) {
        throw new ValidationError('Brightness must be between -100 and 100');
      }

      if (data.operations.contrast !== undefined && 
         (data.operations.contrast < -100 || data.operations.contrast > 100)) {
        throw new ValidationError('Contrast must be between -100 and 100');
      }

      if (data.operations.saturation !== undefined && 
         (data.operations.saturation < -100 || data.operations.saturation > 100)) {
        throw new ValidationError('Saturation must be between -100 and 100');
      }

      if (data.operations.hue !== undefined && 
         (data.operations.hue < -360 || data.operations.hue > 360)) {
        throw new ValidationError('Hue must be between -360 and 360');
      }

      if (data.operations.gamma !== undefined && 
         (data.operations.gamma < 0.1 || data.operations.gamma > 3.0)) {
        throw new ValidationError('Gamma must be between 0.1 and 3.0');
      }

      if (data.operations.compression !== undefined && 
         (data.operations.compression < 0 || data.operations.compression > 9)) {
        throw new ValidationError('Compression must be between 0 and 9');
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
          errorMessage.includes('unsupported image format') ||
          errorMessage.includes('invalid image') ||
          errorMessage.includes('image too large')) {
        return false;
      }
      
      // Recoverable errors
      if (errorMessage.includes('timeout') ||
          errorMessage.includes('connection') ||
          errorMessage.includes('memory')) {
        return true;
      }
    }

    return true; // Default to recoverable
  }

  /**
   * Get job status
   */
  public async getJobStatus(jobId: string): Promise<JobStatusResponse | null> {
    try {
      const job = await imageQueue.getJob(jobId);
      if (!job) return null;

      const jobState = await job.getState();
      const progress = job.progress;
      
      let status: JobStatusResponse['status'] = 'waiting';
      
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
      logger.error('Error getting job status:', { jobId, error });
      throw error;
    }
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
   * Setup event handlers
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
      logger.error('Worker error:', { error: error.message });
      this.emit('error', error);
    });

    this.worker.on('failed', (job, error) => {
      logger.error('Worker job failed:', {
        jobId: job?.id,
        error: error.message,
      });
    });

    this.worker.on('stalled', (jobId) => {
      logger.warn('Worker job stalled:', { jobId });
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
        logger.debug('Health check error:', { error });
      }
    }, 300000); // 5 minutes
  }

  /**
   * Get health status
   */
  async getHealthStatus(): Promise<HealthStatus> {
    const uptime = Date.now() - this.stats.startTime;
    const memoryUsage = process.memoryUsage();
    
    let queueHealth = {
      waiting: 0,
      active: 0,
      completed: 0,
      failed: 0,
    };

    try {
      const jobCounts = await imageQueue.getJobCounts('waiting', 'active', 'completed', 'failed');
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
      throw new Error('Cannot start worker during shutdown');
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Worker ready timeout'));
      }, 10000);

      if (this.worker.isRunning()) {
        clearTimeout(timeout);
        logger.info('Image worker is already running');
        resolve();
        return;
      }

      this.worker.once('ready', () => {
        clearTimeout(timeout);
        logger.info('Image worker started successfully');
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

  getStats(): WorkerStats {
    return { ...this.stats };
  }
}

export const imageWorker = new ImageWorker();
export type { ImageOperations, JobStatusResponse };
export { ImageWorker };