import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { TaskService } from "../core/task-service.js";
import {
  CreateTaskArgsSchema,
  handleCreateTask,
} from "../tools/create-task.js";
import {
  UpdateTaskArgsSchema,
  handleUpdateTask,
} from "../tools/update-task.js";
import {
  ListTasksArgsSchema,
  handleListTasks,
} from "../tools/list-tasks.js";
import {
  ListProjectsArgsSchema,
  handleListProjects,
} from "../tools/list-projects.js";

export async function startMcpServer(storagePath?: string): Promise<void> {
  const service = new TaskService(storagePath);
  const server = new McpServer({
    name: "dex",
    version: "1.0.0",
  });

  server.tool(
    "create_task",
    "Create a new task with description and implementation context",
    CreateTaskArgsSchema.shape,
    async (args) => {
      const parsed = CreateTaskArgsSchema.parse(args);
      return handleCreateTask(parsed, service);
    }
  );

  server.tool(
    "update_task",
    "Update a task's fields, change status, complete with result, or delete",
    UpdateTaskArgsSchema.shape,
    async (args) => {
      const parsed = UpdateTaskArgsSchema.parse(args);
      return handleUpdateTask(parsed, service);
    }
  );

  server.tool(
    "list_tasks",
    "List tasks. By default shows only pending tasks. Filter by status, project, or search query.",
    ListTasksArgsSchema.shape,
    async (args) => {
      const parsed = ListTasksArgsSchema.parse(args);
      return handleListTasks(parsed, service);
    }
  );

  server.tool(
    "list_projects",
    "List all projects with task counts",
    ListProjectsArgsSchema.shape,
    async () => {
      return handleListProjects(service);
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
