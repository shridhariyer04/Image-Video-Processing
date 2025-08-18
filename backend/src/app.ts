// src/app.ts
import express, { Application, Request, Response, NextFunction } from 'express';
import uploadRouter from './routes/upload.route'; // Import your fixed router
import { AppError } from './utils/error';
import logger from './utils/logger';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

const app: Application = express();

// Middleware setup
app.use(helmet()); // Security headers
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true
})); // Enable CORS for frontend

app.use(express.json({ limit: '10kb' })); // Parse JSON bodies
app.use(express.urlencoded({ extended: true, limit: '10kb' })); // Parse URL-encoded bodies

// HTTP request logging
app.use(morgan('combined', {
  stream: { write: (message: string) => logger.info(message.trim()) },
  skip: (req) => req.url === '/health' // Skip health check logs to reduce noise
}));

// Request logging middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  logger.debug('Incoming request:', {
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

// Mount the upload router at /upload
// Routes: / becomes /upload, /job/:jobId/status becomes /upload/job/:jobId/status, etc.
app.use('/upload', uploadRouter);

// Health check endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    version: process.version,
    environment: process.env.NODE_ENV || 'development'
  });
});

// API documentation endpoint
app.get('/api', (_req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    message: 'Image Processing API',
    version: '1.0.0',
    endpoints: {
      upload: {
        method: 'POST',
        path: '/upload',
        description: 'Upload and process an image',
        contentType: 'multipart/form-data',
        parameters: {
          image: 'File (required) - Image file to process',
          operations: 'JSON string (optional) - Processing operations'
        }
      },
      jobStatus: {
        method: 'GET',
        path: '/upload/job/:jobId/status', // Updated to reflect correct mounting
        description: 'Get job processing status',
        parameters: {
          jobId: 'String (required) - Job ID returned from upload'
        }
      },
      jobDownload: {
        method: 'GET',
        path: '/upload/job/:jobId/download', // Updated to reflect correct mounting
        description: 'Download processed image',
        parameters: {
          jobId: 'String (required) - Job ID of completed job'
        }
      },
      bulkJobStatus: {
        method: 'GET',
        path: '/upload/jobs/status?jobIds=id1,id2,id3', // Updated to reflect correct mounting
        description: 'Get status of multiple jobs',
        parameters: {
          jobIds: 'String (required) - Comma-separated job IDs'
        }
      },
      workerStats: {
        method: 'GET',
        path: '/upload/worker/stats', // Updated to reflect correct mounting
        description: 'Get worker statistics and health'
      },
      health: {
        method: 'GET',
        path: '/health',
        description: 'Health check endpoint'
      }
    },
    timestamp: new Date().toISOString()
  });
});

// Catch-all for undefined routes (404 handler) - FIXED: Named wildcard parameter
app.use('*catchall', (req: Request, res: Response) => {
  logger.warn('Route not found:', {
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
        'POST /upload',
        'GET /upload/job/:jobId/status',
        'GET /upload/job/:jobId/download',
        'GET /upload/jobs/status',
        'GET /upload/worker/stats',
        'GET /health',
        'GET /api'
      ]
    },
    timestamp: new Date().toISOString(),
  });
});

// Global error handler
app.use((error: Error | AppError, req: Request, res: Response, _next: NextFunction) => {
  const status = error instanceof AppError ? error.statusCode : 500;
  const code = error instanceof AppError ? error.code : 'INTERNAL_SERVER_ERROR';
  const message = error.message || 'Something went wrong';

  // Log the error with context
  logger.error('Application error:', {
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

export default app;