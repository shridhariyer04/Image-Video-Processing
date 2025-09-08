"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_FILE_VIDEO_SIZE_BYTES = exports.VIDEO_UPLOAD_DIR = exports.VIDEO_PROCESSING_QUEUE_NAME = exports.PROCESSED_DIR = exports.NODE_ENV = exports.MAX_FILE_SIZE_BYTES = exports.PROCESSING_QUEUE_NAME = exports.UPLOAD_DIR = exports.REDIS_URL = exports.PORT = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
dotenv_1.default.config();
exports.PORT = process.env.PORT ? Number(process.env.PORT) : 5000;
exports.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
exports.UPLOAD_DIR = process.env.UPLOAD_DIR || path_1.default.resolve(process.cwd(), 'uploads');
exports.PROCESSING_QUEUE_NAME = process.env.PROCESSING_QUEUE_NAME || 'image-processing';
exports.MAX_FILE_SIZE_BYTES = process.env.MAX_FILE_SIZE_BYTES ? Number(process.env.MAX_FILE_SIZE_BYTES) : 40 * 1024 * 1024;
exports.NODE_ENV = process.env.NODE_ENV;
exports.PROCESSED_DIR = process.env.PROCESSED_DIR;
exports.VIDEO_PROCESSING_QUEUE_NAME = process.env.VIDEO_PROCESSING_QUEUE_NAME || "video-processing";
exports.VIDEO_UPLOAD_DIR = process.env.VIDEO_UPLOAD_DIR || path_1.default.resolve(process.cwd(), 'videoupload');
exports.MAX_FILE_VIDEO_SIZE_BYTES = process.env.MAX_FILE_VIDEO_SIZE_BYTES ? Number(process.env.MAX_FILE_SIZE_BYTES) : 500 * 1024 * 1024;
