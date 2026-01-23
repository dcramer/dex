/**
 * Custom error classes for consistent error handling across the codebase.
 *
 * All errors thrown by this application should be instances of DexError or its subclasses.
 * This enables consistent error handling, user-friendly messages, and proper error categorization.
 */

/**
 * Base error class for all Dex errors.
 * Provides consistent error structure with user-friendly messages and actionable suggestions.
 */
export class DexError extends Error {
  /** A suggestion for the user on how to resolve the error */
  readonly suggestion?: string;

  constructor(message: string, suggestion?: string) {
    super(message);
    this.name = "DexError";
    this.suggestion = suggestion;
  }
}

/**
 * Error thrown when a requested resource (task, project, etc.) is not found.
 */
export class NotFoundError extends DexError {
  /** The type of resource that was not found */
  readonly resourceType: string;
  /** The identifier used to look up the resource */
  readonly resourceId: string;

  constructor(resourceType: string, resourceId: string, suggestion?: string) {
    super(
      `${resourceType} "${resourceId}" not found`,
      suggestion ?? `Run "dex list --all" to see all available ${resourceType.toLowerCase()}s`
    );
    this.name = "NotFoundError";
    this.resourceType = resourceType;
    this.resourceId = resourceId;
  }
}

/**
 * Error thrown when an operation would create an invalid state.
 * Examples: circular parent references, completing a task with pending subtasks.
 */
export class ValidationError extends DexError {
  constructor(message: string, suggestion?: string) {
    super(message, suggestion);
    this.name = "ValidationError";
  }
}

/**
 * Error thrown when storage operations fail.
 */
export class StorageError extends DexError {
  /** The underlying system error, if any */
  readonly cause?: Error;

  constructor(message: string, cause?: Error, suggestion?: string) {
    super(message, suggestion ?? "Check file permissions and disk space");
    this.name = "StorageError";
    this.cause = cause;
  }
}

/**
 * Error thrown when stored data is corrupted or in an invalid format.
 */
export class DataCorruptionError extends StorageError {
  /** Path to the corrupted file */
  readonly filePath: string;

  constructor(filePath: string, cause?: Error, details?: string) {
    const baseMessage = `Data file "${filePath}" is corrupted`;
    const fullMessage = details ? `${baseMessage}: ${details}` : baseMessage;
    super(
      fullMessage,
      cause,
      "Try restoring from a backup or delete the file to start fresh"
    );
    this.name = "DataCorruptionError";
    this.filePath = filePath;
  }
}

/**
 * Extract error message and suggestion from any error type.
 * Used for consistent error formatting across CLI and MCP interfaces.
 */
export function extractErrorInfo(err: unknown): { message: string; suggestion?: string } {
  if (err instanceof DexError) {
    return { message: err.message, suggestion: err.suggestion };
  }
  if (err instanceof Error) {
    return { message: err.message };
  }
  return { message: String(err) };
}
