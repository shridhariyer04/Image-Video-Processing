import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export const PORT = process.env.PORT ? Number(process.env.PORT) : 5000;
export const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
export const UPLOAD_DIR = process.env.UPLOAD_DIR || path.resolve(process.cwd(), 'uploads');
export const PROCESSING_QUEUE_NAME = process.env.PROCESSING_QUEUE_NAME || 'image-processing';
export const MAX_FILE_SIZE_BYTES = process.env.MAX_FILE_SIZE_BYTES ? Number(process.env.MAX_FILE_SIZE_BYTES) : 40 * 1024 * 1024;
export const NODE_ENV=process.env.NODE_ENV
export const PROCESSED_DIR = process.env.PROCESSED_DIR