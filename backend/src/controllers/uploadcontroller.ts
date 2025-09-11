import { Request, Response, NextFunction, Router } from "express";
import path from "path";
import fs from "fs/promises";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import { ZodError, z } from "zod";
import {
  imageQueue,
  ImageJobPayload,
  ImageJobType,
  JobPriority,
  ImageOperations,
} from "../config/bullmq";
import logger from "../utils/logger";
import { AppError } from "../utils/error";
import { FileValidationService } from "../service/validationservice";
import { ImageConfigUtils, IMAGE_CONFIG } from "../config/image.config";
import { upload } from '../middlewares/upload';

/* ------------------- Multer Setup ------------------- */
const upload = multer({ dest: "uploads/" });

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
interface MulterRequest extends Omit<Request, "file"|"files"> {
  file?: MulterFile;
  files?:MulterFile[];
}

/* ------------------- Zod Schema ------------------- */
const operationsSchema = z
  .object({
    crop: z
      .object({
        x: z.number().min(0),
        y: z.number().min(0).max(IMAGE_CONFIG.DIMENSION_LIMITS.MAX_HEIGHT),
        width: z.number().positive().max(IMAGE_CONFIG.DIMENSION_LIMITS.MAX_WIDTH),
        height: z.number().positive().max(IMAGE_CONFIG.DIMENSION_LIMITS.MAX_HEIGHT),
      })
      .optional(),

    resize: z
      .object({
        width: z.number().positive().max(IMAGE_CONFIG.DIMENSION_LIMITS.MAX_WIDTH).optional(),
        height: z.number().positive().max(IMAGE_CONFIG.DIMENSION_LIMITS.MAX_HEIGHT).optional(),
        fit: z.enum(["cover", "contain", "fill", "inside", "outside"]).default("cover"),
        position: z.enum(["centre", "top", "right", "left", "bottom"]).default("centre"),
      })
      .refine((data) => data.width || data.height, {
        message: "At least width or height must be specified for resize operation",
      })
      .optional(),

    rotate: z.number().min(-360).max(360).optional(),
    quality: z.number().min(1).max(100).optional(),
    blur: z.number().min(0.3).max(1000).optional(),
    sharpen: z.number().optional(),
    grayscale: z.boolean().optional(),
    format: z.enum(['jpeg', 'png', 'webp', 'avif', 'tiff', 'gif']).optional(),
    
    // NEW: Add these missing operations
    flip: z.boolean().optional(),
    flop: z.boolean().optional(),
    brightness: z.number().min(-100).max(100).optional(),
    contrast: z.number().min(-100).max(100).optional(),
    saturation: z.number().min(-100).max(100).optional(),
    hue: z.number().min(-360).max(360).optional(),
    gamma: z.number().min(0.1).max(3.0).optional(),
    sepia: z.boolean().optional(),
    negate: z.boolean().optional(),
    normalize: z.boolean().optional(),
    progressive: z.boolean().optional(),
    lossless: z.boolean().optional(),
    compression: z.number().min(0).max(9).optional(),
    
    watermark: z.discriminatedUnion("type", [
      z.object({
        type: z.literal("text"),
        text: z.string().min(1).max(100),
        fontSize: z.number().min(8).max(200).optional(),
        fontFamily: z.string().optional(),
        color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
        opacity: z.number().min(0.1).max(1).optional(),
        gravity: z.enum(["north", "south", "east", "west", "center", "top-left", "top-right", "bottom-left", "bottom-right"]).optional(),
        dx: z.number().optional(),
        dy: z.number().optional(),
      }),
      z.object({
        type: z.literal("image"),
        imagePath: z.string().min(1),
        width: z.number().positive().optional(),
        height: z.number().positive().optional(),
        opacity: z.number().min(0.1).max(1).optional(),
        gravity: z.enum(["north", "south", "east", "west", "center", "top-left", "top-right", "bottom-left", "bottom-right"]).optional(),
        dx: z.number().optional(),
        dy: z.number().optional(),
      })
    ]).optional(),
  })
  .optional();

/* ------------------- Core Upload Handler ------------------- */
export async function handleUpload(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const startTime = Date.now();
  const requestId = req.headers["x-request-id"] || `req-${Date.now()}`;
  const uploadedFilePaths: string[] = [];

  try {
    const files = req.files as MulterFile[];
    if (!files || files.length === 0) {
      throw new AppError("No files uploaded", 400, "MISSING_FILES");
    }

    const jobResults: any[] = [];

    for (const file of files) {
      uploadedFilePaths.push(file.path);

      console.log("=== FILE UPLOAD START ===");
      console.log("Original name:", file.originalname);
      console.log("File path:", file.path);
      console.log("File size:", file.size);
      console.log("MIME type:", file.mimetype);
      console.log("=========================");

      // ✅ Validate file
      await FileValidationService.validateFile({
        path: file.path,
        originalName: file.originalname,
        size: file.size,
        mimeType: file.mimetype,
      });
      console.log("✅ File validation passed");

      // ✅ Parse operations (if provided)
      let operations: ImageOperations | undefined;
      if (req.body.operations) {
        try {
          const rawOps =
            typeof req.body.operations === "string"
              ? JSON.parse(req.body.operations)
              : req.body.operations;

          console.log("Raw operations:", rawOps);

          const parsedOps = operationsSchema.parse(rawOps);
          operations = parsedOps as ImageOperations;

          console.log("✅ Operations parsed:", operations);

          await validateImageOperations(operations, {
            fileSize: file.size,
            mimeType: file.mimetype,
            fileName: file.originalname,
          });

          console.log("✅ Operations validation passed");
        } catch (err) {
          console.error("❌ Operations parsing/validation failed:", err);
          await cleanUploadedFile(file.path);

          if (err instanceof ZodError) {
            throw new AppError(
              "Invalid image operations",
              400,
              "INVALID_OPERATIONS",
              {
                validationErrors: err.issues.map((i) => ({
                  field: i.path.join("."),
                  message: i.message,
                })),
              }
            );
          }
          throw new AppError(
            "Invalid operations format",
            400,
            "OPERATIONS_PARSE_ERROR"
          );
        }
      }

      // ✅ Build job payload
      const payload: ImageJobPayload = {
        filePath: path.resolve(file.path),
        originalName: file.originalname,
        fileSize: file.size,
        mimeType: file.mimetype,
        uploadedAt: new Date(),
        operations,
      };

      console.log("✅ Job payload created:", {
        filePath: payload.filePath,
        originalName: payload.originalName,
        fileSize: payload.fileSize,
        operations: operations ? Object.keys(operations) : [],
      });

      // ✅ Job priority
      const priority = ImageConfigUtils.determineJobPriority(
        file.size,
        operations ? Object.keys(operations).length : 0
      );

      console.log("Job priority determined:", priority);

      // ✅ Create job
      const jobId = `img-${Date.now()}-${uuidv4()}`;
      const job = await imageQueue.add(ImageJobType.PROCESS_IMAGE, payload, {
        jobId,
        priority:
          priority === "high"
            ? JobPriority.HIGH
            : priority === "low"
            ? JobPriority.LOW
            : JobPriority.NORMAL,
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: IMAGE_CONFIG.WORKER.TIMEOUTS.RETRY_DELAY,
        },
        removeOnComplete: IMAGE_CONFIG.WORKER.QUEUE_LIMITS.MAX_COMPLETED_JOBS,
        removeOnFail: IMAGE_CONFIG.WORKER.QUEUE_LIMITS.MAX_FAILED_JOBS,
      });

      console.log("✅ Job created successfully:", job.id);

      logger.info("Image processing job enqueued", {
        jobId: job.id,
        requestId,
        filename: file.originalname,
        fileSize: file.size,
        operations: operations ? Object.keys(operations) : [],
        priority,
        time: Date.now() - startTime,
      });

      console.log("=== UPLOAD COMPLETED ===");
      console.log("Job ID:", job.id);
      console.log("File will be processed and cleaned up automatically");
      console.log("========================");

      jobResults.push({
        jobId: job.id,
        fileName: file.originalname,
        estimatedProcessingTime: ImageConfigUtils.estimateProcessingTime(
          file.size,
          operations
        ),
        queuePosition: await getQueuePosition(job.id as string),
        priority,
      });
    }

    // ✅ Respond with all jobs
    res.status(202).json({
      success: true,
      message: "Files uploaded and queued for processing",
      data: jobResults,
    });
  } catch (error) {
    console.error("❌ Upload failed:", error);

    // Cleanup uploaded files on error
    for (const filePath of uploadedFilePaths) {
      await cleanUploadedFile(filePath);
      console.log("🧹 Cleaned up uploaded file due to error:", filePath);
    }

    next(error);
  }
}


/* ------------------- Validation Helper ------------------- */
async function validateImageOperations(
  operations: ImageOperations | undefined,
  fileInfo: { fileSize: number; mimeType: string; fileName: string }
): Promise<void> {
  if (!operations) return;
  
  if (Object.keys(operations).length > IMAGE_CONFIG.PROCESSING_LIMITS.MAX_OPERATIONS) {
    throw new AppError("Too many operations", 400, "TOO_MANY_OPERATIONS");
  }
  
  if (operations.format) {
    const supported = IMAGE_CONFIG.FORMATS.OUTPUT_FORMATS as readonly string[];
    if (!supported.includes(operations.format)) {
      throw new AppError("Unsupported format", 400, "UNSUPPORTED_FORMAT");
    }
  }
  
  // Existing validation...
  if (operations.resize) {
    const { width, height } = operations.resize;
    if (width && width > IMAGE_CONFIG.DIMENSION_LIMITS.MAX_WIDTH) {
      throw new AppError("Resize width too large", 400, "INVALID_RESIZE_WIDTH");
    }
    if (height && height > IMAGE_CONFIG.DIMENSION_LIMITS.MAX_HEIGHT) {
      throw new AppError("Resize height too large", 400, "INVALID_RESIZE_HEIGHT");
    }
  }
  
  if (operations.crop) {
    const { x, y, width, height } = operations.crop;
    if (x < 0 || y < 0 || width <= 0 || height <= 0) {
      throw new AppError("Invalid crop coordinates", 400, "INVALID_CROP");
    }
  }

  // NEW: Add validation for new operations
  if (operations.brightness !== undefined) {
    if (operations.brightness < -100 || operations.brightness > 100) {
      throw new AppError("Brightness must be between -100 and 100", 400, "INVALID_BRIGHTNESS");
    }
  }

  if (operations.contrast !== undefined) {
    if (operations.contrast < -100 || operations.contrast > 100) {
      throw new AppError("Contrast must be between -100 and 100", 400, "INVALID_CONTRAST");
    }
  }

  if (operations.saturation !== undefined) {
    if (operations.saturation < -100 || operations.saturation > 100) {
      throw new AppError("Saturation must be between -100 and 100", 400, "INVALID_SATURATION");
    }
  }

  if (operations.hue !== undefined) {
    if (operations.hue < -360 || operations.hue > 360) {
      throw new AppError("Hue must be between -360 and 360", 400, "INVALID_HUE");
    }
  }

  if (operations.gamma !== undefined) {
    if (operations.gamma < 0.1 || operations.gamma > 3.0) {
      throw new AppError("Gamma must be between 0.1 and 3.0", 400, "INVALID_GAMMA");
    }
  }

  if (operations.compression !== undefined) {
    if (operations.compression < 0 || operations.compression > 9) {
      throw new AppError("Compression must be between 0 and 9", 400, "INVALID_COMPRESSION");
    }
  }

  // Watermark validation
  if (operations.watermark) {
    if (operations.watermark.type === "text" && (!operations.watermark.text || operations.watermark.text.trim().length === 0)) {
      throw new AppError("Watermark text cannot be empty", 400, "INVALID_WATERMARK_TEXT");
    }
    
    if (operations.watermark.type === "image" && !operations.watermark.imagePath) {
      throw new AppError("Watermark image path is required", 400, "INVALID_WATERMARK_IMAGE");
    }
  }
  
  if (fileInfo.fileSize > IMAGE_CONFIG.PERFORMANCE.LARGE_FILE_THRESHOLD) {
    logger.info("Large file operation", {
      fileName: fileInfo.fileName,
      fileSize: fileInfo.fileSize,
      operations: Object.keys(operations),
    });
  }
}

/* ------------------- Helper Functions ------------------- */
async function getQueuePosition(jobId: string): Promise<number> {
  try {
    const waitingJobs = await imageQueue.getWaiting();
    const pos = waitingJobs.findIndex((j) => j.id === jobId);
    return pos === -1 ? 0 : pos + 1;
  } catch {
    return 0;
  }
}

async function cleanUploadedFile(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
    console.log('🧹 Uploaded file cleaned up:', filePath);
  } catch (error) {
    console.warn('⚠️ Failed to cleanup uploaded file:', filePath, error);
  }
}

/* ------------------- Router ------------------- */
export const imageRouter = Router();

// Main upload endpoint
imageRouter.post("/upload", upload.single("image"), handleUpload);

// Health check endpoint
imageRouter.get("/health", async (req, res) => {
  try {
    const queueCounts = await imageQueue.getJobCounts('waiting', 'active', 'completed', 'failed');
    
    res.json({
      success: true,
      status: 'healthy',
      queue: queueCounts,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Job status endpoint
imageRouter.get("/job/:jobId", async (req, res) => {
  try {
    const { jobId } = req.params;
    const job = await imageQueue.getJob(jobId);
    
    if (!job) {
      return res.status(404).json({
        success: false,
        message: "Job not found",
      });
    }
    
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
    }
    
    const response: any = {
      success: true,
      data: {
        jobId,
        status,
        progress,
        createdAt: job.timestamp ? new Date(job.timestamp) : null,
        processedAt: job.processedOn ? new Date(job.processedOn) : null,
        data: job.data,
      }
    };
    
    // Add result for completed jobs
    if (status === 'completed' && job.returnvalue) {
      response.data.result = job.returnvalue;
      response.data.outputPath = job.returnvalue.outputPath;
    }
    
    // Add error for failed jobs
    if (status === 'failed' && job.failedReason) {
      response.data.error = job.failedReason;
    }
    
    res.json(response);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to get job status",
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});


// Queue management endpoints
imageRouter.post("/queue/clean", async (req, res) => {
  try {
    const completed = await imageQueue.clean(24 * 60 * 60 * 1000, 100, 'completed');
    const failed = await imageQueue.clean(7 * 24 * 60 * 60 * 1000, 50, 'failed');
    
    res.json({
      success: true,
      message: "Queue cleaned successfully",
      data: {
        completedCleaned: completed,
        failedCleaned: failed,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to clean queue",
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default imageRouter;
