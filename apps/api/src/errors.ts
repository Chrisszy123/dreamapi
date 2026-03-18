export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class UnauthorizedError extends AppError {
  constructor(code: string, message: string, context?: Record<string, unknown>) {
    super(code, message, 401, context);
    this.name = 'UnauthorizedError';
  }
}

export class ValidationError extends AppError {
  constructor(code: string, message: string, context?: Record<string, unknown>) {
    super(code, message, 400, context);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends AppError {
  constructor(code: string, message: string, context?: Record<string, unknown>) {
    super(code, message, 404, context);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends AppError {
  constructor(code: string, message: string, context?: Record<string, unknown>) {
    super(code, message, 409, context);
    this.name = 'ConflictError';
  }
}

export class RateLimitError extends AppError {
  constructor(message: string = 'Too many requests') {
    super('RATE_LIMIT_EXCEEDED', message, 429);
    this.name = 'RateLimitError';
  }
}
