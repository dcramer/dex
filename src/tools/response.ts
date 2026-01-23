import { extractErrorInfo } from "../errors.js";

export interface McpToolResponse {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

/**
 * Create a successful JSON response.
 */
export function jsonResponse(data: unknown): McpToolResponse {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

/**
 * Create an error response with the isError flag set.
 * This properly signals to MCP clients that the operation failed.
 */
export function errorResponse(err: unknown): McpToolResponse {
  const { message, suggestion } = extractErrorInfo(err);
  const errorData: { error: string; suggestion?: string } = { error: message };
  if (suggestion) {
    errorData.suggestion = suggestion;
  }

  return {
    content: [{ type: "text", text: JSON.stringify(errorData, null, 2) }],
    isError: true,
  };
}
