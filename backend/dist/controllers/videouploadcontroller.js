"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.videoRouter = void 0;
exports.handleVideoUpload = handleVideoUpload;
const express_1 = require("express");
const path_1 = __importDefault(require("path"));
const promises_1 = __importDefault(require("fs/promises"));
const multer_1 = __importDefault(require("multer"));
const uuid_1 = require("uuid");
const zod_1 = require("zod");
const videobullmq_1 = require("../config/videobullmq");
const logger_1 = __importDefault(require("../utils/logger"));
const error_1 = require("../utils/error");
const videovalidationservice_1 = require("../service/videovalidationservice");
const video_image_config_1 = require("../config/video.image.config");
/* ------------------- Multer Setup ------------------- */
const upload = (0, multer_1.default)({ dest: video_image_config_1.VIDEO_CONFIG.VIDEO_UPLOAD_DIR });
/* ------------------- Zod Schema for Video Operations ------------------- */
const videoOperationsSchema = zod_1.z
    .object({
    // Video cropping/trimming operation
    crop: zod_1.z
        .object({
        startTime: zod_1.z.number().min(0), // in seconds
        endTime: zod_1.z.number().positive(),
    })
        .refine((data) => data.endTime > data.startTime, {
        message: "End time must be greater than start time",
    })
        .refine((data) => (data.endTime - data.startTime) >= video_image_config_1.VIDEO_CONFIG.DURATION_LIMITS.MIN_DURATION, {
        message: `Crop duration must be at least ${video_image_config_1.VIDEO_CONFIG.DURATION_LIMITS.MIN_DURATION} second(s)`,
    })
        .refine((data) => (data.endTime - data.startTime) <= video_image_config_1.VIDEO_CONFIG.DURATION_LIMITS.MAX_DURATION, {
        message: `Crop duration cannot exceed ${video_image_config_1.VIDEO_CONFIG.DURATION_LIMITS.MAX_DURATION / 3600} hours`,
    })
        .optional(),
    // Video watermark operation
    watermark: zod_1.z.discriminatedUnion("type", [
        zod_1.z.object({
            type: zod_1.z.literal("text"),
            text: zod_1.z.string().min(1).max(100),
            fontSize: zod_1.z.number().min(8).max(200).optional(),
            fontFamily: zod_1.z.string().optional(),
            color: zod_1.z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
            opacity: zod_1.z.number().min(0.1).max(1).optional(),
            position: zod_1.z.enum(["top-left", "top-right", "bottom-left", "bottom-right", "center"]).optional(),
            x: zod_1.z.number().optional(), // offset from position
            y: zod_1.z.number().optional(), // offset from position
        }),
        zod_1.z.object({
            type: zod_1.z.literal("image"),
            imagePath: zod_1.z.string().min(1),
            width: zod_1.z.number().positive().optional(),
            height: zod_1.z.number().positive().optional(),
            opacity: zod_1.z.number().min(0.1).max(1).optional(),
            position: zod_1.z.enum(["top-left", "top-right", "bottom-left", "bottom-right", "center"]).optional(),
            x: zod_1.z.number().optional(),
            y: zod_1.z.number().optional(),
        })
    ]).optional(),
})
    .refine((data) => data.crop || data.watermark, {
    message: "At least one operation (crop or watermark) must be specified",
})
    .optional();
/* ------------------- Core Upload Handler ------------------- */
async function handleVideoUpload(req, res, next) {
    const startTime = Date.now();
    const requestId = req.headers["x-request-id"] || `video-req-${Date.now()}`;
    const uploadedFilePaths = [];
    try {
        const files = req.files;
        if (!files || files.length === 0) {
            throw new error_1.AppError("No video files uploaded", 400, "MISSING_VIDEO_FILES");
        }
        const jobResults = [];
        for (const file of files) {
            uploadedFilePaths.push(file.path);
            console.log("=== VIDEO UPLOAD START ===");
            console.log("Original name:", file.originalname);
            console.log("File path:", file.path);
            console.log("File size:", file.size, "bytes");
            console.log("MIME type:", file.mimetype);
            console.log("===========================");
            // Validate video file
            await videovalidationservice_1.VideoFileValidationService.validateVideoFile({
                path: file.path,
                originalName: file.originalname,
                size: file.size,
                mimeType: file.mimetype,
            });
            console.log("✅ Video file validation passed");
            // Parse video operations (if provided)
            let operations;
            if (req.body.operations) {
                try {
                    const rawOps = typeof req.body.operations === "string"
                        ? JSON.parse(req.body.operations)
                        : req.body.operations;
                    console.log("Raw video operations:", rawOps);
                    const parsedOps = videoOperationsSchema.parse(rawOps);
                    operations = parsedOps;
                    console.log("✅ Video operations parsed:", operations);
                    await validateVideoOperations(operations, {
                        fileSize: file.size,
                        mimeType: file.mimetype,
                        fileName: file.originalname,
                    });
                    console.log("✅ Video operations validation passed");
                }
                catch (err) {
                    console.error("❌ Video operations parsing/validation failed:", err);
                    await cleanUploadedFile(file.path);
                    if (err instanceof zod_1.ZodError) {
                        throw new error_1.AppError("Invalid video operations", 400, "INVALID_VIDEO_OPERATIONS", {
                            validationErrors: err.issues.map((i) => ({
                                field: i.path.join("."),
                                message: i.message,
                            })),
                        });
                    }
                    throw new error_1.AppError("Invalid video operations format", 400, "VIDEO_OPERATIONS_PARSE_ERROR");
                }
            }
            // Build video job payload
            const payload = {
                filePath: path_1.default.resolve(file.path),
                originalName: file.originalname,
                fileSize: file.size,
                mimeType: file.mimetype,
                uploadedAt: new Date(),
                operations,
            };
            console.log("✅ Video job payload created:", {
                filePath: payload.filePath,
                originalName: payload.originalName,
                fileSize: payload.fileSize,
                operations: operations ? Object.keys(operations) : [],
            });
            // Determine job priority based on file size and estimated duration
            const estimatedDuration = estimateVideoDuration(file.size);
            const priority = video_image_config_1.VideoConfigUtils.determineJobPriority(file.size, estimatedDuration);
            console.log("Video job priority determined:", priority);
            // Create video processing job
            const jobId = `video-${Date.now()}-${(0, uuid_1.v4)()}`;
            const job = await videobullmq_1.videoQueue.add(videobullmq_1.VideoJobType.PROCESS_VIDEO, payload, {
                jobId,
                priority: priority === "high"
                    ? videobullmq_1.JobPriority.HIGH
                    : priority === "low"
                        ? videobullmq_1.JobPriority.LOW
                        : videobullmq_1.JobPriority.NORMAL,
                attempts: 2, // Fewer attempts for large video files
                backoff: {
                    type: "exponential",
                    delay: video_image_config_1.VIDEO_CONFIG.WORKER.TIMEOUTS.RETRY_DELAY,
                },
                removeOnComplete: video_image_config_1.VIDEO_CONFIG.WORKER.QUEUE_LIMITS.MAX_COMPLETED_JOBS,
                removeOnFail: video_image_config_1.VIDEO_CONFIG.WORKER.QUEUE_LIMITS.MAX_FAILED_JOBS,
            });
            console.log("✅ Video job created successfully:", job.id);
            logger_1.default.info("Video processing job enqueued", {
                jobId: job.id,
                requestId,
                filename: file.originalname,
                fileSize: file.size,
                estimatedDuration,
                operations: operations ? Object.keys(operations) : [],
                priority,
                time: Date.now() - startTime,
            });
            console.log("=== VIDEO UPLOAD COMPLETED ===");
            console.log("Job ID:", job.id);
            console.log("Video will be processed and cleaned up automatically");
            console.log("===============================");
            jobResults.push({
                jobId: job.id,
                fileName: file.originalname,
                estimatedProcessingTime: video_image_config_1.VideoConfigUtils.estimateProcessingTime(file.size, estimatedDuration, operations),
                queuePosition: await getQueuePosition(job.id),
                priority,
                supportedOperations: ['crop', 'watermark'],
            });
        }
        // Respond with all video jobs
        res.status(202).json({
            success: true,
            message: "Video files uploaded and queued for processing",
            data: jobResults,
        });
    }
    catch (error) {
        console.error("❌ Video upload failed:", error);
        // Cleanup uploaded files on error
        for (const filePath of uploadedFilePaths) {
            await cleanUploadedFile(filePath);
            console.log("🧹 Cleaned up uploaded video file due to error:", filePath);
        }
        next(error);
    }
}
/* ------------------- Video Operations Validation ------------------- */
async function validateVideoOperations(operations, fileInfo) {
    if (!operations)
        return;
    // Check that only supported operations are present
    const supportedOps = ['crop', 'watermark'];
    const providedOps = Object.keys(operations);
    const unsupportedOps = providedOps.filter(op => !supportedOps.includes(op));
    if (unsupportedOps.length > 0) {
        throw new error_1.AppError(`Unsupported operations: ${unsupportedOps.join(', ')}. Only crop and watermark are supported.`, 400, "UNSUPPORTED_OPERATIONS");
    }
    // Validate that at least one operation is specified
    if (providedOps.length === 0) {
        throw new error_1.AppError("At least one operation (crop or watermark) must be specified", 400, "NO_OPERATIONS_SPECIFIED");
    }
    // Validate maximum number of operations (crop + watermark = max 2)
    if (providedOps.length > video_image_config_1.VIDEO_CONFIG.PROCESSING_LIMITS.MAX_OPERATIONS) {
        throw new error_1.AppError("Too many operations. Only crop and watermark operations are supported.", 400, "TOO_MANY_OPERATIONS");
    }
    // Validate crop operation
    if (operations.crop) {
        const { startTime, endTime } = operations.crop;
        if (startTime < 0) {
            throw new error_1.AppError("Crop start time cannot be negative", 400, "INVALID_CROP_START_TIME");
        }
        if (endTime <= startTime) {
            throw new error_1.AppError("Crop end time must be greater than start time", 400, "INVALID_CROP_END_TIME");
        }
        const duration = endTime - startTime;
        if (duration < video_image_config_1.VIDEO_CONFIG.DURATION_LIMITS.MIN_DURATION) {
            throw new error_1.AppError(`Crop duration must be at least ${video_image_config_1.VIDEO_CONFIG.DURATION_LIMITS.MIN_DURATION} second(s)`, 400, "CROP_DURATION_TOO_SHORT");
        }
        if (duration > video_image_config_1.VIDEO_CONFIG.DURATION_LIMITS.MAX_DURATION) {
            throw new error_1.AppError(`Crop duration cannot exceed ${video_image_config_1.VIDEO_CONFIG.DURATION_LIMITS.MAX_DURATION / 3600} hours`, 400, "CROP_DURATION_TOO_LONG");
        }
    }
    // Validate watermark operation
    if (operations.watermark) {
        if (operations.watermark.type === "text") {
            if (!operations.watermark.text || operations.watermark.text.trim().length === 0) {
                throw new error_1.AppError("Watermark text cannot be empty", 400, "EMPTY_WATERMARK_TEXT");
            }
            if (operations.watermark.text.length > 100) {
                throw new error_1.AppError("Watermark text cannot exceed 100 characters", 400, "WATERMARK_TEXT_TOO_LONG");
            }
            // Validate optional text properties
            if (operations.watermark.fontSize && (operations.watermark.fontSize < 8 || operations.watermark.fontSize > 200)) {
                throw new error_1.AppError("Font size must be between 8 and 200", 400, "INVALID_FONT_SIZE");
            }
            if (operations.watermark.color && !/^#[0-9A-Fa-f]{6}$/.test(operations.watermark.color)) {
                throw new error_1.AppError("Color must be a valid hex code (e.g., #FF0000)", 400, "INVALID_COLOR_FORMAT");
            }
            if (operations.watermark.opacity && (operations.watermark.opacity < 0.1 || operations.watermark.opacity > 1)) {
                throw new error_1.AppError("Opacity must be between 0.1 and 1.0", 400, "INVALID_OPACITY");
            }
        }
        if (operations.watermark.type === "image") {
            if (!operations.watermark.imagePath) {
                throw new error_1.AppError("Watermark image path is required", 400, "MISSING_WATERMARK_IMAGE_PATH");
            }
            // Check if watermark image exists
            try {
                await promises_1.default.access(operations.watermark.imagePath);
            }
            catch {
                throw new error_1.AppError("Watermark image file not found", 400, "WATERMARK_IMAGE_NOT_FOUND");
            }
            // Validate image dimensions if provided
            if (operations.watermark.width && operations.watermark.width <= 0) {
                throw new error_1.AppError("Watermark width must be positive", 400, "INVALID_WATERMARK_WIDTH");
            }
            if (operations.watermark.height && operations.watermark.height <= 0) {
                throw new error_1.AppError("Watermark height must be positive", 400, "INVALID_WATERMARK_HEIGHT");
            }
            if (operations.watermark.opacity && (operations.watermark.opacity < 0.1 || operations.watermark.opacity > 1)) {
                throw new error_1.AppError("Opacity must be between 0.1 and 1.0", 400, "INVALID_OPACITY");
            }
        }
    }
    // Log performance warnings for large files
    if (fileInfo.fileSize > video_image_config_1.VIDEO_CONFIG.PERFORMANCE.LARGE_FILE_THRESHOLD) {
        logger_1.default.warn("Large video file operation", {
            fileName: fileInfo.fileName,
            fileSize: fileInfo.fileSize,
            operations: Object.keys(operations),
        });
    }
}
/* ------------------- Helper Functions ------------------- */
function estimateVideoDuration(fileSize) {
    // Rough estimation: 1MB ≈ 1 second for average quality video
    return Math.max(1, Math.floor(fileSize / (1024 * 1024)));
}
async function getQueuePosition(jobId) {
    try {
        const waitingJobs = await videobullmq_1.videoQueue.getWaiting();
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
        console.log('🧹 Uploaded video file cleaned up:', filePath);
    }
    catch (error) {
        console.warn('⚠️ Failed to cleanup uploaded video file:', filePath, error);
    }
}
/* ------------------- Router Setup ------------------- */
exports.videoRouter = (0, express_1.Router)();
// Main video upload endpoint
exports.videoRouter.post("/upload", upload.array("videos", 10), handleVideoUpload);
// Health check endpoint
exports.videoRouter.get("/health", async (req, res) => {
    try {
        const queueCounts = await videobullmq_1.videoQueue.getJobCounts('waiting', 'active', 'completed', 'failed');
        res.json({
            success: true,
            status: 'healthy',
            service: 'video-processing',
            queue: queueCounts,
            config: {
                maxFileSize: `${video_image_config_1.VIDEO_CONFIG.FILE_LIMITS.MAX_SIZE / (1024 * 1024)}MB`,
                maxDuration: `${video_image_config_1.VIDEO_CONFIG.DURATION_LIMITS.MAX_DURATION / 3600} hours`,
                supportedOperations: ['crop', 'watermark'],
                supportedFormats: video_image_config_1.VIDEO_CONFIG.FORMATS.INPUT_FORMATS,
            },
            timestamp: new Date().toISOString(),
        });
    }
    catch (error) {
        res.status(500).json({
            success: false,
            status: 'unhealthy',
            service: 'video-processing',
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});
// Video job status endpoint
exports.videoRouter.get("/job/:jobId", async (req, res) => {
    try {
        const { jobId } = req.params;
        const job = await videobullmq_1.videoQueue.getJob(jobId);
        if (!job) {
            return res.status(404).json({
                success: false,
                message: "Video job not found",
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
                status = 'processing';
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
            message: "Failed to get video job status",
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});
// Video queue management endpoints
exports.videoRouter.post("/queue/clean", async (req, res) => {
    try {
        const completed = await videobullmq_1.videoQueue.clean(video_image_config_1.VIDEO_CONFIG.WORKER.QUEUE_LIMITS.COMPLETED_JOB_AGE * 1000, video_image_config_1.VIDEO_CONFIG.WORKER.QUEUE_LIMITS.MAX_COMPLETED_JOBS, 'completed');
        const failed = await videobullmq_1.videoQueue.clean(video_image_config_1.VIDEO_CONFIG.WORKER.QUEUE_LIMITS.FAILED_JOB_AGE * 1000, video_image_config_1.VIDEO_CONFIG.WORKER.QUEUE_LIMITS.MAX_FAILED_JOBS, 'failed');
        res.json({
            success: true,
            message: "Video queue cleaned successfully",
            data: {
                completedCleaned: completed,
                failedCleaned: failed,
            },
        });
    }
    catch (error) {
        res.status(500).json({
            success: false,
            message: "Failed to clean video queue",
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});
// Validate operations endpoint (utility)
exports.videoRouter.post("/validate-operations", async (req, res) => {
    try {
        const { operations } = req.body;
        if (!operations) {
            return res.status(400).json({
                success: false,
                message: "Operations object is required",
            });
        }
        // Parse and validate operations
        const parsedOps = videoOperationsSchema.parse(operations);
        // Mock file info for validation
        const mockFileInfo = {
            fileSize: 10 * 1024 * 1024, // 10MB
            mimeType: 'video/mp4',
            fileName: 'test-video.mp4'
        };
        await validateVideoOperations(parsedOps, mockFileInfo);
        res.json({
            success: true,
            message: "Video operations are valid",
            data: {
                operations: parsedOps,
                supportedOperations: ['crop', 'watermark'],
            },
        });
    }
    catch (error) {
        if (error instanceof zod_1.ZodError) {
            return res.status(400).json({
                success: false,
                message: "Invalid video operations",
                errors: error.issues.map((i) => ({
                    field: i.path.join("."),
                    message: i.message,
                })),
            });
        }
        res.status(400).json({
            success: false,
            message: error instanceof error_1.AppError ? error.message : "Invalid operations",
        });
    }
});
exports.default = exports.videoRouter;
