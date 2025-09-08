"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.redis = void 0;
const ioredis_1 = __importDefault(require("ioredis"));
const env_1 = require("./env");
const logger_1 = __importDefault(require("../utils/logger"));
const RedisOptions = {
    //Connection settings
    connectTimeout: 1000,
    lazyConnect: true,
    keepAlive: 3000,
    // Retry strategy with exponential backoff
    retryDelayOnFailover: 100,
    maxLoadingRetryTime: 3,
    retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        if (times > 10) {
            logger_1.default.error(`Redis retry attemps exceeded:${times}`);
            return null;
        }
        return delay;
    },
    //Production optimizations
    maxLoadingTimeout: 5000,
    enableReadyCheck: true,
    maxRetriesPerRequest: env_1.NODE_ENV === 'production' ? 3 : null,
    // Connection pool settings
    family: 4, // IPv4
    compression: 'gzip',
};
exports.redis = new ioredis_1.default(env_1.REDIS_URL, RedisOptions);
let isConnected = false;
let isReconnecting = false;
let connectionAttempts = 0;
const MAX_CONNECTION_ATTEMPTS = 10;
//ENhanced event handlers
exports.redis.on('connect', () => {
    connectionAttempts = 0;
    isReconnecting = false;
    logger_1.default.info('Redis connection established', {
        host: exports.redis.options.host,
        port: exports.redis.options.port,
        db: exports.redis.options.db || 0,
    });
});
exports.redis.on('error', (error) => {
    isConnected = false;
    logger_1.default.error('Redis connection error:', {
        message: error.message,
        code: error.code,
        errno: error.errno,
        syncall: error.syncall,
        stack: env_1.NODE_ENV === 'development' ? error.stack : undefined,
    });
});
exports.redis.on('close', () => {
    isConnected = false,
        logger_1.default.warn('Redis connected closed');
});
exports.redis.on('reconnecting', (ms) => {
    isReconnecting = true;
    connectionAttempts++;
    if (connectionAttempts >= MAX_CONNECTION_ATTEMPTS) {
        logger_1.default.error('Max Redis reconnection attempts reaced, stopping...');
        exports.redis.disconnect(false);
        return;
    }
    logger_1.default.info('Attempting Redis reconnection', {
        attempt: connectionAttempts,
        delayMs: ms,
        maxAttempts: MAX_CONNECTION_ATTEMPTS,
    });
});
exports.redis.on('end', () => {
    isConnected = false;
    logger_1.default.info('Redis connection ended');
});
