"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.JobPriority = exports.ImageJobType = exports.SUPPORTED_FORMATS = exports.imageQueue = void 0;
// src/config/bullmq.ts
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
    },
};
// ✅ Only create the queue - NO WORKER HERE
exports.imageQueue = new bullmq_1.Queue(env_1.PROCESSING_QUEUE_NAME, queueOptions);
// ✅ Keep the queue events for monitoring
const imageQueueEvents = new bullmq_1.QueueEvents(env_1.PROCESSING_QUEUE_NAME, { connection: redis_1.redis });
imageQueueEvents.on('error', (error) => {
    logger_1.default.error('Queue error', { error: error.message, stack: error.stack });
});
imageQueueEvents.on('waiting', ({ jobId }) => {
    logger_1.default.debug('Job waiting:', { jobId });
});
imageQueueEvents.on('active', ({ jobId }) => {
    logger_1.default.info('Job started:', { jobId });
});
imageQueueEvents.on('completed', ({ jobId, returnvalue }) => {
    logger_1.default.info('Job completed:', { jobId });
});
imageQueueEvents.on('failed', async ({ jobId, failedReason }) => {
    const job = await exports.imageQueue.getJob(jobId);
    logger_1.default.error('Job failed:', {
        jobId,
        failedReason,
        attemptsMade: job?.attemptsMade,
        maxAttempts: job?.opts.attempts,
    });
});
imageQueueEvents.on('stalled', ({ jobId }) => {
    logger_1.default.warn('Job stalled:', { jobId });
});
exports.SUPPORTED_FORMATS = ['jpeg', 'png', 'webp', 'avif'];
var ImageJobType;
(function (ImageJobType) {
    ImageJobType["PROCESS_IMAGE"] = "process-image";
    ImageJobType["BULK_PROCESS"] = "bulk-process";
    ImageJobType["CLEANUP_TEMP"] = "cleanup-temp";
})(ImageJobType || (exports.ImageJobType = ImageJobType = {}));
var JobPriority;
(function (JobPriority) {
    JobPriority[JobPriority["LOW"] = 1] = "LOW";
    JobPriority[JobPriority["NORMAL"] = 5] = "NORMAL";
    JobPriority[JobPriority["HIGH"] = 10] = "HIGH";
    JobPriority[JobPriority["CRITICAL"] = 15] = "CRITICAL";
})(JobPriority || (exports.JobPriority = JobPriority = {}));
