// src/config/bullmq.ts
import { Queue, QueueEvents, QueueOptions } from 'bullmq';
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

// ✅ Only create the queue - NO WORKER HERE
export const imageQueue = new Queue(PROCESSING_QUEUE_NAME, queueOptions);

// ✅ Keep the queue events for monitoring
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

imageQueueEvents.on('completed', ({ jobId, returnvalue }) => {
  logger.info('Job completed:', { jobId});
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

// ✅ Export interfaces and enums as before
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

export type watermark = |{
  type: "text";
      text: string;
      fontSize?: number;
      fontFamily?: string;
      color?: string;   // e.g. "#FFFFFF"
      opacity?: number; // 0 to 1
      gravity?: "north" | "south" | "east" | "west" | "center"; 
      dx?: number; // x offset
      dy?: number; // y offset
}
|{
  type: "image";
      imagePath: string; // path to the watermark image
      width?: number;    // optional resize
      height?: number;
      opacity?: number; 
      gravity?: "north" | "south" | "east" | "west" | "center"; 
      dx?: number;
      dy?: number;

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
  flip?:boolean,
  flop?:boolean,
  brightness?:number,
    saturation?: number;   
  hue?: number;          
  contrast?: number;    
  gamma?: number;        
  negate?: boolean;      
  normalize?: boolean;   
  sepia?: boolean;
  watermark?:watermark;
   progressive?: boolean;     
  compression?: number;      
  lossless?: boolean;        

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