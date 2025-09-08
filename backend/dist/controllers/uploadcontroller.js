"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.imageRouter = void 0;
exports.handleUpload = handleUpload;
const express_1 = require("express");
const path_1 = __importDefault(require("path"));
const promises_1 = __importDefault(require("fs/promises"));
const multer_1 = __importDefault(require("multer"));
const uuid_1 = require("uuid");
const zod_1 = require("zod");
const bullmq_1 = require("../config/bullmq");
const logger_1 = __importDefault(require("../utils/logger"));
const error_1 = require("../utils/error");
const validationservice_1 = require("../service/validationservice");
const image_config_1 = require("../config/image.config");
/* ------------------- Multer Setup ------------------- */
const upload = (0, multer_1.default)({ dest: "uploads/" });
/* ------------------- Zod Schema ------------------- */
const operationsSchema = zod_1.z
    .object({
    crop: zod_1.z
        .object({
        x: zod_1.z.number().min(0),
        y: zod_1.z.number().min(0).max(image_config_1.IMAGE_CONFIG.DIMENSION_LIMITS.MAX_HEIGHT),
        width: zod_1.z.number().positive().max(image_config_1.IMAGE_CONFIG.DIMENSION_LIMITS.MAX_WIDTH),
        height: zod_1.z.number().positive().max(image_config_1.IMAGE_CONFIG.DIMENSION_LIMITS.MAX_HEIGHT),
    })
        .optional(),
    resize: zod_1.z
        .object({
        width: zod_1.z.number().positive().max(image_config_1.IMAGE_CONFIG.DIMENSION_LIMITS.MAX_WIDTH).optional(),
        height: zod_1.z.number().positive().max(image_config_1.IMAGE_CONFIG.DIMENSION_LIMITS.MAX_HEIGHT).optional(),
        fit: zod_1.z.enum(["cover", "contain", "fill", "inside", "outside"]).default("cover"),
        position: zod_1.z.enum(["centre", "top", "right", "left", "bottom"]).default("centre"),
    })
        .refine((data) => data.width || data.height, {
        message: "At least width or height must be specified for resize operation",
    })
        .optional(),
    rotate: zod_1.z.number().min(-360).max(360).optional(),
    quality: zod_1.z.number().min(1).max(100).optional(),
    blur: zod_1.z.number().min(0.3).max(1000).optional(),
    sharpen: zod_1.z.number().optional(),
    grayscale: zod_1.z.boolean().optional(),
    format: zod_1.z.enum(['jpeg', 'png', 'webp', 'avif', 'tiff', 'gif']).optional(),
    // NEW: Add these missing operations
    flip: zod_1.z.boolean().optional(),
    flop: zod_1.z.boolean().optional(),
    brightness: zod_1.z.number().min(-100).max(100).optional(),
    contrast: zod_1.z.number().min(-100).max(100).optional(),
    saturation: zod_1.z.number().min(-100).max(100).optional(),
    hue: zod_1.z.number().min(-360).max(360).optional(),
    gamma: zod_1.z.number().min(0.1).max(3.0).optional(),
    sepia: zod_1.z.boolean().optional(),
    negate: zod_1.z.boolean().optional(),
    normalize: zod_1.z.boolean().optional(),
    progressive: zod_1.z.boolean().optional(),
    lossless: zod_1.z.boolean().optional(),
    compression: zod_1.z.number().min(0).max(9).optional(),
    watermark: zod_1.z.discriminatedUnion("type", [
        zod_1.z.object({
            type: zod_1.z.literal("text"),
            text: zod_1.z.string().min(1).max(100),
            fontSize: zod_1.z.number().min(8).max(200).optional(),
            fontFamily: zod_1.z.string().optional(),
            color: zod_1.z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
            opacity: zod_1.z.number().min(0.1).max(1).optional(),
            gravity: zod_1.z.enum(["north", "south", "east", "west", "center", "top-left", "top-right", "bottom-left", "bottom-right"]).optional(),
            dx: zod_1.z.number().optional(),
            dy: zod_1.z.number().optional(),
        }),
        zod_1.z.object({
            type: zod_1.z.literal("image"),
            imagePath: zod_1.z.string().min(1),
            width: zod_1.z.number().positive().optional(),
            height: zod_1.z.number().positive().optional(),
            opacity: zod_1.z.number().min(0.1).max(1).optional(),
            gravity: zod_1.z.enum(["north", "south", "east", "west", "center", "top-left", "top-right", "bottom-left", "bottom-right"]).optional(),
            dx: zod_1.z.number().optional(),
            dy: zod_1.z.number().optional(),
        })
    ]).optional(),
})
    .optional();
/* ------------------- Core Upload Handler ------------------- */
async function handleUpload(req, res, next) {
    const startTime = Date.now();
    const requestId = req.headers["x-request-id"] || `req-${Date.now()}`;
    const uploadedFilePaths = [];
    try {
        const files = req.files;
        if (!files || files.length === 0) {
            throw new error_1.AppError("No files uploaded", 400, "MISSING_FILES");
        }
        const jobResults = [];
        for (const file of files) {
            uploadedFilePaths.push(file.path);
            console.log("=== FILE UPLOAD START ===");
            console.log("Original name:", file.originalname);
            console.log("File path:", file.path);
            console.log("File size:", file.size);
            console.log("MIME type:", file.mimetype);
            console.log("=========================");
            // ✅ Validate file
            await validationservice_1.FileValidationService.validateFile({
                path: file.path,
                originalName: file.originalname,
                size: file.size,
                mimeType: file.mimetype,
            });
            console.log("✅ File validation passed");
            // ✅ Parse operations (if provided)
            let operations;
            if (req.body.operations) {
                try {
                    const rawOps = typeof req.body.operations === "string"
                        ? JSON.parse(req.body.operations)
                        : req.body.operations;
                    console.log("Raw operations:", rawOps);
                    const parsedOps = operationsSchema.parse(rawOps);
                    operations = parsedOps;
                    console.log("✅ Operations parsed:", operations);
                    await validateImageOperations(operations, {
                        fileSize: file.size,
                        mimeType: file.mimetype,
                        fileName: file.originalname,
                    });
                    console.log("✅ Operations validation passed");
                }
                catch (err) {
                    console.error("❌ Operations parsing/validation failed:", err);
                    await cleanUploadedFile(file.path);
                    if (err instanceof zod_1.ZodError) {
                        throw new error_1.AppError("Invalid image operations", 400, "INVALID_OPERATIONS", {
                            validationErrors: err.issues.map((i) => ({
                                field: i.path.join("."),
                                message: i.message,
                            })),
                        });
                    }
                    throw new error_1.AppError("Invalid operations format", 400, "OPERATIONS_PARSE_ERROR");
                }
            }
            // ✅ Build job payload
            const payload = {
                filePath: path_1.default.resolve(file.path),
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
            const priority = image_config_1.ImageConfigUtils.determineJobPriority(file.size, operations ? Object.keys(operations).length : 0);
            console.log("Job priority determined:", priority);
            // ✅ Create job
            const jobId = `img-${Date.now()}-${(0, uuid_1.v4)()}`;
            const job = await bullmq_1.imageQueue.add(bullmq_1.ImageJobType.PROCESS_IMAGE, payload, {
                jobId,
                priority: priority === "high"
                    ? bullmq_1.JobPriority.HIGH
                    : priority === "low"
                        ? bullmq_1.JobPriority.LOW
                        : bullmq_1.JobPriority.NORMAL,
                attempts: 3,
                backoff: {
                    type: "exponential",
                    delay: image_config_1.IMAGE_CONFIG.WORKER.TIMEOUTS.RETRY_DELAY,
                },
                removeOnComplete: image_config_1.IMAGE_CONFIG.WORKER.QUEUE_LIMITS.MAX_COMPLETED_JOBS,
                removeOnFail: image_config_1.IMAGE_CONFIG.WORKER.QUEUE_LIMITS.MAX_FAILED_JOBS,
            });
            console.log("✅ Job created successfully:", job.id);
            logger_1.default.info("Image processing job enqueued", {
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
                estimatedProcessingTime: image_config_1.ImageConfigUtils.estimateProcessingTime(file.size, operations),
                queuePosition: await getQueuePosition(job.id),
                priority,
            });
        }
        // ✅ Respond with all jobs
        res.status(202).json({
            success: true,
            message: "Files uploaded and queued for processing",
            data: jobResults,
        });
    }
    catch (error) {
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
async function validateImageOperations(operations, fileInfo) {
    if (!operations)
        return;
    if (Object.keys(operations).length > image_config_1.IMAGE_CONFIG.PROCESSING_LIMITS.MAX_OPERATIONS) {
        throw new error_1.AppError("Too many operations", 400, "TOO_MANY_OPERATIONS");
    }
    if (operations.format) {
        const supported = image_config_1.IMAGE_CONFIG.FORMATS.OUTPUT_FORMATS;
        if (!supported.includes(operations.format)) {
            throw new error_1.AppError("Unsupported format", 400, "UNSUPPORTED_FORMAT");
        }
    }
    // Existing validation...
    if (operations.resize) {
        const { width, height } = operations.resize;
        if (width && width > image_config_1.IMAGE_CONFIG.DIMENSION_LIMITS.MAX_WIDTH) {
            throw new error_1.AppError("Resize width too large", 400, "INVALID_RESIZE_WIDTH");
        }
        if (height && height > image_config_1.IMAGE_CONFIG.DIMENSION_LIMITS.MAX_HEIGHT) {
            throw new error_1.AppError("Resize height too large", 400, "INVALID_RESIZE_HEIGHT");
        }
    }
    if (operations.crop) {
        const { x, y, width, height } = operations.crop;
        if (x < 0 || y < 0 || width <= 0 || height <= 0) {
            throw new error_1.AppError("Invalid crop coordinates", 400, "INVALID_CROP");
        }
    }
    // NEW: Add validation for new operations
    if (operations.brightness !== undefined) {
        if (operations.brightness < -100 || operations.brightness > 100) {
            throw new error_1.AppError("Brightness must be between -100 and 100", 400, "INVALID_BRIGHTNESS");
        }
    }
    if (operations.contrast !== undefined) {
        if (operations.contrast < -100 || operations.contrast > 100) {
            throw new error_1.AppError("Contrast must be between -100 and 100", 400, "INVALID_CONTRAST");
        }
    }
    if (operations.saturation !== undefined) {
        if (operations.saturation < -100 || operations.saturation > 100) {
            throw new error_1.AppError("Saturation must be between -100 and 100", 400, "INVALID_SATURATION");
        }
    }
    if (operations.hue !== undefined) {
        if (operations.hue < -360 || operations.hue > 360) {
            throw new error_1.AppError("Hue must be between -360 and 360", 400, "INVALID_HUE");
        }
    }
    if (operations.gamma !== undefined) {
        if (operations.gamma < 0.1 || operations.gamma > 3.0) {
            throw new error_1.AppError("Gamma must be between 0.1 and 3.0", 400, "INVALID_GAMMA");
        }
    }
    if (operations.compression !== undefined) {
        if (operations.compression < 0 || operations.compression > 9) {
            throw new error_1.AppError("Compression must be between 0 and 9", 400, "INVALID_COMPRESSION");
        }
    }
    // Watermark validation
    if (operations.watermark) {
        if (operations.watermark.type === "text" && (!operations.watermark.text || operations.watermark.text.trim().length === 0)) {
            throw new error_1.AppError("Watermark text cannot be empty", 400, "INVALID_WATERMARK_TEXT");
        }
        if (operations.watermark.type === "image" && !operations.watermark.imagePath) {
            throw new error_1.AppError("Watermark image path is required", 400, "INVALID_WATERMARK_IMAGE");
        }
    }
    if (fileInfo.fileSize > image_config_1.IMAGE_CONFIG.PERFORMANCE.LARGE_FILE_THRESHOLD) {
        logger_1.default.info("Large file operation", {
            fileName: fileInfo.fileName,
            fileSize: fileInfo.fileSize,
            operations: Object.keys(operations),
        });
    }
}
/* ------------------- Helper Functions ------------------- */
async function getQueuePosition(jobId) {
    try {
        const waitingJobs = await bullmq_1.imageQueue.getWaiting();
        const pos = waitingJobs.findIndex((j) => j.id === jobId);
        return pos === -1 ? 0 : pos + 1;
    }
    catch {
        return 0;
    }
}
async function cleanUploadedFile(filePath) {
    try {
        await promises_1.default.unlink(filePath);
        console.log('🧹 Uploaded file cleaned up:', filePath);
    }
    catch (error) {
        console.warn('⚠️ Failed to cleanup uploaded file:', filePath, error);
    }
}
/* ------------------- Router ------------------- */
exports.imageRouter = (0, express_1.Router)();
// Main upload endpoint
exports.imageRouter.post("/upload", upload.single("image"), handleUpload);
// Health check endpoint
exports.imageRouter.get("/health", async (req, res) => {
    try {
        const queueCounts = await bullmq_1.imageQueue.getJobCounts('waiting', 'active', 'completed', 'failed');
        res.json({
            success: true,
            status: 'healthy',
            queue: queueCounts,
            timestamp: new Date().toISOString(),
        });
    }
    catch (error) {
        res.status(500).json({
            success: false,
            status: 'unhealthy',
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});
// Job status endpoint
exports.imageRouter.get("/job/:jobId", async (req, res) => {
    try {
        const { jobId } = req.params;
        const job = await bullmq_1.imageQueue.getJob(jobId);
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
        const response = {
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
    }
    catch (error) {
        res.status(500).json({
            success: false,
            message: "Failed to get job status",
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});
// Queue management endpoints
exports.imageRouter.post("/queue/clean", async (req, res) => {
    try {
        const completed = await bullmq_1.imageQueue.clean(24 * 60 * 60 * 1000, 100, 'completed');
        const failed = await bullmq_1.imageQueue.clean(7 * 24 * 60 * 60 * 1000, 50, 'failed');
        res.json({
            success: true,
            message: "Queue cleaned successfully",
            data: {
                completedCleaned: completed,
                failedCleaned: failed,
            },
        });
    }
    catch (error) {
        res.status(500).json({
            success: false,
            message: "Failed to clean queue",
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});
exports.default = exports.imageRouter;
