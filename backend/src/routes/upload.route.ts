import express, { Request, Response, NextFunction } from 'express';
import { upload, handleMulterError } from '../middlewares/upload';
import { handleUpload } from '../controllers/uploadcontroller';
import { imageWorker } from '../wokers/image.worker';
import fs from 'fs';
import path from 'path';
import { AppError } from '../utils/error';
import logger from '../utils/logger';

const router = express.Router();

// POST / (will become /upload when mounted)
router.post('/', upload.single('image'), handleMulterError, handleUpload);

// GET /job/:jobId/status (will become /upload/job/:jobId/status when mounted)
router.get('/job/:jobId/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { jobId } = req.params;

    if (!jobId) {
      throw new AppError('Job ID is required', 400, 'MISSING_JOB_ID');
    }

    logger.debug('Getting job status:', { jobId });

    const jobStatus = await imageWorker.getJobStatus(jobId);

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
          format: jobStatus.result?.format || 'unknown',
          width: jobStatus.result?.width || 0,
          height: jobStatus.result?.height || 0,
          operations: jobStatus.result?.operations || []
        } : undefined,
        error: jobStatus.error || undefined,
        failedReason: jobStatus.failedReason || undefined,
        createdAt: jobStatus.createdAt,
        processedAt: jobStatus.processedAt
      },
      timestamp: new Date().toISOString()
    };

    logger.debug('Job status response:', { jobId, status: jobStatus.status });
    res.json(response);
  } catch (error) {
    logger.error('Error getting job status:', {
      jobId: req.params.jobId,
      error: error instanceof Error ? error.message : error
    });
    next(error);
  }
});

// GET /job/:jobId/download (will become /upload/job/:jobId/download when mounted)
router.get('/job/:jobId/download', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { jobId } = req.params;

    if (!jobId) {
      throw new AppError('Job ID is required', 400, 'MISSING_JOB_ID');
    }

    logger.debug('Download request for job:', { jobId });

    const jobStatus = await imageWorker.getJobStatus(jobId);

    if (!jobStatus) {
      throw new AppError('Job not found', 404, 'JOB_NOT_FOUND');
    }

    if (jobStatus.status !== 'completed') {
      throw new AppError(
        `Job is not completed yet. Current status: ${jobStatus.status}`,
        400,
        'JOB_NOT_COMPLETED'
      );
    }

    if (!jobStatus.outputPath) {
      throw new AppError('Processed file not found', 404, 'FILE_NOT_FOUND');
    }

    // Check if file exists using the worker's method
    const fileCheck = await imageWorker.checkProcessedFile(jobId);
    
    if (!fileCheck.exists || !fileCheck.filePath) {
      throw new AppError('Processed file not found on disk', 404, 'FILE_NOT_FOUND');
    }

    const filePath = fileCheck.filePath;
    const fileName = jobStatus.processedFileName || `processed-${jobId}.jpg`;

    // Determine content type based on file extension
    const ext = path.extname(filePath).toLowerCase();
    let contentType = 'application/octet-stream';

    switch (ext) {
      case '.jpg':
      case '.jpeg':
        contentType = 'image/jpeg';
        break;
      case '.png':
        contentType = 'image/png';
        break;
      case '.gif':
        contentType = 'image/gif';
        break;
      case '.webp':
        contentType = 'image/webp';
        break;
      case '.avif':
        contentType = 'image/avif';
        break;
      case '.tiff':
      case '.tif':
        contentType = 'image/tiff';
        break;
      default:
        contentType = 'application/octet-stream';
    }

    // Set response headers
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', fileCheck.fileSize || 0);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    res.setHeader('Expires', '-1');
    res.setHeader('Pragma', 'no-cache');

    logger.info('Serving processed file:', {
      jobId,
      filePath,
      fileName,
      contentType,
      fileSize: fileCheck.fileSize
    });

    // Stream the file
    const fileStream = fs.createReadStream(filePath);
    
    fileStream.on('error', (error) => {
      logger.error('File stream error:', {
        jobId,
        filePath,
        error: error.message
      });
      
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: {
            code: 'FILE_STREAM_ERROR',
            message: 'Error reading processed file'
          },
          timestamp: new Date().toISOString()
        });
      }
    });

    fileStream.on('end', () => {
      logger.debug('File download completed:', { jobId, fileName });
    });

    // Pipe the file to the response
    fileStream.pipe(res);

  } catch (error) {
    logger.error('Error downloading file:', {
      jobId: req.params.jobId,
      error: error instanceof Error ? error.message : error
    });
    next(error);
  }
});

// GET /jobs/status - Bulk job status endpoint
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

    if (jobIdArray.length > 50) { // Limit to prevent abuse
      throw new AppError('Too many job IDs (max 50)', 400, 'TOO_MANY_JOB_IDS');
    }

    logger.debug('Getting bulk job statuses:', { jobIds: jobIdArray });

    const jobStatuses = await imageWorker.getJobStatuses(jobIdArray);

    const response = {
      success: true,
      data: jobStatuses,
      timestamp: new Date().toISOString()
    };

    res.json(response);
  } catch (error) {
    logger.error('Error getting bulk job statuses:', {
      error: error instanceof Error ? error.message : error
    });
    next(error);
  }
});

// GET /worker/stats - Worker statistics endpoint
router.get('/worker/stats', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const stats = imageWorker.getStats();
    const health = await imageWorker.getHealthStatus();

    const response = {
      success: true,
      data: {
        stats,
        health,
        uptime: Date.now() - stats.startTime,
        uptimeFormatted: new Date(Date.now() - stats.startTime).toISOString().substr(11, 8)
      },
      timestamp: new Date().toISOString()
    };

    res.json(response);
  } catch (error) {
    logger.error('Error getting worker stats:', {
      error: error instanceof Error ? error.message : error
    });
    next(error);
  }
});

export default router;