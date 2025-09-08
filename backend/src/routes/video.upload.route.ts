import express, { Request, Response, NextFunction } from 'express';
import { videoUpload, handleVideoMulterError } from '../middlewares/videoupload';
import { handleVideoUpload } from '../controllers/videouploadcontroller';
import { videoWorker } from '../wokers/video.worker.config';
import fs from 'fs';
import path from 'path';
import { AppError } from '../utils/error';
import logger from '../utils/logger';
import { generateRecommendations } from '../utils/Helper';

const router = express.Router();

// POST / (will become /video when mounted)
router.post('/', videoUpload.array('video', 1), handleVideoMulterError, handleVideoUpload);

// GET /job/:jobId/status (will become /video/job/:jobId/status when mounted)
router.get('/job/:jobId/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { jobId } = req.params;

    if (!jobId) {
      throw new AppError('Job ID is required', 400, 'MISSING_JOB_ID');
    }

    logger.debug('Getting video job status:', { jobId });

    const jobStatus = await videoWorker.getJobStatus(jobId);

    if (!jobStatus) {
      throw new AppError('Job not found', 404, 'JOB_NOT_FOUND');
    }

    // Transform the worker response to match frontend expectations
    const response = {
      success: true,
      data: {
        jobId: jobId,
        status: jobStatus.status, // 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | 'paused'
        progress: jobStatus.progress || undefined,
        result: jobStatus.status === 'completed' ? {
          outputPath: jobStatus.outputPath,
          originalFileName: jobStatus.originalFileName || 'unknown',
          processedFileName: jobStatus.processedFileName || `processed-${jobId}`,
          fileSize: jobStatus.fileSize || 0,
          processingTime: jobStatus.processingTime || 'unknown',
          originalSize: jobStatus.result?.originalSize || 0,
          processedSize: jobStatus.result?.processedSize || 0,
        //   format: jobStatus.result?.format || 'unknown',
        //   width: jobStatus.result?.width || 0,
        //   height: jobStatus.result?.height || 0,
          duration: jobStatus.result?.duration || 0,
          operations: jobStatus.result?.operations || []
        } : undefined,
        error: jobStatus.error || undefined,
        failedReason: jobStatus.failedReason || undefined,
        createdAt: jobStatus.createdAt,
        processedAt: jobStatus.processedAt
      },
      timestamp: new Date().toISOString()
    };

    logger.debug('Video job status response:', { jobId, status: jobStatus.status });
    res.json(response);
  } catch (error) {
    logger.error('Error getting video job status:', {
      jobId: req.params.jobId,
      error: error instanceof Error ? error.message : error
    });
    next(error);
  }
});

// GET /job/:jobId/download (will become /video/job/:jobId/download when mounted)
router.get('/job/:jobId/download', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { jobId } = req.params;

    if (!jobId) {
      throw new AppError('Job ID is required', 400, 'MISSING_JOB_ID');
    }

    logger.debug('Video download request for job:', { jobId });

    const jobStatus = await videoWorker.getJobStatus(jobId);

    if (!jobStatus) {
      throw new AppError('Job not found', 404, 'JOB_NOT_FOUND');
    }

    if (jobStatus.status !== 'completed') {
      throw new AppError(
        `Video job is not completed yet. Current status: ${jobStatus.status}`,
        400,
        'JOB_NOT_COMPLETED'
      );
    }

    if (!jobStatus.outputPath) {
      throw new AppError('Processed video file not found', 404, 'FILE_NOT_FOUND');
    }

    // Check if video file exists
    let filePath: string;
    let fileSize: number;
    
    try {
      const stats = await fs.promises.stat(jobStatus.outputPath);
      filePath = jobStatus.outputPath;
      fileSize = stats.size;
      
      if (fileSize === 0) {
        throw new AppError('Processed video file is empty', 404, 'FILE_EMPTY');
      }
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        throw new AppError('Processed video file not found', 404, 'FILE_NOT_FOUND');
      }
      throw error;
    }

    const fileName = jobStatus.processedFileName || `processed-video-${jobId}.mp4`;

    // Determine content type based on file extension
    const ext = path.extname(filePath).toLowerCase();
    let contentType = 'video/mp4'; // Default to mp4

    switch (ext) {
      case '.mp4':
      case '.m4v':
        contentType = 'video/mp4';
        break;
      case '.avi':
        contentType = 'video/x-msvideo';
        break;
      case '.mov':
        contentType = 'video/quicktime';
        break;
      case '.wmv':
        contentType = 'video/x-ms-wmv';
        break;
      case '.flv':
        contentType = 'video/x-flv';
        break;
      case '.webm':
        contentType = 'video/webm';
        break;
      case '.mkv':
        contentType = 'video/x-matroska';
        break;
      case '.3gp':
        contentType = 'video/3gpp';
        break;
      default:
        contentType = 'video/mp4';
    }

    // Set response headers for video download
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', fileSize);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    res.setHeader('Expires', '-1');
    res.setHeader('Pragma', 'no-cache');

    logger.info('Serving processed video file:', {
      jobId,
      filePath,
      fileName,
      contentType,
      fileSize: Math.round(fileSize / (1024 * 1024)) + 'MB'
    });

    // Handle range requests for video streaming
    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = (end - start) + 1;

      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
      res.setHeader('Content-Length', chunksize.toString());

      const fileStream = fs.createReadStream(filePath, { start, end });
      fileStream.pipe(res);
    } else {
      // Stream the complete file
      const fileStream = fs.createReadStream(filePath);
      
      fileStream.on('error', (error) => {
        logger.error('Video file stream error:', {
          jobId,
          filePath,
          error: error.message
        });
        
        if (!res.headersSent) {
          res.status(500).json({
            success: false,
            error: {
              code: 'VIDEO_STREAM_ERROR',
              message: 'Error reading processed video file'
            },
            timestamp: new Date().toISOString()
          });
        }
      });

      fileStream.on('end', () => {
        logger.debug('Video file download completed:', { jobId, fileName });
      });

      fileStream.pipe(res);
    }

  } catch (error) {
    logger.error('Error downloading video file:', {
      jobId: req.params.jobId,
      error: error instanceof Error ? error.message : error
    });
    next(error);
  }
});

// GET /jobs/status - Bulk video job status endpoint
router.get('/jobs/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { jobIds } = req.query;

    if (!jobIds || typeof jobIds !== 'string') {
      throw new AppError('Job IDs are required as comma-separated string', 400, 'MISSING_JOB_IDS');
    }

    const jobIdArray = jobIds.split(',').map(id => id.trim()).filter(id => id.length > 0);

    if (jobIdArray.length === 0) {
      throw new AppError('At least one job ID is required', 400, 'INVALID_JOB_IDS');
    }

    if (jobIdArray.length > 20) { // Lower limit for video jobs
      throw new AppError('Too many job IDs (max 20)', 400, 'TOO_MANY_JOB_IDS');
    }

    logger.debug('Getting bulk video job statuses:', { jobIds: jobIdArray });

    const jobStatuses: { [key: string]: any } = {};
    
    for (const jobId of jobIdArray) {
      try {
        const status = await videoWorker.getJobStatus(jobId);
        jobStatuses[jobId] = status ? {
          success: true,
          data: status
        } : {
          success: false,
          error: 'Video job not found'
        };
      } catch (error) {
        jobStatuses[jobId] = {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    }

    const response = {
      success: true,
      data: jobStatuses,
      timestamp: new Date().toISOString()
    };

    res.json(response);
  } catch (error) {
    logger.error('Error getting bulk video job statuses:', {
      error: error instanceof Error ? error.message : error
    });
    next(error);
  }
});

// GET /worker/stats - Video worker statistics endpoint
router.get('/worker/stats', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const stats = videoWorker.getStats();
    const health = await videoWorker.getHealthStatus();

    const response = {
      success: true,
      data: {
        stats,
        health,
        uptime: Date.now() - stats.startTime,
        uptimeFormatted: new Date(Date.now() - stats.startTime).toISOString().substr(11, 8),
        supportedOperations: ['crop', 'watermark'],
        supportedFormats: ['.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.mkv', '.m4v', '.3gp']
      },
      timestamp: new Date().toISOString()
    };

    res.json(response);
  } catch (error) {
    logger.error('Error getting video worker stats:', {
      error: error instanceof Error ? error.message : error
    });
    next(error);
  }
});

// GET /diagnose - Video queue diagnosis endpoint  
router.get('/diagnose', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const stats = videoWorker.getStats();
    const health = await videoWorker.getHealthStatus();
    
    const diagnosis = {
      timestamp: new Date().toISOString(),
      uptime: Date.now() - stats.startTime,
      stats,
      queueHealth: health.queueHealth,
      memoryUsage: health.memoryUsage,
      issues: [] as string[],
      recommendations: [] as string[]
    };

    // Video-specific health checks
    if (health.queueHealth.failed > health.queueHealth.completed) {
      diagnosis.issues.push('High video processing failure rate detected');
      diagnosis.recommendations.push('Check FFmpeg installation and video format compatibility');
    }

    if (health.queueHealth.waiting > 10) { // Lower threshold for video processing
      diagnosis.issues.push('Large video processing queue backlog');
      diagnosis.recommendations.push('Consider increasing video worker concurrency or reducing file size limits');
    }

    if (health.memoryUsage.heapUsed > 1024 * 1024 * 1024) { // 1GB for video processing
      diagnosis.issues.push('High memory usage in video processing');
      diagnosis.recommendations.push('Monitor for memory leaks in video processing and restart if necessary');
    }

    // Check for stuck active jobs (video processing takes longer)
    if (health.queueHealth.active > 0 && stats.lastProcessedAt) {
      const timeSinceLastProcessed = Date.now() - stats.lastProcessedAt;
      if (timeSinceLastProcessed > 30 * 60 * 1000) { // 30 minutes
        diagnosis.issues.push('Video processing jobs may be stuck');
        diagnosis.recommendations.push('Check for hung video processing operations and consider restarting worker');
      }
    }

    res.json({
      success: true,
      data: {
        diagnosis,
        recommendations: generateRecommendations ? generateRecommendations(diagnosis) : diagnosis.recommendations
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error generating video diagnosis:', {
      error: error instanceof Error ? error.message : error
    });
    next(error);
  }
});

// GET /health - Video service health check endpoint
router.get('/health', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const health = await videoWorker.getHealthStatus();
    
    res.json({
      success: true,
      status: health.status,
      service: 'video-processing',
      data: {
        uptime: health.uptime,
        stats: health.stats,
        queue: health.queueHealth,
        memory: {
          used: Math.round(health.memoryUsage.heapUsed / 1024 / 1024),
          total: Math.round(health.memoryUsage.heapTotal / 1024 / 1024),
          external: Math.round(health.memoryUsage.external / 1024 / 1024)
        },
        supportedOperations: ['crop', 'watermark'],
        maxFileSize: '500MB',
        maxDuration: '1 hour'
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error getting video health status:', {
      error: error instanceof Error ? error.message : error
    });
    
    res.status(500).json({
      success: false,
      status: 'unhealthy',
      service: 'video-processing',
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
});

// POST /validate-operations - Validate video operations endpoint
router.post('/validate-operations', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { operations } = req.body;

    if (!operations) {
      throw new AppError('Operations object is required', 400, 'MISSING_OPERATIONS');
    }

    // Basic validation for supported operations
    const supportedOps = ['crop', 'watermark'];
    const providedOps = Object.keys(operations);
    const unsupportedOps = providedOps.filter(op => !supportedOps.includes(op));

    if (unsupportedOps.length > 0) {
      throw new AppError(
        `Unsupported operations: ${unsupportedOps.join(', ')}. Only crop and watermark are supported.`,
        400,
        'UNSUPPORTED_OPERATIONS'
      );
    }

    if (providedOps.length === 0) {
      throw new AppError(
        'At least one operation (crop or watermark) must be specified',
        400,
        'NO_OPERATIONS_SPECIFIED'
      );
    }

    // Validate crop operation
    if (operations.crop) {
      const { startTime, endTime } = operations.crop;
      
      if (typeof startTime !== 'number' || startTime < 0) {
        throw new AppError('Crop start time must be a non-negative number', 400, 'INVALID_CROP_START');
      }
      
      if (typeof endTime !== 'number' || endTime <= startTime) {
        throw new AppError('Crop end time must be greater than start time', 400, 'INVALID_CROP_END');
      }

      if (endTime - startTime > 3600) { // 1 hour max
        throw new AppError('Crop duration cannot exceed 1 hour', 400, 'CROP_TOO_LONG');
      }
    }

    // Validate watermark operation
    if (operations.watermark) {
      if (operations.watermark.type === 'text') {
        if (!operations.watermark.text || typeof operations.watermark.text !== 'string') {
          throw new AppError('Watermark text is required and must be a string', 400, 'INVALID_WATERMARK_TEXT');
        }
        
        if (operations.watermark.text.length > 100) {
          throw new AppError('Watermark text cannot exceed 100 characters', 400, 'WATERMARK_TEXT_TOO_LONG');
        }
      } else if (operations.watermark.type === 'image') {
        if (!operations.watermark.imagePath || typeof operations.watermark.imagePath !== 'string') {
          throw new AppError('Watermark image path is required', 400, 'MISSING_WATERMARK_IMAGE');
        }
      } else {
        throw new AppError('Watermark type must be either "text" or "image"', 400, 'INVALID_WATERMARK_TYPE');
      }
    }

    res.json({
      success: true,
      message: 'Video operations are valid',
      data: {
        operations,
        supportedOperations: ['crop', 'watermark'],
        validationPassed: true
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Video operations validation failed:', {
      operations: req.body.operations,
      error: error instanceof Error ? error.message : error
    });
    next(error);
  }
});

export default router;