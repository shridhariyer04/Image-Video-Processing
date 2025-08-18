// src/server.ts
import app from './app';
import { PORT } from './config/env';
import logger from './utils/logger';
import { imageWorker } from './wokers/image.worker'; // Fixed import path (wokers not workers)
import { setupPeriodicCleanup } from './middlewares/upload';

async function startServer() {
  console.log('🚀 Starting server initialization...');
  
  try {
    console.log('📊 Step 1: Starting image processing worker...');
    
    // Create a promise that resolves when worker is ready
    const workerReadyPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Worker startup timeout after 30 seconds'));
      }, 30000);

      imageWorker.once('ready', () => {
        clearTimeout(timeout);
        resolve(true);
      });

      imageWorker.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });

    // Start the worker
    const startPromise = imageWorker.start();
    
    // Wait for either the worker to be ready or for an error
    await Promise.race([workerReadyPromise, startPromise]);
    console.log('✅ Image worker started successfully');
    
    console.log('🧹 Step 2: Setting up periodic cleanup...');
    setupPeriodicCleanup();
    console.log('✅ Periodic cleanup setup completed');

    console.log('🌐 Step 3: Starting Express server...');
    
    // Start the Express server
    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`🎉 SERVER IS RUNNING!`);
      console.log(`🔗 URL: http://localhost:${PORT}`);
      console.log(`🏥 Health check: http://localhost:${PORT}/health`);
      console.log(`📁 Upload endpoint: http://localhost:${PORT}/upload`);
      console.log(`📊 Worker stats: http://localhost:${PORT}/worker/stats`);
      
      logger.info(`Server started successfully`, {
        port: PORT,
        environment: process.env.NODE_ENV || 'development',
        url: `http://localhost:${PORT}`,
        endpoints: {
          upload: '/upload',
          health: '/health',
          jobStatus: '/job/:jobId/status',
          jobDownload: '/job/:jobId/download',
          workerStats: '/worker/stats'
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

    // Handle graceful shutdown - ONLY handle it here, not in the worker
    const gracefulShutdown = async (signal: string) => {
      console.log(`📴 ${signal} received, starting graceful shutdown...`);
      
      // Close server first
      server.close(async (err) => {
        if (err) {
          console.error('Error closing server:', err);
          process.exit(1);
        }
        
        console.log('✅ Server closed');
        
        // Then close worker
        try {
          await imageWorker.stop();
          console.log('✅ Worker closed');
          console.log('👋 Graceful shutdown completed');
          process.exit(0);
        } catch (error) {
          console.error('Error closing worker:', error);
          process.exit(1);
        }
      });
      
      // Force exit after 10 seconds
      setTimeout(() => {
        console.log('⚠️  Forcing exit after 10 seconds');
        process.exit(1);
      }, 10000);
    };

    // Only handle shutdown signals in the main server, not the worker
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    // Worker event handlers for monitoring
    imageWorker.on('jobCompleted', ({ jobId, result, processingTime }) => {
      logger.info('Job completed successfully:', {
        jobId,
        processingTime: `${processingTime.toFixed(2)}ms`,
        outputPath: result.outputPath,
        operations: result.operations
      });
    });

    imageWorker.on('jobFailed', ({ jobId, error, isRecoverable, attempt }) => {
      logger.error('Job failed:', {
        jobId,
        error: error instanceof Error ? error.message : error,
        isRecoverable,
        attempt
      });
    });

    imageWorker.on('healthWarning', (health) => {
      logger.warn('Worker health warning:', {
        status: health.status,
        memoryUsage: health.memoryUsage,
        queueHealth: health.queueHealth
      });
    });

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    logger.error('Failed to start server:', {
      error: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined,
    });
    
    process.exit(1);
  }
}

// Handle uncaught exceptions and rejections
process.on('uncaughtException', async (error) => {
  console.error('💥 Uncaught exception:', error);
  logger.error('Uncaught exception:', {
    error: error.message,
    stack: error.stack,
  });
  
  try {
    await imageWorker.stop();
  } catch (workerError) {
    console.error('Error stopping worker after uncaught exception:', workerError);
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
    await imageWorker.stop();
  } catch (workerError) {
    console.error('Error stopping worker after unhandled rejection:', workerError);
  }
  
  process.exit(1);
});

console.log('🎬 Starting server...');
startServer();