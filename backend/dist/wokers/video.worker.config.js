"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.VideoWorker = exports.videoWorker = void 0;
const bullmq_1 = require("bullmq");
const videobullmq_1 = require("../config/videobullmq");
const redis_1 = require("../config/redis");
const VideoProcessor_1 = require("../processors/VideoProcessor");
const env_1 = require("../config/env");
const video_image_config_1 = require("../config/video.image.config");
const videovalidationservice_1 = require("../service/videovalidationservice");
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
    stalledInterval: 60000, // 60 seconds for video processing
    removeOnComplete: {
        count: video_image_config_1.VIDEO_CONFIG.WORKER.QUEUE_LIMITS.MAX_COMPLETED_JOBS,
        age: video_image_config_1.VIDEO_CONFIG.WORKER.QUEUE_LIMITS.COMPLETED_JOB_AGE * 1000
    },
    removeOnFail: {
        count: video_image_config_1.VIDEO_CONFIG.WORKER.QUEUE_LIMITS.MAX_FAILED_JOBS,
        age: video_image_config_1.VIDEO_CONFIG.WORKER.QUEUE_LIMITS.FAILED_JOB_AGE * 1000
    },
};
class VideoWorker extends events_1.EventEmitter {
    worker;
    stats;
    isShuttingDown = false;
    healthCheckInterval;
    cleanupInterval;
    // Simple cleanup queue
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
            totalVideosDuration: 0,
            averageVideoSize: 0,
        };
        this.worker = new bullmq_1.Worker(env_1.VIDEO_PROCESSING_QUEUE_NAME, this.processJob.bind(this), {
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
     * Main job processing function
     */
    async processJob(job) {
        const jobStartTime = perf_hooks_1.performance.now();
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
            logger_1.default.info('Processing video job started:', {
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
            this.scheduleFileForCleanup(job.data.filePath, job.id, 'job_completed');
            console.log('✅ [STEP 9] File scheduled for cleanup');
            console.log('🔄 [STEP 10] Final progress update to 100%...');
            await this.updateProgress(job, 100);
            console.log('✅ [STEP 10] Final progress updated');
            console.log('🔄 [STEP 11] Calculating final metrics...');
            const processingTime = perf_hooks_1.performance.now() - jobStartTime;
            result.processingTime = processingTime;
            this.updateStats(processingTime, true, job.data.fileSize, result.duration || 0);
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
            logger_1.default.info('Video job completed successfully:', {
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
        }
        catch (error) {
            const processingTime = perf_hooks_1.performance.now() - jobStartTime;
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
                this.scheduleFileForCleanup(job.data.filePath, job.id, isRecoverable ? 'max_retries_exceeded' : 'unrecoverable_error');
            }
            else {
                console.log('⚠️ Recoverable error - keeping file for retry');
            }
            logger_1.default.error('Video job processing failed:', {
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
                throw new bullmq_1.UnrecoverableError(error instanceof Error ? error.message : 'Unrecoverable video processing error');
            }
            throw error;
        }
        finally {
            this.stats.activeJobs--;
            console.log('🔄 Video job finally block - active jobs decremented to:', this.stats.activeJobs);
        }
    }
    /**
     * Simple file validation
     */
    async validateFileExists(filePath) {
        try {
            await promises_1.default.access(filePath);
            console.log('✅ Input video file exists:', filePath);
        }
        catch (error) {
            console.error('❌ Input video file missing:', filePath);
            throw new bullmq_1.UnrecoverableError(`Input video file not found: ${filePath}`);
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
     * Process video job - SIMPLIFIED for crop and watermark only
     */
    async processVideoJob(job) {
        console.log('=== PROCESSING VIDEO JOB ===');
        console.log('Input Path:', job.data.filePath);
        console.log('Operations:', JSON.stringify(job.data.operations, null, 2));
        try {
            // Verify input file
            const inputStats = await promises_1.default.stat(job.data.filePath);
            console.log('✅ Input video file verified. Size:', `${Math.round(inputStats.size / 1024 / 1024)}MB`);
            const outputFormat = job.data.operations?.format || 'mp4';
            const outputDir = video_image_config_1.VIDEO_CONFIG.PROCESSED_VIDEO_DIR;
            // Ensure output directory exists
            await promises_1.default.mkdir(outputDir, { recursive: true });
            console.log('✅ Output directory ready:', outputDir);
            console.log('🔄 Calling VideoProcessor.processVideo...');
            const result = await VideoProcessor_1.VideoProcessor.processVideo({
                inputPath: job.data.filePath,
                outputDir,
                operations: job.data.operations,
                filename: this.generateOutputFilename(job.data.originalName, outputFormat),
                preserveMetadata: false,
                quality: job.data.operations?.quality,
            });
            console.log(`✅ VideoProcessor completed:`, result.outputPath);
            // Verify output file
            const outputStats = await promises_1.default.stat(result.outputPath);
            if (outputStats.size === 0) {
                throw new error_1.AppError('Processed video file is empty', 500, 'EMPTY_OUTPUT');
            }
            console.log('✅ Output video file verified. Size:', `${Math.round(outputStats.size / 1024 / 1024)}MB`);
            return result;
        }
        catch (error) {
            console.error('❌ Video processing failed:', error);
            // Handle specific error types
            if (error instanceof Error) {
                const errorMessage = error.message.toLowerCase();
                if (errorMessage.includes('input file is missing') ||
                    errorMessage.includes('enoent')) {
                    throw new bullmq_1.UnrecoverableError('Input video file not found');
                }
                if (errorMessage.includes('unsupported video format') ||
                    errorMessage.includes('invalid video') ||
                    errorMessage.includes('codec not supported')) {
                    throw new bullmq_1.UnrecoverableError('Unsupported or invalid video format');
                }
                if (errorMessage.includes('video too large') ||
                    errorMessage.includes('duration too long')) {
                    throw new bullmq_1.UnrecoverableError('Video too large or too long to process');
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
    generateOutputFilename(originalName, format) {
        const parsed = path_1.default.parse(originalName);
        const timestamp = Date.now();
        const outputFormat = format || 'mp4';
        return `${parsed.name}_processed_${timestamp}.${outputFormat}`;
    }
    /**
     * Schedule file for cleanup
     */
    scheduleFileForCleanup(filePath, jobId, reason) {
        console.log(`🗑️ Scheduling video file for cleanup: ${filePath} (reason: ${reason})`);
        this.cleanupQueue.add(filePath);
    }
    /**
     * Setup simple cleanup worker
     */
    setupSimpleCleanup() {
        console.log('🧹 Setting up video cleanup worker...');
        // Run cleanup every 60 seconds for videos
        this.cleanupInterval = setInterval(async () => {
            await this.processCleanupQueue();
        }, 60000);
    }
    /**
     * Process cleanup queue
     */
    async processCleanupQueue() {
        if (this.cleanupQueue.size === 0)
            return;
        console.log(`🧹 Processing video cleanup queue (${this.cleanupQueue.size} files)`);
        const filesToCleanup = Array.from(this.cleanupQueue);
        this.cleanupQueue.clear();
        for (const filePath of filesToCleanup) {
            try {
                await promises_1.default.access(filePath);
                await promises_1.default.unlink(filePath);
                console.log(`✅ Video file cleaned up: ${filePath}`);
                this.stats.filesCleanedUp++;
            }
            catch (error) {
                if (error.code === 'ENOENT') {
                    console.log(`✅ Video file already deleted: ${filePath}`);
                    this.stats.filesCleanedUp++;
                }
                else {
                    console.error(`❌ Failed to cleanup video file ${filePath}:`, error);
                    this.cleanupQueue.add(filePath);
                }
            }
        }
    }
    /**
     * Validate job data - simplified for video operations
     */
    async validateJobData(data) {
        try {
            await videovalidationservice_1.VideoFileValidationService.validateVideoFile({
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
                        throw new error_1.ValidationError('Start time cannot be negative');
                    }
                    if (endTime <= startTime) {
                        throw new error_1.ValidationError('End time must be greater than start time');
                    }
                    if (endTime - startTime > video_image_config_1.VIDEO_CONFIG.DURATION_LIMITS.MAX_DURATION) {
                        throw new error_1.ValidationError('Trimmed duration exceeds maximum allowed duration');
                    }
                }
                // Validate watermark operation
                if (data.operations.watermark) {
                    const watermark = data.operations.watermark;
                    if (watermark.type === 'text') {
                        if (!watermark.text || watermark.text.trim().length === 0) {
                            throw new error_1.ValidationError('Watermark text cannot be empty');
                        }
                        if (watermark.fontSize && (watermark.fontSize < 8 || watermark.fontSize > 200)) {
                            throw new error_1.ValidationError('Font size must be between 8 and 200');
                        }
                    }
                    else if (watermark.type === 'image') {
                        if (!watermark.imagePath) {
                            throw new error_1.ValidationError('Watermark image path is required');
                        }
                        // Could add file existence check here
                    }
                    if (watermark.opacity !== undefined &&
                        (watermark.opacity < 0.1 || watermark.opacity > 1.0)) {
                        throw new error_1.ValidationError('Watermark opacity must be between 0.1 and 1.0');
                    }
                }
                // Validate quality
                if (data.operations.quality &&
                    (data.operations.quality < 1 || data.operations.quality > 100)) {
                    throw new error_1.ValidationError('Quality must be between 1 and 100');
                }
                // Validate format
                if (data.operations.format &&
                    !video_image_config_1.VideoConfigUtils.isSupportedOutputFormat(data.operations.format)) {
                    throw new error_1.ValidationError(`Unsupported output format: ${data.operations.format}`);
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
    async getJobStatus(jobId) {
        try {
            const job = await videobullmq_1.videoQueue.getJob(jobId);
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
            logger_1.default.error('Error getting video job status:', { jobId, error });
            throw error;
        }
    }
    /**
     * Update processing statistics
     */
    updateStats(processingTime, successful, fileSize, duration) {
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
            logger_1.default.info('Video worker ready:', {
                concurrency: WORKER_CONFIG.concurrency,
                environment: env_1.NODE_ENV,
            });
            this.emit('ready');
        });
        this.worker.on('error', (error) => {
            logger_1.default.error('Video worker error:', { error: error.message });
            this.emit('error', error);
        });
        this.worker.on('failed', (job, error) => {
            logger_1.default.error('Video worker job failed:', {
                jobId: job?.id,
                error: error.message,
            });
        });
        this.worker.on('stalled', (jobId) => {
            logger_1.default.warn('Video worker job stalled:', { jobId });
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
                logger_1.default.debug('Video health check error:', { error });
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
            const jobCounts = await videobullmq_1.videoQueue.getJobCounts('waiting', 'active', 'completed', 'failed');
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
            throw new Error('Cannot start video worker during shutdown');
        }
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Video worker ready timeout'));
            }, 15000); // Longer timeout for video worker
            if (this.worker.isRunning()) {
                clearTimeout(timeout);
                logger_1.default.info('Video worker is already running');
                resolve();
                return;
            }
            this.worker.once('ready', () => {
                clearTimeout(timeout);
                logger_1.default.info('Video worker started successfully');
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
exports.VideoWorker = VideoWorker;
exports.videoWorker = new VideoWorker();
