"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.videoQueueEvents = exports.JobPriority = exports.VideoJobType = exports.videoQueue = void 0;
const bullmq_1 = require("bullmq");
const env_1 = require("./env");
const redis_1 = require("./redis");
const logger_1 = __importDefault(require("../utils/logger"));
const queueOptions = {
    connection: redis_1.redis,
    defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: 'exponential',
            delay: 2000,
        },
        removeOnComplete: env_1.NODE_ENV === 'production' ? 100 : 50,
        removeOnFail: env_1.NODE_ENV === 'production' ? 50 : 25,
    }
};
exports.videoQueue = new bullmq_1.Queue(env_1.VIDEO_PROCESSING_QUEUE_NAME, queueOptions);
const videoQueueEvents = new bullmq_1.QueueEvents(env_1.VIDEO_PROCESSING_QUEUE_NAME, { connection: redis_1.redis });
exports.videoQueueEvents = videoQueueEvents;
videoQueueEvents.on('error', (error) => {
    logger_1.default.error('Queue error', { error: error.message, stack: error.stack });
});
videoQueueEvents.on('waiting', ({ jobId }) => {
    logger_1.default.debug('Job waiting:', { jobId });
});
videoQueueEvents.on('active', ({ jobId }) => {
    logger_1.default.info('Job started:', { jobId });
});
videoQueueEvents.on('completed', ({ jobId, returnvalue }) => {
    logger_1.default.info('Job completed', { jobId });
});
videoQueueEvents.on('failed', async ({ jobId, failedReason }) => {
    const job = await exports.videoQueue.getJob(jobId);
    logger_1.default.error('Job failed:', {
        jobId,
        failedReason,
        attemptsMade: job?.attemptsMade,
        maxAttempts: job?.opts.attempts,
    });
});
videoQueueEvents.on('stalled', ({ jobId }) => {
    logger_1.default.warn('Job stalled:', { jobId });
});
// Job types
var VideoJobType;
(function (VideoJobType) {
    VideoJobType["PROCESS_VIDEO"] = "process-video";
    VideoJobType["BULK_PROCESS"] = "bulk-video-process";
    VideoJobType["CLEANUP_TEMP"] = "cleanup-temp";
})(VideoJobType || (exports.VideoJobType = VideoJobType = {}));
// Job priorities
var JobPriority;
(function (JobPriority) {
    JobPriority[JobPriority["LOW"] = 1] = "LOW";
    JobPriority[JobPriority["NORMAL"] = 5] = "NORMAL";
    JobPriority[JobPriority["HIGH"] = 10] = "HIGH";
    JobPriority[JobPriority["CRITICAL"] = 15] = "CRITICAL";
})(JobPriority || (exports.JobPriority = JobPriority = {}));
