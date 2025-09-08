"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const app_1 = __importDefault(require("./app"));
const env_1 = require("./config/env");
const logger_1 = __importDefault(require("./utils/logger"));
const image_worker_1 = require("./wokers/image.worker");
const video_worker_config_1 = require("./wokers/video.worker.config");
const upload_1 = require("./middlewares/upload");
async function startServer() {
    console.log('🚀 Starting unified media processing server...');
    try {
        console.log('📊 Step 1: Starting workers...');
        // Start both workers concurrently
        const workerPromises = await Promise.allSettled([
            startImageWorker(),
            startVideoWorker()
        ]);
        // Check if both workers started successfully
        const failedWorkers = workerPromises
            .map((result, index) => ({ result, name: index === 0 ? 'image' : 'video' }))
            .filter(({ result }) => result.status === 'rejected');
        if (failedWorkers.length > 0) {
            console.error('❌ Failed to start workers:');
            failedWorkers.forEach(({ name, result }) => {
                console.error(`  - ${name} worker:`, result.reason);
            });
            throw new Error(`Failed to start ${failedWorkers.length} worker(s)`);
        }
        console.log('✅ All workers started successfully');
        console.log('🧹 Step 2: Setting up periodic cleanup...');
        (0, upload_1.setupPeriodicCleanup)();
        console.log('✅ Periodic cleanup setup completed');
        console.log('🌐 Step 3: Starting Express server...');
        // Start the Express server
        const server = app_1.default.listen(env_1.PORT, '0.0.0.0', () => {
            console.log(`🎉 UNIFIED MEDIA PROCESSING SERVER IS RUNNING!`);
            console.log(`🔗 URL: http://localhost:${env_1.PORT}`);
            console.log(`🏥 Health check: http://localhost:${env_1.PORT}/health`);
            console.log(`📷 Image upload: http://localhost:${env_1.PORT}/upload`);
            console.log(`🎬 Video upload: http://localhost:${env_1.PORT}/video`);
            console.log(`📊 API docs: http://localhost:${env_1.PORT}/api`);
            console.log(`📈 Image worker stats: http://localhost:${env_1.PORT}/upload/worker/stats`);
            console.log(`🎥 Video worker stats: http://localhost:${env_1.PORT}/video/worker/stats`);
            logger_1.default.info(`Unified media processing server started successfully`, {
                port: env_1.PORT,
                environment: process.env.NODE_ENV || 'development',
                url: `http://localhost:${env_1.PORT}`,
                services: ['image-processing', 'video-processing'],
                endpoints: {
                    imageUpload: '/upload',
                    videoUpload: '/video',
                    health: '/health',
                    api: '/api',
                    imageWorkerStats: '/upload/worker/stats',
                    videoWorkerStats: '/video/worker/stats'
                }
            });
        });
        server.on('error', (error) => {
            console.error('❌ Server error:', error);
            if (error.code === 'EADDRINUSE') {
                console.error(`Port ${env_1.PORT} is already in use.`);
            }
            else if (error.code === 'EACCES') {
                console.error(`Permission denied to bind to port ${env_1.PORT}`);
            }
            logger_1.default.error('Server startup error:', error);
            process.exit(1);
        });
        // Handle graceful shutdown
        const gracefulShutdown = async (signal) => {
            console.log(`📴 ${signal} received, starting graceful shutdown...`);
            // Close server first
            server.close(async (err) => {
                if (err) {
                    console.error('Error closing server:', err);
                    process.exit(1);
                }
                console.log('✅ Server closed');
                // Close both workers
                try {
                    await Promise.allSettled([
                        image_worker_1.imageWorker.stop(),
                        video_worker_config_1.videoWorker.stop()
                    ]);
                    console.log('✅ All workers closed');
                    console.log('👋 Graceful shutdown completed');
                    process.exit(0);
                }
                catch (error) {
                    console.error('Error closing workers:', error);
                    process.exit(1);
                }
            });
            // Force exit after 15 seconds (longer for video processing)
            setTimeout(() => {
                console.log('⚠️  Forcing exit after 15 seconds');
                process.exit(1);
            }, 15000);
        };
        // Handle shutdown signals
        process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
        process.on('SIGINT', () => gracefulShutdown('SIGINT'));
        // Setup worker event handlers
        setupWorkerEventHandlers();
    }
    catch (error) {
        console.error('❌ Failed to start server:', error);
        logger_1.default.error('Failed to start server:', {
            error: error instanceof Error ? error.message : error,
            stack: error instanceof Error ? error.stack : undefined,
        });
        process.exit(1);
    }
}
async function startImageWorker() {
    console.log('  📸 Starting image processing worker...');
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error('Image worker startup timeout after 30 seconds'));
        }, 30000);
        image_worker_1.imageWorker.once('ready', () => {
            clearTimeout(timeout);
            console.log('  ✅ Image worker ready');
            resolve();
        });
        image_worker_1.imageWorker.once('error', (error) => {
            clearTimeout(timeout);
            reject(error);
        });
        image_worker_1.imageWorker.start();
    });
}
async function startVideoWorker() {
    console.log('  🎬 Starting video processing worker...');
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error('Video worker startup timeout after 30 seconds'));
        }, 30000);
        video_worker_config_1.videoWorker.once('ready', () => {
            clearTimeout(timeout);
            console.log('  ✅ Video worker ready');
            resolve();
        });
        video_worker_config_1.videoWorker.once('error', (error) => {
            clearTimeout(timeout);
            reject(error);
        });
        video_worker_config_1.videoWorker.start();
    });
}
function setupWorkerEventHandlers() {
    // Image Worker event handlers
    image_worker_1.imageWorker.on('jobCompleted', ({ jobId, result, processingTime }) => {
        logger_1.default.info('Image job completed successfully:', {
            jobId,
            processingTime: `${processingTime.toFixed(2)}ms`,
            outputPath: result.outputPath,
            operations: result.operations,
            type: 'image'
        });
    });
    image_worker_1.imageWorker.on('jobFailed', ({ jobId, error, isRecoverable, attempt }) => {
        logger_1.default.error('Image job failed:', {
            jobId,
            error: error instanceof Error ? error.message : error,
            isRecoverable,
            attempt,
            type: 'image'
        });
    });
    image_worker_1.imageWorker.on('healthWarning', (health) => {
        logger_1.default.warn('Image worker health warning:', {
            status: health.status,
            memoryUsage: health.memoryUsage,
            queueHealth: health.queueHealth,
            type: 'image'
        });
    });
    // Video Worker event handlers
    video_worker_config_1.videoWorker.on('jobCompleted', ({ jobId, result, processingTime }) => {
        logger_1.default.info('Video job completed successfully:', {
            jobId,
            processingTime: `${processingTime.toFixed(2)}ms`,
            outputPath: result.outputPath,
            operations: result.operations,
            type: 'video'
        });
    });
    video_worker_config_1.videoWorker.on('jobFailed', ({ jobId, error, isRecoverable, attempt }) => {
        logger_1.default.error('Video job failed:', {
            jobId,
            error: error instanceof Error ? error.message : error,
            isRecoverable,
            attempt,
            type: 'video'
        });
    });
    video_worker_config_1.videoWorker.on('healthWarning', (health) => {
        logger_1.default.warn('Video worker health warning:', {
            status: health.status,
            memoryUsage: health.memoryUsage,
            queueHealth: health.queueHealth,
            type: 'video'
        });
    });
}
// Handle uncaught exceptions and rejections
process.on('uncaughtException', async (error) => {
    console.error('💥 Uncaught exception:', error);
    logger_1.default.error('Uncaught exception:', {
        error: error.message,
        stack: error.stack,
    });
    try {
        await Promise.allSettled([
            image_worker_1.imageWorker.stop(),
            video_worker_config_1.videoWorker.stop()
        ]);
    }
    catch (workerError) {
        console.error('Error stopping workers after uncaught exception:', workerError);
    }
    process.exit(1);
});
process.on('unhandledRejection', async (reason, promise) => {
    console.error('💥 Unhandled rejection at:', promise, 'reason:', reason);
    logger_1.default.error('Unhandled rejection:', {
        reason,
        promise,
    });
    try {
        await Promise.allSettled([
            image_worker_1.imageWorker.stop(),
            video_worker_config_1.videoWorker.stop()
        ]);
    }
    catch (workerError) {
        console.error('Error stopping workers after unhandled rejection:', workerError);
    }
    process.exit(1);
});
console.log('🎬 Starting unified media processing server...');
startServer();
