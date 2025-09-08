"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// src/app.ts
const express_1 = __importDefault(require("express"));
const upload_route_1 = __importDefault(require("./routes/upload.route"));
const video_upload_route_1 = __importDefault(require("./routes/video.upload.route")); // Import video router
const error_1 = require("./utils/error");
const logger_1 = __importDefault(require("./utils/logger"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const morgan_1 = __importDefault(require("morgan"));
const app = (0, express_1.default)();
// Middleware setup
app.use((0, helmet_1.default)()); // Security headers
app.use((0, cors_1.default)({
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    credentials: true
})); // Enable CORS for frontend
app.use(express_1.default.json({ limit: '10kb' })); // Parse JSON bodies
app.use(express_1.default.urlencoded({ extended: true, limit: '10kb' })); // Parse URL-encoded bodies
// HTTP request logging
app.use((0, morgan_1.default)('combined', {
    stream: { write: (message) => logger_1.default.info(message.trim()) },
    skip: (req) => req.url === '/health' // Skip health check logs to reduce noise
}));
// Request logging middleware
app.use((req, res, next) => {
    logger_1.default.debug('Incoming request:', {
        method: req.method,
        url: req.url,
        params: req.params,
        query: req.query,
        headers: {
            'content-type': req.get('content-type'),
            'user-agent': req.get('user-agent'),
            'origin': req.get('origin')
        }
    });
    next();
});
// Health check endpoint - Define before mounting routers
app.get('/health', (_req, res) => {
    res.status(200).json({
        success: true,
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        version: process.version,
        environment: process.env.NODE_ENV || 'development',
        services: ['image-processing', 'video-processing']
    });
});
// API documentation endpoint - Updated with video endpoints
app.get('/api', (_req, res) => {
    res.status(200).json({
        success: true,
        message: 'Unified Media Processing API',
        version: '2.0.0',
        services: ['image-processing', 'video-processing'],
        endpoints: {
            // Image Processing Endpoints
            imageUpload: {
                method: 'POST',
                path: '/upload',
                description: 'Upload and process images (up to 5 files)',
                contentType: 'multipart/form-data',
                parameters: {
                    image: 'File[] (required) - Image files to process (max 5)',
                    operations: 'JSON string (optional) - Processing operations'
                }
            },
            imageJobStatus: {
                method: 'GET',
                path: '/upload/job/:jobId/status',
                description: 'Get image job processing status',
                parameters: {
                    jobId: 'String (required) - Job ID returned from upload'
                }
            },
            imageJobDownload: {
                method: 'GET',
                path: '/upload/job/:jobId/download',
                description: 'Download processed image',
                parameters: {
                    jobId: 'String (required) - Job ID of completed job'
                }
            },
            imageBulkJobStatus: {
                method: 'GET',
                path: '/upload/jobs/status?jobIds=id1,id2,id3',
                description: 'Get status of multiple image jobs',
                parameters: {
                    jobIds: 'String (required) - Comma-separated job IDs (max 50)'
                }
            },
            imageWorkerStats: {
                method: 'GET',
                path: '/upload/worker/stats',
                description: 'Get image worker statistics and health'
            },
            // Video Processing Endpoints
            videoUpload: {
                method: 'POST',
                path: '/video',
                description: 'Upload and process video (single file)',
                contentType: 'multipart/form-data',
                parameters: {
                    video: 'File (required) - Video file to process',
                    operations: 'JSON string (optional) - Processing operations (crop, watermark)'
                }
            },
            videoJobStatus: {
                method: 'GET',
                path: '/video/job/:jobId/status',
                description: 'Get video job processing status',
                parameters: {
                    jobId: 'String (required) - Job ID returned from upload'
                }
            },
            videoJobDownload: {
                method: 'GET',
                path: '/video/job/:jobId/download',
                description: 'Download processed video',
                parameters: {
                    jobId: 'String (required) - Job ID of completed job'
                }
            },
            videoBulkJobStatus: {
                method: 'GET',
                path: '/video/jobs/status?jobIds=id1,id2,id3',
                description: 'Get status of multiple video jobs',
                parameters: {
                    jobIds: 'String (required) - Comma-separated job IDs (max 20)'
                }
            },
            videoWorkerStats: {
                method: 'GET',
                path: '/video/worker/stats',
                description: 'Get video worker statistics and health'
            },
            videoValidateOperations: {
                method: 'POST',
                path: '/video/validate-operations',
                description: 'Validate video processing operations',
                parameters: {
                    operations: 'Object (required) - Operations to validate'
                }
            },
            // Common Endpoints
            health: {
                method: 'GET',
                path: '/health',
                description: 'Overall service health check'
            }
        },
        supportedOperations: {
            image: ['resize', 'crop', 'rotate', 'flip', 'format conversion', 'quality adjustment'],
            video: ['crop (time-based)', 'watermark (text/image)']
        },
        supportedFormats: {
            image: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.tiff'],
            video: ['.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.mkv', '.m4v', '.3gp']
        },
        limits: {
            image: {
                maxFiles: 5,
                maxFileSize: '10MB per file',
                totalSize: '50MB'
            },
            video: {
                maxFiles: 1,
                maxFileSize: '500MB',
                maxDuration: '1 hour'
            }
        },
        timestamp: new Date().toISOString()
    });
});
// Mount the routers
app.use('/upload', upload_route_1.default); // Image processing routes
app.use('/video', video_upload_route_1.default); // Video processing routes
// Global error handler
app.use((error, req, res, _next) => {
    const status = error instanceof error_1.AppError ? error.statusCode : 500;
    const code = error instanceof error_1.AppError ? error.code : 'INTERNAL_SERVER_ERROR';
    const message = error.message || 'Something went wrong';
    // Log the error with context
    logger_1.default.error('Application error:', {
        error: message,
        code,
        stack: error.stack,
        path: req.path,
        method: req.method,
        clientIp: req.ip,
        userAgent: req.get('User-Agent'),
        body: req.method !== 'GET' ? req.body : undefined,
        query: req.query,
        params: req.params
    });
    // Determine if we should expose stack trace
    const isDevelopment = process.env.NODE_ENV === 'development';
    res.status(status).json({
        success: false,
        error: {
            code,
            message,
            details: isDevelopment ? error.stack : undefined,
            path: req.path,
            method: req.method
        },
        timestamp: new Date().toISOString(),
    });
});
// 404 handler - Must be last, after all routes and error handlers
app.use((req, res) => {
    logger_1.default.warn('Route not found:', {
        method: req.method,
        url: req.originalUrl,
        ip: req.ip,
        userAgent: req.get('User-Agent')
    });
    res.status(404).json({
        success: false,
        error: {
            code: 'NOT_FOUND',
            message: `Route ${req.method} ${req.originalUrl} not found`,
            availableEndpoints: [
                // Image endpoints
                'POST /upload',
                'GET /upload/job/:jobId/status',
                'GET /upload/job/:jobId/download',
                'GET /upload/jobs/status',
                'GET /upload/worker/stats',
                'GET /upload/diagnose',
                'GET /upload/health',
                // Video endpoints
                'POST /video',
                'GET /video/job/:jobId/status',
                'GET /video/job/:jobId/download',
                'GET /video/jobs/status',
                'GET /video/worker/stats',
                'GET /video/diagnose',
                'GET /video/health',
                'POST /video/validate-operations',
                // Common endpoints
                'GET /health',
                'GET /api'
            ]
        },
        timestamp: new Date().toISOString(),
    });
});
// Export the Express application
exports.default = app;
