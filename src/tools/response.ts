export interface McpToolResponse {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
}

export function jsonResponse(data: unknown): McpToolResponse {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

export function textResponse(message: string): McpToolResponse {
  return {
    content: [{ type: "text", text: message }],
  };
}
