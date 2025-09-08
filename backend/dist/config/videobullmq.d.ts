import { Queue, QueueEvents } from 'bullmq';
export declare const videoQueue: Queue<any, any, string, any, any, string>;
declare const videoQueueEvents: QueueEvents;
export interface CropOperation {
    startTime: number;
    endTime: number;
}
export type VideoWatermark = {
    type: "text";
    text: string;
    fontSize?: number;
    fontFamily?: string;
    color?: string;
    opacity?: number;
    position?: "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center";
    x?: number;
    y?: number;
} | {
    type: "image";
    imagePath: string;
    width?: number;
    height?: number;
    opacity?: number;
    position?: "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center";
    x?: number;
    y?: number;
};
export interface AudioOperation {
    codec?: "mp3" | "aac" | "wav";
    bitrate?: string;
    mute?: boolean;
    extractAudio?: boolean;
    format?: "mp3" | "aac" | "wav";
}
export interface VideoOperations {
    crop?: CropOperation;
    watermark?: VideoWatermark;
    audio?: AudioOperation;
    format?: "mp4" | "avi" | "mov" | "mkv" | "webm";
    quality?: number;
    bitrate?: string;
    resize?: {
        width?: number;
        height?: number;
        maintainAspectRatio?: boolean;
    };
}
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
export declare enum VideoJobType {
    PROCESS_VIDEO = "process-video",
    BULK_PROCESS = "bulk-video-process",
    CLEANUP_TEMP = "cleanup-temp"
}
export declare enum JobPriority {
    LOW = 1,
    NORMAL = 5,
    HIGH = 10,
    CRITICAL = 15
}
export { videoQueueEvents };
