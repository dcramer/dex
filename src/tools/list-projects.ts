import { z } from "zod";
import { TaskService } from "../core/task-service.js";
import { jsonResponse, McpToolResponse } from "./response.js";

export const ListProjectsArgsSchema = z.object({});

export function handleListProjects(service: TaskService): McpToolResponse {
  const projects = service.listProjects();
  return jsonResponse(projects);
}
