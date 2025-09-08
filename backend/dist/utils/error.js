"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ServiceUnavailableError = exports.TooManyRequestsError = exports.ConflictError = exports.ForbiddenError = exports.UnauthorizedError = exports.NotFoundError = exports.ValidationError = exports.AppError = void 0;
class AppError extends Error {
    statusCode;
    code;
    details;
    timestamp;
    requestId;
    constructor(message, statusCode = 500, code = 'INTERNAL_ERROR', details, requestId) {
        super(message);
        this.name = this.constructor.name;
        this.statusCode = statusCode;
        this.code = code;
        this.details = details;
        this.timestamp = new Date();
        this.requestId = requestId;
        // Ensure proper prototype chain for instanceof checks
        Object.setPrototypeOf(this, AppError.prototype);
        // Capture stack trace
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor);
        }
    }
    // Convert to JSON for API responses
    toJSON() {
        return {
            name: this.name,
            message: this.message,
            code: this.code,
            statusCode: this.statusCode,
            details: this.details,
            timestamp: this.timestamp.toISOString(),
            requestId: this.requestId,
        };
    }
    // Check if error is operational (expected) vs programming error
    isOperational() {
        return this.statusCode >= 400 && this.statusCode < 500;
    }
}
exports.AppError = AppError;
// Specific error classes
class ValidationError extends AppError {
    constructor(message, details, requestId) {
        super(message, 400, 'VALIDATION_ERROR', details, requestId);
    }
}
exports.ValidationError = ValidationError;
class NotFoundError extends AppError {
    constructor(resource, identifier, requestId) {
        const message = identifier
            ? `${resource} with identifier '${identifier}' not found`
            : `${resource} not found`;
        super(message, 404, 'NOT_FOUND', { resource, identifier }, requestId);
    }
}
exports.NotFoundError = NotFoundError;
class UnauthorizedError extends AppError {
    constructor(message = 'Authentication required', requestId) {
        super(message, 401, 'UNAUTHORIZED', undefined, requestId);
    }
}
exports.UnauthorizedError = UnauthorizedError;
class ForbiddenError extends AppError {
    constructor(message = 'Access forbidden', requestId) {
        super(message, 403, 'FORBIDDEN', undefined, requestId);
    }
}
exports.ForbiddenError = ForbiddenError;
class ConflictError extends AppError {
    constructor(message, details, requestId) {
        super(message, 409, 'CONFLICT', details, requestId);
    }
}
exports.ConflictError = ConflictError;
class TooManyRequestsError extends AppError {
    constructor(message = 'Too many requests', retryAfter, requestId) {
        super(message, 429, 'TOO_MANY_REQUESTS', { retryAfter }, requestId);
    }
}
exports.TooManyRequestsError = TooManyRequestsError;
class ServiceUnavailableError extends AppError {
    constructor(service, requestId) {
        super(`${service} service is currently unavailable`, 503, 'SERVICE_UNAVAILABLE', { service }, requestId);
    }
}
exports.ServiceUnavailableError = ServiceUnavailableError;
