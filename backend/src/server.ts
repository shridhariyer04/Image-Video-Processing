import app from './app';
import { PORT } from './config/env';
import logger from './utils/logger';
import { imageWorker } from './wokers/image.worker';
import { videoWorker } from './wokers/video.worker.config';
import { setupPeriodicCleanup } from './middlewares/upload';

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
        console.error(`  - ${name} worker:`, (result as PromiseRejectedResult).reason);
      });
      throw new Error(`Failed to start ${failedWorkers.length} worker(s)`);
    }

    console.log('✅ All workers started successfully');
    
    console.log('🧹 Step 2: Setting up periodic cleanup...');
    setupPeriodicCleanup();
    console.log('✅ Periodic cleanup setup completed');

    console.log('🌐 Step 3: Starting Express server...');
    
    // Start the Express server
    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`🎉 UNIFIED MEDIA PROCESSING SERVER IS RUNNING!`);
      console.log(`🔗 URL: http://localhost:${PORT}`);
      console.log(`🏥 Health check: http://localhost:${PORT}/health`);
      console.log(`📷 Image upload: http://localhost:${PORT}/upload`);
      console.log(`🎬 Video upload: http://localhost:${PORT}/video`);
      console.log(`📊 API docs: http://localhost:${PORT}/api`);
      console.log(`📈 Image worker stats: http://localhost:${PORT}/upload/worker/stats`);
      console.log(`🎥 Video worker stats: http://localhost:${PORT}/video/worker/stats`);
      
      logger.info(`Unified media processing server started successfully`, {
        port: PORT,
        environment: process.env.NODE_ENV || 'development',
        url: `http://localhost:${PORT}`,
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

    server.on('error', (error: any) => {
      console.error('❌ Server error:', error);
      
      if (error.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} is already in use.`);
      } else if (error.code === 'EACCES') {
        console.error(`Permission denied to bind to port ${PORT}`);
      }
      
      logger.error('Server startup error:', error);
      process.exit(1);
    });

    // Handle graceful shutdown
    const gracefulShutdown = async (signal: string) => {
      console.log(`📴 ${signal} received, starting graceful shutdown...`);
      
      // Close server first
      server.close(async (err: Error | undefined) => {
        if (err) {
          console.error('Error closing server:', err);
          process.exit(1);
        }
        
        console.log('✅ Server closed');
        
        // Close both workers
        try {
          await Promise.allSettled([
            imageWorker.stop(),
            videoWorker.stop()
          ]);
          console.log('✅ All workers closed');
          console.log('👋 Graceful shutdown completed');
          process.exit(0);
        } catch (error) {
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

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    logger.error('Failed to start server:', {
      error: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined,
    });
    
    process.exit(1);
  }
}

async function startImageWorker(): Promise<void> {
  console.log('  📸 Starting image processing worker...');
  
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Image worker startup timeout after 30 seconds'));
    }, 30000);

    imageWorker.once('ready', () => {
      clearTimeout(timeout);
      console.log('  ✅ Image worker ready');
      resolve();
    });

    imageWorker.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    imageWorker.start();
  });
}

async function startVideoWorker(): Promise<void> {
  console.log('  🎬 Starting video processing worker...');
  
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Video worker startup timeout after 30 seconds'));
    }, 30000);

    videoWorker.once('ready', () => {
      clearTimeout(timeout);
      console.log('  ✅ Video worker ready');
      resolve();
    });

    videoWorker.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    videoWorker.start();
  });
}

function setupWorkerEventHandlers() {
  // Image Worker event handlers
  imageWorker.on('jobCompleted', ({ jobId, result, processingTime }) => {
    logger.info('Image job completed successfully:', {
      jobId,
      processingTime: `${processingTime.toFixed(2)}ms`,
      outputPath: result.outputPath,
      operations: result.operations,
      type: 'image'
    });
  });

  imageWorker.on('jobFailed', ({ jobId, error, isRecoverable, attempt }) => {
    logger.error('Image job failed:', {
      jobId,
      error: error instanceof Error ? error.message : error,
      isRecoverable,
      attempt,
      type: 'image'
    });
  });

  imageWorker.on('healthWarning', (health) => {
    logger.warn('Image worker health warning:', {
      status: health.status,
      memoryUsage: health.memoryUsage,
      queueHealth: health.queueHealth,
      type: 'image'
    });
  });

  // Video Worker event handlers
  videoWorker.on('jobCompleted', ({ jobId, result, processingTime }) => {
    logger.info('Video job completed successfully:', {
      jobId,
      processingTime: `${processingTime.toFixed(2)}ms`,
      outputPath: result.outputPath,
      operations: result.operations,
      type: 'video'
    });
  });

  videoWorker.on('jobFailed', ({ jobId, error, isRecoverable, attempt }) => {
    logger.error('Video job failed:', {
      jobId,
      error: error instanceof Error ? error.message : error,
      isRecoverable,
      attempt,
      type: 'video'
    });
  });

  videoWorker.on('healthWarning', (health) => {
    logger.warn('Video worker health warning:', {
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
  logger.error('Uncaught exception:', {
    error: error.message,
    stack: error.stack,
  });
  
  try {
    await Promise.allSettled([
      imageWorker.stop(),
      videoWorker.stop()
    ]);
  } catch (workerError) {
    console.error('Error stopping workers after uncaught exception:', workerError);
  }
  
  process.exit(1);
});

process.on('unhandledRejection', async (reason, promise) => {
  console.error('💥 Unhandled rejection at:', promise, 'reason:', reason);
  logger.error('Unhandled rejection:', {
    reason,
    promise,
  });
  
  try {
    await Promise.allSettled([
      imageWorker.stop(),
      videoWorker.stop()
    ]);
  } catch (workerError) {
    console.error('Error stopping workers after unhandled rejection:', workerError);
  }
  
  process.exit(1);
});

console.log('🎬 Starting unified media processing server...');
startServer();