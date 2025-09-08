"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ImageWorker = exports.imageWorker = void 0;
const bullmq_1 = require("bullmq");
const bullmq_2 = require("../config/bullmq");
const redis_1 = require("../config/redis");
const ImageProcessor_1 = require("../processors/ImageProcessor");
const env_1 = require("../config/env");
const image_config_1 = require("../config/image.config");
const validationservice_1 = require("../service/validationservice");
const error_1 = require("../utils/error");
const logger_1 = __importDefault(require("../utils/logger"));
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const perf_hooks_1 = require("perf_hooks");
const events_1 = require("events");
// Worker configuration
const WORKER_CONFIG = {
    concurrency: env_1.NODE_ENV === 'production' ? 2 : 1,
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
class ImageWorker extends events_1.EventEmitter {
    worker;
    stats;
    isShuttingDown = false;
    healthCheckInterval;
    cleanupInterval;
    // Simple cleanup queue - no complex reference counting
    cleanupQueue = new Set();
    processedFiles = new Map();
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
        this.worker = new bullmq_1.Worker(env_1.PROCESSING_QUEUE_NAME, this.processJob.bind(this), {
            connection: redis_1.redis,
            concurrency: WORKER_CONFIG.concurrency,
            removeOnComplete: WORKER_CONFIG.removeOnComplete,
            removeOnFail: WORKER_CONFIG.removeOnFail,
            maxStalledCount: WORKER_CONFIG.maxStalledCount,
            stalledInterval: WORKER_CONFIG.stalledInterval,
            autorun: true,
        });
        this.setupEventHandlers();
        this.setupHealthCheck();
        this.setupSimpleCleanup();
    }
    /**
     * Main job processing function - SIMPLIFIED
     */
    async processJob(job) {
        const jobStartTime = perf_hooks_1.performance.now();
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
            logger_1.default.info('Processing image job started:', {
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
            this.scheduleFileForCleanup(job.data.filePath, job.id, 'job_completed');
            console.log('✅ [STEP 9] File scheduled for cleanup');
            console.log('🔄 [STEP 10] Final progress update to 100%...');
            await this.updateProgress(job, 100);
            console.log('✅ [STEP 10] Final progress updated');
            console.log('🔄 [STEP 11] Calculating final metrics...');
            const processingTime = perf_hooks_1.performance.now() - jobStartTime;
            result.processingTime = processingTime;
            this.updateStats(processingTime, true);
            // Track processed file
            this.processedFiles.set(job.data.filePath, {
                jobId: job.id,
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
            logger_1.default.info('Image job completed successfully:', {
                jobId: job.id,
                filename: job.data.originalName,
                outputPath: result.outputPath,
                processingTime: `${processingTime.toFixed(2)}ms`,
            });
            console.log('🔄 [STEP 12] Emitting completion event...');
            this.emit('jobCompleted', { jobId: job.id, result, processingTime });
            console.log('✅ [STEP 12] Completion event emitted');
            return result;
        }
        catch (error) {
            const processingTime = perf_hooks_1.performance.now() - jobStartTime;
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
                this.scheduleFileForCleanup(job.data.filePath, job.id, isRecoverable ? 'max_retries_exceeded' : 'unrecoverable_error');
            }
            else {
                console.log('⚠️ Recoverable error - keeping file for retry');
            }
            logger_1.default.error('Image job processing failed:', {
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
                throw new bullmq_1.UnrecoverableError(error instanceof Error ? error.message : 'Unrecoverable processing error');
            }
            throw error;
        }
        finally {
            this.stats.activeJobs--;
            console.log('🔄 Job finally block - active jobs decremented to:', this.stats.activeJobs);
        }
    }
    /**
     * Simple file validation
     */
    async validateFileExists(filePath) {
        try {
            await promises_1.default.access(filePath);
            console.log('✅ Input file exists:', filePath);
        }
        catch (error) {
            console.error('❌ Input file missing:', filePath);
            throw new bullmq_1.UnrecoverableError(`Input file not found: ${filePath}`);
        }
    }
    /**
     * Safe progress update
     */
    async updateProgress(job, progress) {
        try {
            await job.updateProgress(progress);
            console.log(`✅ Progress updated to ${progress}%`);
        }
        catch (error) {
            console.warn(`⚠️ Failed to update progress to ${progress}%:`, error);
        }
    }
    /**
     * Process image job - SIMPLIFIED
     */
    async processImageJob(job) {
        console.log('=== PROCESSING IMAGE JOB ===');
        console.log('Input Path:', job.data.filePath);
        console.log('Operations:', JSON.stringify(job.data.operations, null, 2));
        try {
            // Verify input file
            const inputStats = await promises_1.default.stat(job.data.filePath);
            console.log('✅ Input file verified. Size:', inputStats.size, 'bytes');
            const outputFormat = job.data.operations?.format || 'jpeg';
            const outputDir = image_config_1.IMAGE_CONFIG.PROCESSED_DIR;
            // Ensure output directory exists
            await promises_1.default.mkdir(outputDir, { recursive: true });
            console.log('✅ Output directory ready:', outputDir);
            console.log('🔄 Calling ImageProcessor.processImage...');
            const result = await ImageProcessor_1.ImageProcessor.processImage({
                inputPath: job.data.filePath,
                outputDir,
                operations: job.data.operations,
                filename: this.generateOutputFilename(job.data.originalName, outputFormat),
                preserveMetadata: false,
                quality: job.data.operations?.quality,
            });
            console.log(`✅ ImageProcessor completed:`, result.outputPath);
            // Verify output file
            const outputStats = await promises_1.default.stat(result.outputPath);
            if (outputStats.size === 0) {
                throw new error_1.AppError('Processed file is empty', 500, 'EMPTY_OUTPUT');
            }
            console.log('✅ Output file verified. Size:', outputStats.size, 'bytes');
            return result;
        }
        catch (error) {
            console.error('❌ Image processing failed:', error);
            // Handle specific error types
            if (error instanceof Error) {
                const errorMessage = error.message.toLowerCase();
                if (errorMessage.includes('input file is missing') ||
                    errorMessage.includes('enoent')) {
                    throw new bullmq_1.UnrecoverableError('Input file not found');
                }
                if (errorMessage.includes('unsupported image format') ||
                    errorMessage.includes('invalid image')) {
                    throw new bullmq_1.UnrecoverableError('Unsupported or invalid image format');
                }
                if (errorMessage.includes('image too large')) {
                    throw new bullmq_1.UnrecoverableError('Image too large to process');
                }
            }
            throw error;
        }
    }
    /**
     * Generate output filename
     */
    generateOutputFilename(originalName, format) {
        const parsed = path_1.default.parse(originalName);
        const timestamp = Date.now();
        const outputFormat = format || 'jpeg';
        return `${parsed.name}_processed_${timestamp}.${outputFormat}`;
    }
    /**
     * Schedule file for cleanup - SIMPLE VERSION
     */
    scheduleFileForCleanup(filePath, jobId, reason) {
        console.log(`🗑️ Scheduling file for cleanup: ${filePath} (reason: ${reason})`);
        this.cleanupQueue.add(filePath);
    }
    /**
     * Setup simple cleanup worker
     */
    setupSimpleCleanup() {
        console.log('🧹 Setting up simple cleanup worker...');
        // Run cleanup every 30 seconds
        this.cleanupInterval = setInterval(async () => {
            await this.processCleanupQueue();
        }, 30000);
    }
    /**
     * Process cleanup queue - SIMPLIFIED
     */
    async processCleanupQueue() {
        if (this.cleanupQueue.size === 0)
            return;
        console.log(`🧹 Processing cleanup queue (${this.cleanupQueue.size} files)`);
        const filesToCleanup = Array.from(this.cleanupQueue);
        this.cleanupQueue.clear(); // Clear queue to prevent duplicates
        for (const filePath of filesToCleanup) {
            try {
                // Check if file still exists
                await promises_1.default.access(filePath);
                // Delete the file
                await promises_1.default.unlink(filePath);
                console.log(`✅ File cleaned up: ${filePath}`);
                this.stats.filesCleanedUp++;
            }
            catch (error) {
                if (error.code === 'ENOENT') {
                    console.log(`✅ File already deleted: ${filePath}`);
                    this.stats.filesCleanedUp++;
                }
                else {
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
    async validateJobData(data) {
        try {
            await validationservice_1.FileValidationService.validateFile({
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
                        throw new error_1.ValidationError('Invalid resize width');
                    }
                    if (height && (height < 1 || height > 10000)) {
                        throw new error_1.ValidationError('Invalid resize height');
                    }
                }
                if (data.operations.quality &&
                    (data.operations.quality < 1 || data.operations.quality > 100)) {
                    throw new error_1.ValidationError('Quality must be between 1 and 100');
                }
                // NEW: Add validation for new operations
                if (data.operations.brightness !== undefined &&
                    (data.operations.brightness < -100 || data.operations.brightness > 100)) {
                    throw new error_1.ValidationError('Brightness must be between -100 and 100');
                }
                if (data.operations.contrast !== undefined &&
                    (data.operations.contrast < -100 || data.operations.contrast > 100)) {
                    throw new error_1.ValidationError('Contrast must be between -100 and 100');
                }
                if (data.operations.saturation !== undefined &&
                    (data.operations.saturation < -100 || data.operations.saturation > 100)) {
                    throw new error_1.ValidationError('Saturation must be between -100 and 100');
                }
                if (data.operations.hue !== undefined &&
                    (data.operations.hue < -360 || data.operations.hue > 360)) {
                    throw new error_1.ValidationError('Hue must be between -360 and 360');
                }
                if (data.operations.gamma !== undefined &&
                    (data.operations.gamma < 0.1 || data.operations.gamma > 3.0)) {
                    throw new error_1.ValidationError('Gamma must be between 0.1 and 3.0');
                }
                if (data.operations.compression !== undefined &&
                    (data.operations.compression < 0 || data.operations.compression > 9)) {
                    throw new error_1.ValidationError('Compression must be between 0 and 9');
                }
            }
        }
        catch (error) {
            if (error instanceof error_1.ValidationError || error instanceof error_1.AppError) {
                throw new bullmq_1.UnrecoverableError(error.message);
            }
            throw error;
        }
    }
    /**
     * Check if error is recoverable
     */
    isRecoverableError(error) {
        if (error instanceof bullmq_1.UnrecoverableError || error instanceof error_1.ValidationError) {
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
    async getJobStatus(jobId) {
        try {
            const job = await bullmq_2.imageQueue.getJob(jobId);
            if (!job)
                return null;
            const jobState = await job.getState();
            const progress = job.progress;
            let status = 'waiting';
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
            const response = {
                status,
                progress: typeof progress === 'number' ? progress : undefined,
                data: job.data,
                createdAt: job.timestamp ? new Date(job.timestamp) : undefined,
                processedAt: job.processedOn ? new Date(job.processedOn) : undefined,
            };
            // Add result data for completed jobs
            if (status === 'completed' && job.returnvalue) {
                const result = job.returnvalue;
                response.result = result;
                response.outputPath = result.outputPath;
                response.originalFileName = job.data.originalName;
                response.processedFileName = path_1.default.basename(result.outputPath);
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
        }
        catch (error) {
            logger_1.default.error('Error getting job status:', { jobId, error });
            throw error;
        }
    }
    /**
     * Update processing statistics
     */
    updateStats(processingTime, successful) {
        this.stats.totalProcessingTime += processingTime;
        this.stats.lastProcessedAt = Date.now();
        if (successful) {
            this.stats.processed++;
        }
        else {
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
    setupEventHandlers() {
        this.worker.on('ready', () => {
            logger_1.default.info('Image worker ready:', {
                concurrency: WORKER_CONFIG.concurrency,
                environment: env_1.NODE_ENV,
            });
            this.emit('ready');
        });
        this.worker.on('error', (error) => {
            logger_1.default.error('Worker error:', { error: error.message });
            this.emit('error', error);
        });
        this.worker.on('failed', (job, error) => {
            logger_1.default.error('Worker job failed:', {
                jobId: job?.id,
                error: error.message,
            });
        });
        this.worker.on('stalled', (jobId) => {
            logger_1.default.warn('Worker job stalled:', { jobId });
            this.emit('stalled', jobId);
        });
    }
    /**
     * Setup health check
     */
    setupHealthCheck() {
        this.healthCheckInterval = setInterval(async () => {
            try {
                const health = await this.getHealthStatus();
                this.emit('healthCheck', health);
            }
            catch (error) {
                logger_1.default.debug('Health check error:', { error });
            }
        }, 300000); // 5 minutes
    }
    /**
     * Get health status
     */
    async getHealthStatus() {
        const uptime = Date.now() - this.stats.startTime;
        const memoryUsage = process.memoryUsage();
        let queueHealth = {
            waiting: 0,
            active: 0,
            completed: 0,
            failed: 0,
        };
        try {
            const jobCounts = await bullmq_2.imageQueue.getJobCounts('waiting', 'active', 'completed', 'failed');
            queueHealth = {
                waiting: jobCounts.waiting || 0,
                active: jobCounts.active || 0,
                completed: jobCounts.completed || 0,
                failed: jobCounts.failed || 0,
            };
        }
        catch (error) {
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
    async start() {
        if (this.isShuttingDown) {
            throw new Error('Cannot start worker during shutdown');
        }
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Worker ready timeout'));
            }, 10000);
            if (this.worker.isRunning()) {
                clearTimeout(timeout);
                logger_1.default.info('Image worker is already running');
                resolve();
                return;
            }
            this.worker.once('ready', () => {
                clearTimeout(timeout);
                logger_1.default.info('Image worker started successfully');
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
    async stop() {
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
    getStats() {
        return { ...this.stats };
    }
}
exports.ImageWorker = ImageWorker;
exports.imageWorker = new ImageWorker();
