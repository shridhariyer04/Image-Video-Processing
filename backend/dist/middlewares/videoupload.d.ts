import multer from 'multer';
import { NextFunction, Request, Response } from 'express';
/**
 * Video upload multer configuration
 */
export declare const videoUpload: multer.Multer;
/**
 * Video-specific Multer error handler
 */
export declare const handleVideoMulterError: (error: any, req: Request, res: Response, next: NextFunction) => void;
/**
 * Video file post-upload validation middleware
 */
export declare const validateUploadedVideo: (req: Request, res: Response, next: NextFunction) => Promise<void>;
/**
 * Cleanup utility for removing old video uploads
 */
export declare const cleanupOldVideoUploads: (maxAgeHours?: number) => Promise<void>;
/**
 * Setup periodic video cleanup
 */
export declare const setupPeriodicVideoCleanup: () => NodeJS.Timeout;
/**
 * Get video upload configuration
 */
export declare const getVideoUploadConfig: () => {
    FILE_LIMITS: {
        MAX_SIZE: number;
        MIN_SIZE: number;
        MAX_FILENAME_LENGTH: number;
        MAX_DURATION: number;
    };
    FORMATS: {
        INPUT_EXTENSIONS: string[];
        INPUT_MIME_TYPES: string[];
        MIME_TO_EXTENSION: {
            'video/mp4': string[];
            'video/mpeg': string[];
            'video/quicktime': string[];
            'video/x-msvideo': string[];
            'video/webm': string[];
            'video/x-ms-wmv': string[];
            'video/3gpp': string[];
            'video/x-flv': string[];
        };
    };
    SECURITY: {
        DANGEROUS_EXTENSIONS: string[];
        VIRUS_SIGNATURES: string[];
    };
    CLEANUP: {
        MAX_AGE_HOURS: number;
        CLEANUP_INTERVAL: number;
    };
};
