// src/config/bullmq.ts
import { Queue, QueueEvents, Worker, QueueOptions, WorkerOptions } from 'bullmq';
import { PROCESSING_QUEUE_NAME, NODE_ENV } from './env';
import { redis } from './redis';
import logger from '../utils/logger';

const queueOptions: QueueOptions = {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: NODE_ENV === 'production' ? 100 : 50,
    removeOnFail: NODE_ENV === 'production' ? 50 : 25,
  },
};

const workerOptions: WorkerOptions = {
  connection: redis,
  stalledInterval: 30 * 1000,
  maxStalledCount: 1,
};

export const imageQueue = new Queue(PROCESSING_QUEUE_NAME, queueOptions);

export const imageWorker = new Worker(
  PROCESSING_QUEUE_NAME,
  async (job) => {
    logger.info(`Processing job ${job.id} of type ${job.name}`);
  },
  workerOptions
);

const imageQueueEvents = new QueueEvents(PROCESSING_QUEUE_NAME, { connection: redis });

imageQueueEvents.on('error', (error) => {
  logger.error('Queue error', { error: error.message, stack: error.stack });
});
imageQueueEvents.on('waiting', ({ jobId }) => {
  logger.debug('Job waiting:', { jobId });
});
imageQueueEvents.on('active', ({ jobId }) => {
  logger.info('Job started:', { jobId });
});
imageQueueEvents.on('failed', async ({ jobId, failedReason }) => {
  const job = await imageQueue.getJob(jobId);
  logger.error('Job failed:', {
    jobId,
    failedReason,
    attemptsMade: job?.attemptsMade,
    maxAttempts: job?.opts.attempts,
  });
});
imageQueueEvents.on('stalled', ({ jobId }) => {
  logger.warn('Job stalled:', { jobId });
});

export interface CropOperation {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ResizeOperation {
  width?: number;
  height?: number;
  fit?: 'cover' | 'contain' | 'fill' | 'inside' | 'outside';
  position?: 'center' | 'top' | 'right' | 'bottom' | 'left';
}

export const SUPPORTED_FORMATS = ['jpeg', 'png', 'webp', 'avif'] as const;
export type SupportedFormat = typeof SUPPORTED_FORMATS[number];

export interface ImageOperations {
  crop?: CropOperation;
  resize?: ResizeOperation;
  rotate?: number;
  format?: SupportedFormat;
  quality?: number;
  grayscale?: boolean;
  blur?: number;
  sharpen?: number;
}

export interface ImageJobPayload {
  filePath: string;
  originalName: string;
  fileSize: number;
  mimeType: string;
  uploadedAt: Date;
  operations?: ImageOperations;
  userId?: string;
  metadata?: Record<string, any>;
}

export enum ImageJobType {
  PROCESS_IMAGE = 'process-image',
  BULK_PROCESS = 'bulk-process',
  CLEANUP_TEMP = 'cleanup-temp',
}

export enum JobPriority {
  LOW = 1,
  NORMAL = 5,
  HIGH = 10,
  CRITICAL = 15,
}