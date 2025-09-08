import multer from 'multer';
import { NextFunction, Request, Response } from 'express';
/**
 * Multer configuration with centralized limits
 */
export declare const upload: multer.Multer;
/**
 * Enhanced Multer error handler
 */
export declare const handleMulterError: (error: any, req: Request, res: Response, next: NextFunction) => void;
/**
 * Cleanup utility for removing old uploaded files
 */
export declare const cleanupOldUploads: (maxAgeHours?: 24) => Promise<void>;
/**
 * Setup periodic cleanup (call this from your app initialization)
 */
export declare const setupPeriodicCleanup: () => NodeJS.Timeout;
