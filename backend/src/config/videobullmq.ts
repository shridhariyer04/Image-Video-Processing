import {Queue, QueueEvents, QueueOptions} from 'bullmq'
import { VIDEO_PROCESSING_QUEUE_NAME, NODE_ENV } from './env'
import {redis} from './redis'
import logger from '../utils/logger'

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
    }
};

export const videoQueue = new Queue(VIDEO_PROCESSING_QUEUE_NAME, queueOptions);

const videoQueueEvents = new QueueEvents(VIDEO_PROCESSING_QUEUE_NAME, { connection: redis });

videoQueueEvents.on('error', (error) => {
    logger.error('Queue error', { error: error.message, stack: error.stack });
})

videoQueueEvents.on('waiting', ({ jobId }) => {
    logger.debug('Job waiting:', { jobId });
})

videoQueueEvents.on('active', ({ jobId }) => {
    logger.info('Job started:', { jobId });
});

videoQueueEvents.on('completed', ({ jobId, returnvalue }) => {
    logger.info('Job completed', { jobId })
})

videoQueueEvents.on('failed', async ({ jobId, failedReason }) => {
    const job = await videoQueue.getJob(jobId);
    logger.error('Job failed:', {
        jobId,
        failedReason,
        attemptsMade: job?.attemptsMade,
        maxAttempts: job?.opts.attempts,
    });
});

videoQueueEvents.on('stalled', ({ jobId }) => {
    logger.warn('Job stalled:', { jobId });
});

// =============== INTERFACES AND TYPES ===============

// Crop/Trim operation
export interface CropOperation {
    startTime: number;
    endTime: number;
}

// Watermark operations
export type VideoWatermark =
    | {
        type: "text";
        text: string;
        fontSize?: number;
        fontFamily?: string;
        color?: string;   // e.g. "#FF0000"
        opacity?: number; // 0.1 to 1
        position?: "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center";
        x?: number; // x offset from position
        y?: number; // y offset from position
    }
    | {
        type: "image";
        imagePath: string;
        width?: number;
        height?: number;
        opacity?: number; // 0.1 to 1
        position?: "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center";
        x?: number; // x offset from position
        y?: number; // y offset from position
    }

// Audio operations (kept for compatibility but not used in processing)
export interface AudioOperation {
    codec?: "mp3" | "aac" | "wav";
    bitrate?: string;
    mute?: boolean;
    extractAudio?: boolean;
    format?: "mp3" | "aac" | "wav";
}

// Main video operations interface
export interface VideoOperations {
    crop?: CropOperation;
    watermark?: VideoWatermark;
    // Note: audio operations are kept for backward compatibility but not processed
    audio?: AudioOperation;
    
    // Output format (kept for compatibility)
    format?: "mp4" | "avi" | "mov" | "mkv" | "webm";
    quality?: number;
    bitrate?: string;
    
    // Resize operation (kept for compatibility)
    resize?: {
        width?: number;
        height?: number;
        maintainAspectRatio?: boolean;
    };
}

// Job payload interface
export interface VideoJobPayload {
    filePath: string;
    originalName: string;
    fileSize: number;
    mimeType: string;
    uploadedAt: Date;
    operations?: VideoOperations;
    userId?: string;
    metadata?: Record<string, any>;
}

// Job types
export enum VideoJobType {
    PROCESS_VIDEO = "process-video",
    BULK_PROCESS = "bulk-video-process",
    CLEANUP_TEMP = "cleanup-temp",
}

// Job priorities
export enum JobPriority {
    LOW = 1,
    NORMAL = 5,
    HIGH = 10,
    CRITICAL = 15,
}

// Export queue events for external use
export { videoQueueEvents };