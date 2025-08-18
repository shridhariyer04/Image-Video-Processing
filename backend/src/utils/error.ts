export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: any;
  public readonly timestamp: Date;
  public readonly requestId?: string;

  constructor(
    message: string,
    statusCode = 500,
    code = 'INTERNAL_ERROR',
    details?: any,
    requestId?: string
  ) {
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
  isOperational(): boolean {
    return this.statusCode >= 400 && this.statusCode < 500;
  }
}

// Specific error classes
export class ValidationError extends AppError {
  constructor(message: string, details?: any, requestId?: string) {
    super(message, 400, 'VALIDATION_ERROR', details, requestId);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, identifier?: string, requestId?: string) {
    const message = identifier 
      ? `${resource} with identifier '${identifier}' not found`
      : `${resource} not found`;
    super(message, 404, 'NOT_FOUND', { resource, identifier }, requestId);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required', requestId?: string) {
    super(message, 401, 'UNAUTHORIZED', undefined, requestId);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Access forbidden', requestId?: string) {
    super(message, 403, 'FORBIDDEN', undefined, requestId);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: any, requestId?: string) {
    super(message, 409, 'CONFLICT', details, requestId);
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = 'Too many requests', retryAfter?: number, requestId?: string) {
    super(message, 429, 'TOO_MANY_REQUESTS', { retryAfter }, requestId);
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(service: string, requestId?: string) {
    super(`${service} service is currently unavailable`, 503, 'SERVICE_UNAVAILABLE', { service }, requestId);
  }
}
