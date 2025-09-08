"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const upload_1 = require("../middlewares/upload");
const uploadcontroller_1 = require("../controllers/uploadcontroller");
const image_worker_1 = require("../wokers/image.worker");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const error_1 = require("../utils/error");
const logger_1 = __importDefault(require("../utils/logger"));
const Helper_1 = require("../utils/Helper");
const router = express_1.default.Router();
// POST / (will become /upload when mounted)
router.post('/', upload_1.upload.array('image', 5), upload_1.handleMulterError, uploadcontroller_1.handleUpload);
// GET /job/:jobId/status (will become /upload/job/:jobId/status when mounted)
router.get('/job/:jobId/status', async (req, res, next) => {
    try {
        const { jobId } = req.params;
        if (!jobId) {
            throw new error_1.AppError('Job ID is required', 400, 'MISSING_JOB_ID');
        }
        logger_1.default.debug('Getting job status:', { jobId });
        const jobStatus = await image_worker_1.imageWorker.getJobStatus(jobId);
        if (!jobStatus) {
            throw new error_1.AppError('Job not found', 404, 'JOB_NOT_FOUND');
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
        logger_1.default.debug('Job status response:', { jobId, status: jobStatus.status });
        res.json(response);
    }
    catch (error) {
        logger_1.default.error('Error getting job status:', {
            jobId: req.params.jobId,
            error: error instanceof Error ? error.message : error
        });
        next(error);
    }
});
// GET /job/:jobId/download (will become /upload/job/:jobId/download when mounted)
router.get('/job/:jobId/download', async (req, res, next) => {
    try {
        const { jobId } = req.params;
        if (!jobId) {
            throw new error_1.AppError('Job ID is required', 400, 'MISSING_JOB_ID');
        }
        logger_1.default.debug('Download request for job:', { jobId });
        const jobStatus = await image_worker_1.imageWorker.getJobStatus(jobId);
        if (!jobStatus) {
            throw new error_1.AppError('Job not found', 404, 'JOB_NOT_FOUND');
        }
        if (jobStatus.status !== 'completed') {
            throw new error_1.AppError(`Job is not completed yet. Current status: ${jobStatus.status}`, 400, 'JOB_NOT_COMPLETED');
        }
        if (!jobStatus.outputPath) {
            throw new error_1.AppError('Processed file not found', 404, 'FILE_NOT_FOUND');
        }
        // Check if file exists using direct fs methods since worker doesn't have checkProcessedFile
        let filePath;
        let fileSize;
        try {
            const stats = await fs_1.default.promises.stat(jobStatus.outputPath);
            filePath = jobStatus.outputPath;
            fileSize = stats.size;
            if (fileSize === 0) {
                throw new error_1.AppError('Processed file is empty', 404, 'FILE_EMPTY');
            }
        }
        catch (error) {
            if (error.code === 'ENOENT') {
                throw new error_1.AppError('Processed file not found', 404, 'FILE_NOT_FOUND');
            }
            throw error;
        }
        const fileName = jobStatus.processedFileName || `processed-${jobId}.jpg`;
        // Determine content type based on file extension
        const ext = path_1.default.extname(filePath).toLowerCase();
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
        res.setHeader('Content-Length', fileSize);
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
        res.setHeader('Expires', '-1');
        res.setHeader('Pragma', 'no-cache');
        logger_1.default.info('Serving processed file:', {
            jobId,
            filePath,
            fileName,
            contentType,
            fileSize
        });
        // Stream the file
        const fileStream = fs_1.default.createReadStream(filePath);
        fileStream.on('error', (error) => {
            logger_1.default.error('File stream error:', {
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
            logger_1.default.debug('File download completed:', { jobId, fileName });
        });
        // Pipe the file to the response
        fileStream.pipe(res);
    }
    catch (error) {
        logger_1.default.error('Error downloading file:', {
            jobId: req.params.jobId,
            error: error instanceof Error ? error.message : error
        });
        next(error);
    }
});
// GET /jobs/status - Bulk job status endpoint
router.get('/jobs/status', async (req, res, next) => {
    try {
        const { jobIds } = req.query;
        if (!jobIds || typeof jobIds !== 'string') {
            throw new error_1.AppError('Job IDs are required as comma-separated string', 400, 'MISSING_JOB_IDS');
        }
        const jobIdArray = jobIds.split(',').map(id => id.trim()).filter(id => id.length > 0);
        if (jobIdArray.length === 0) {
            throw new error_1.AppError('At least one job ID is required', 400, 'INVALID_JOB_IDS');
        }
        if (jobIdArray.length > 50) { // Limit to prevent abuse
            throw new error_1.AppError('Too many job IDs (max 50)', 400, 'TOO_MANY_JOB_IDS');
        }
        logger_1.default.debug('Getting bulk job statuses:', { jobIds: jobIdArray });
        // Since worker doesn't have getJobStatuses method, get them individually
        const jobStatuses = {};
        for (const jobId of jobIdArray) {
            try {
                const status = await image_worker_1.imageWorker.getJobStatus(jobId);
                jobStatuses[jobId] = status ? {
                    success: true,
                    data: status
                } : {
                    success: false,
                    error: 'Job not found'
                };
            }
            catch (error) {
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
    }
    catch (error) {
        logger_1.default.error('Error getting bulk job statuses:', {
            error: error instanceof Error ? error.message : error
        });
        next(error);
    }
});
// GET /worker/stats - Worker statistics endpoint
router.get('/worker/stats', async (req, res, next) => {
    try {
        const stats = image_worker_1.imageWorker.getStats();
        const health = await image_worker_1.imageWorker.getHealthStatus();
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
    }
    catch (error) {
        logger_1.default.error('Error getting worker stats:', {
            error: error instanceof Error ? error.message : error
        });
        next(error);
    }
});
// GET /diagnose - Queue diagnosis endpoint  
router.get('/diagnose', async (req, res, next) => {
    try {
        // Since worker doesn't have diagnoseQueue method, create a basic diagnosis
        const stats = image_worker_1.imageWorker.getStats();
        const health = await image_worker_1.imageWorker.getHealthStatus();
        const diagnosis = {
            timestamp: new Date().toISOString(),
            uptime: Date.now() - stats.startTime,
            stats,
            queueHealth: health.queueHealth,
            memoryUsage: health.memoryUsage,
            issues: [],
            recommendations: []
        };
        // Add basic health checks
        if (health.queueHealth.failed > health.queueHealth.completed) {
            diagnosis.issues.push('High failure rate detected');
            diagnosis.recommendations.push('Check error logs for recurring issues');
        }
        if (health.queueHealth.waiting > 100) {
            diagnosis.issues.push('Large queue backlog');
            diagnosis.recommendations.push('Consider increasing worker concurrency');
        }
        if (health.memoryUsage.heapUsed > 500 * 1024 * 1024) { // 500MB
            diagnosis.issues.push('High memory usage');
            diagnosis.recommendations.push('Monitor memory leaks and restart if necessary');
        }
        res.json({
            success: true,
            data: {
                diagnosis,
                recommendations: Helper_1.generateRecommendations ? (0, Helper_1.generateRecommendations)(diagnosis) : diagnosis.recommendations
            },
            timestamp: new Date().toISOString()
        });
    }
    catch (error) {
        logger_1.default.error('Error generating diagnosis:', {
            error: error instanceof Error ? error.message : error
        });
        next(error);
    }
});
// GET /health - Health check endpoint
router.get('/health', async (req, res, next) => {
    try {
        const health = await image_worker_1.imageWorker.getHealthStatus();
        res.json({
            success: true,
            status: health.status,
            data: {
                uptime: health.uptime,
                stats: health.stats,
                queue: health.queueHealth,
                memory: {
                    used: Math.round(health.memoryUsage.heapUsed / 1024 / 1024),
                    total: Math.round(health.memoryUsage.heapTotal / 1024 / 1024),
                    external: Math.round(health.memoryUsage.external / 1024 / 1024)
                }
            },
            timestamp: new Date().toISOString()
        });
    }
    catch (error) {
        logger_1.default.error('Error getting health status:', {
            error: error instanceof Error ? error.message : error
        });
        res.status(500).json({
            success: false,
            status: 'unhealthy',
            error: error instanceof Error ? error.message : 'Unknown error',
            timestamp: new Date().toISOString()
        });
    }
});
exports.default = router;
