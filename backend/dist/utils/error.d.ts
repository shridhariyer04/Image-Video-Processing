export declare class AppError extends Error {
    readonly statusCode: number;
    readonly code: string;
    readonly details?: any;
    readonly timestamp: Date;
    readonly requestId?: string;
    constructor(message: string, statusCode?: number, code?: string, details?: any, requestId?: string);
    toJSON(): {
        name: string;
        message: string;
        code: string;
        statusCode: number;
        details: any;
        timestamp: string;
        requestId: string | undefined;
    };
    isOperational(): boolean;
}
export declare class ValidationError extends AppError {
    constructor(message: string, details?: any, requestId?: string);
}
export declare class NotFoundError extends AppError {
    constructor(resource: string, identifier?: string, requestId?: string);
}
export declare class UnauthorizedError extends AppError {
    constructor(message?: string, requestId?: string);
}
export declare class ForbiddenError extends AppError {
    constructor(message?: string, requestId?: string);
}
export declare class ConflictError extends AppError {
    constructor(message: string, details?: any, requestId?: string);
}
export declare class TooManyRequestsError extends AppError {
    constructor(message?: string, retryAfter?: number, requestId?: string);
}
export declare class ServiceUnavailableError extends AppError {
    constructor(service: string, requestId?: string);
}
