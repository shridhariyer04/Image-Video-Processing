import {Request, Response, NextFunction} from "express";
import path from "path";
import fs from 'fs/promises';
import {ZodError, z} from 'zod';
import {imageQueue, ImageJobPayload, ImageJobType, JobPriority, ImageOperations} from "../config/bullmq";
import logger from '../utils/logger';
import { AppError } from "../utils/error";
import { FileValidationService } from "../service/validationservice";
import { ImageConfigUtils, IMAGE_CONFIG } from "../config/image.config";

// Define Multer file interface
interface MulterFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  destination: string;
  filename: string;
  path: string;
  size: number;
}

// Extend Express Request to include Multer file - Fixed interface
interface MulterRequest extends Omit<Request, 'file'> {
  file?: MulterFile;
}

// Remove local interfaces - use the ones from bullmq instead
// Import ImageOperations from bullmq config to ensure type consistency

// operation validation schema using centralized config
const operationsSchema = z.object({
  crop: z.object({
    x: z.number().min(0),
    y: z.number().min(0).max(IMAGE_CONFIG.DIMENSION_LIMITS.MAX_HEIGHT), // Fixed: should be min(0) not positive()
    width: z.number().positive().max(IMAGE_CONFIG.DIMENSION_LIMITS.MAX_WIDTH),
    height: z.number().positive().max(IMAGE_CONFIG.DIMENSION_LIMITS.MAX_HEIGHT),
  }).optional(),

  resize: z.object({
    width: z.number().positive().max(IMAGE_CONFIG.DIMENSION_LIMITS.MAX_WIDTH).optional(),
    height: z.number().positive().max(IMAGE_CONFIG.DIMENSION_LIMITS.MAX_HEIGHT).optional(),
    fit: z.enum(['cover', 'contain', 'fill', 'inside', 'outside']).default('cover'),
    // Fix: Use 'centre' to match bullmq config, or update bullmq to use 'center'
    position: z.enum(['centre', 'top', 'right', 'left', 'bottom']).default('centre')
  }).refine(data => data.width || data.height, {
    message: "At least width or height must be specified for resize operation"
  }).optional(),

  rotate: z.number()
    .min(IMAGE_CONFIG.PROCESSING_LIMITS.MIN_ROTATION)
    .max(IMAGE_CONFIG.PROCESSING_LIMITS.MAX_ROTATION)
    .optional(),
  
  // Fix: Use specific enum values instead of generic z.enum()
  // format: z.enum(IMAGE_CONFIG.FORMATS.OUTPUT_FORMATS as [string, ...string[]]).optional(),
  
  quality: z.number()
    .min(IMAGE_CONFIG.PROCESSING_LIMITS.MIN_QUALITY)
    .max(IMAGE_CONFIG.PROCESSING_LIMITS.MAX_QUALITY)
    .optional(),
  
  blur: z.number()
    .min(IMAGE_CONFIG.PROCESSING_LIMITS.MIN_BLUR)
    .max(IMAGE_CONFIG.PROCESSING_LIMITS.MAX_BLUR)
    .optional(),
  
  sharpen: z.number().optional(),
  grayscale: z.boolean().optional(),
}).optional();

export async function handleUpload(req: MulterRequest, res: Response, next: NextFunction): Promise<void> {
  const startTime = Date.now();
  const requestId = req.headers['x-request-id'] || `req-${Date.now()}`;

  try {
    const file = req.file;

    if (!file) {
      throw new AppError('No file uploaded', 400, 'MISSING_FILE');
    }

    await FileValidationService.validateFile({
      path: file.path,
      originalName: file.originalname,
      size: file.size,
      mimeType: file.mimetype
    });

    let operations: ImageOperations | undefined;

    if (req.body.operations) {
      try {
        const rawOperations = typeof req.body.operations === 'string' ? 
          JSON.parse(req.body.operations) : req.body.operations;

        // Parse with Zod and then cast to ImageOperations
        const parsedOperations = operationsSchema.parse(rawOperations);
        operations = parsedOperations as ImageOperations;

        // Additional validation for operations
        await validateImageOperations(operations, {
          fileSize: file.size,
          mimeType: file.mimetype,
          fileName: file.originalname,
        });

      } catch (error) {
        await cleanUploadedFile(file.path);

        if (error instanceof ZodError) {
          const validationErrors = error.issues.map(err => ({
            field: err.path.join('.'),
            message: err.message,
          }));

          logger.warn('Invalid operations provided', {
            requestId,
            validationErrors,
            filename: file.originalname
          });

          throw new AppError('Invalid image operations', 400, 'INVALID_OPERATIONS', {
            validationErrors,
          });
        }
        
        logger.warn('Operations parsing failed', { requestId, error });
        throw new AppError('Invalid operations format', 400, 'OPERATIONS_PARSE_ERROR');
      }
    }

    const payload: ImageJobPayload = {
      filePath: path.resolve(file.path),
      originalName: file.originalname,
      fileSize: file.size,
      mimeType: file.mimetype,
      uploadedAt: new Date(),
      operations, // This should now work without type errors
    };

    // Determine job priority using centralized logic
    const priority = ImageConfigUtils.determineJobPriority(
      file.size,
      operations ? Object.keys(operations).length : 0
    );

    const job = await imageQueue.add(
      ImageJobType.PROCESS_IMAGE,
      payload,
      {
        priority: priority === 'high' ? JobPriority.HIGH :
          priority === 'low' ? JobPriority.LOW : JobPriority.NORMAL,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: IMAGE_CONFIG.WORKER.TIMEOUTS.RETRY_DELAY,
        },
        removeOnComplete: IMAGE_CONFIG.WORKER.QUEUE_LIMITS.MAX_COMPLETED_JOBS,
        removeOnFail: IMAGE_CONFIG.WORKER.QUEUE_LIMITS.MAX_FAILED_JOBS,
        delay: 0,
        jobId: `img-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        timestamp: Date.now(),
      }
    );

    logger.info('Image processing job enqueued successfully', {
      jobId: job.id,
      requestId,
      filename: file.originalname,
      fileSize: file.size,
      mimeType: file.mimetype,
      operations: operations ? Object.keys(operations) : [],
      priority,
      processingTime: Date.now() - startTime,
    });

    res.status(202).json({
      success: true,
      message: 'File uploaded and queued for processing',
      data: {
        jobId: job.id,
        fileName: file.originalname,
        fileSize: file.size,
        mimeType: file.mimetype,
        estimatedProcessingTime: ImageConfigUtils.estimateProcessingTime(file.size, operations),
        queuePosition: await getQueuePosition(job.id as string),
        priority,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    if (req.file?.path) {
      await cleanUploadedFile(req.file.path);
    }

    logger.error('Upload handle error', {
      error: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined,
      requestId,
      fileName: req.file?.originalname,
      processingTime: Date.now() - startTime,
    });

    next(error);
  }
}

async function validateImageOperations(
  operations: ImageOperations | undefined,
  fileInfo: { fileSize: number; mimeType: string; fileName: string }
): Promise<void> {
  if (!operations) return;

  const operationsCount = Object.keys(operations).length;
  
  // Check maximum operations limit
  if (operationsCount > IMAGE_CONFIG.PROCESSING_LIMITS.MAX_OPERATIONS) {
    throw new AppError(
      `Too many operations (max ${IMAGE_CONFIG.PROCESSING_LIMITS.MAX_OPERATIONS})`,
      400,
      'TOO_MANY_OPERATIONS'
    );
  }

  // Validate format conversion support - Remove this section if method doesn't exist
  if (operations.format) {
    // Fix: Type assertion to ensure TypeScript knows it's one of the valid formats
    const format = operations.format as typeof IMAGE_CONFIG.FORMATS.OUTPUT_FORMATS[number];
    
    // Alternative: Basic format validation with proper typing
    const supportedFormats = IMAGE_CONFIG.FORMATS.OUTPUT_FORMATS as readonly string[];
    if (!supportedFormats.includes(format)) {
      throw new AppError(
        `Format ${format} is not supported`,
        400,
        'UNSUPPORTED_FORMAT'
      );
    }
  }

  // Validate crop dimensions don't exceed file constraints
  if (operations.crop) {
    const { crop } = operations;
    if (crop.width > IMAGE_CONFIG.DIMENSION_LIMITS.MAX_WIDTH || 
        crop.height > IMAGE_CONFIG.DIMENSION_LIMITS.MAX_HEIGHT) {
      throw new AppError(
        `Crop dimensions exceed maximum limits`,
        400,
        'CROP_DIMENSIONS_EXCEEDED'
      );
    }
  }

  // Large file operation warnings
  if (fileInfo.fileSize > IMAGE_CONFIG.PERFORMANCE.LARGE_FILE_THRESHOLD) {
    logger.info('Large file processing requested', {
      fileName: fileInfo.fileName,
      fileSize: fileInfo.fileSize,
      operations: Object.keys(operations),
    });
  }
}

/* Queue position */
async function getQueuePosition(jobId: string): Promise<number> {
  try {
    const waitingJobs = await imageQueue.getWaiting();
    const position = waitingJobs.findIndex(job => job.id === jobId);

    return position === -1 ? 0 : position + 1;
  } catch (error) {
    logger.warn('Failed to get queue position:', { jobId, error });
    return 0;
  }
}

/* Cleanup uploaded file */
async function cleanUploadedFile(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
    logger.debug('Cleaned up uploaded file', { filePath });
  } catch (cleanupError) {
    logger.warn('Failed to cleanup uploaded file', {
      filePath,
      error: cleanupError
    });
  }
}