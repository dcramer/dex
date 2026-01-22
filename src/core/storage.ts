import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { TaskStore, TaskStoreSchema } from "../types.js";

function findGitRoot(startDir: string): string | null {
  let currentDir = startDir;
  while (currentDir !== path.dirname(currentDir)) {
    if (fs.existsSync(path.join(currentDir, ".git"))) {
      return currentDir;
    }
    currentDir = path.dirname(currentDir);
  }
  return null;
}

function getDefaultStoragePath(): string {
  const gitRoot = findGitRoot(process.cwd());
  if (gitRoot) {
    return path.join(gitRoot, ".dex", "tasks.json");
  }
  return path.join(os.homedir(), ".dex", "tasks.json");
}

export function getStoragePath(): string {
  return (
    process.env.DEX_STORAGE_PATH ||
    getDefaultStoragePath()
  );
}

export class TaskStorage {
  private storagePath: string;

  constructor(storagePath?: string) {
    this.storagePath = storagePath || getStoragePath();
  }

  private ensureDirectory(): void {
    const dir = path.dirname(this.storagePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  read(): TaskStore {
    if (!fs.existsSync(this.storagePath)) {
      return { tasks: [] };
    }

    const content = fs.readFileSync(this.storagePath, "utf-8");
    const data = JSON.parse(content);
    return TaskStoreSchema.parse(data);
  }

  write(store: TaskStore): void {
    this.ensureDirectory();
    const content = JSON.stringify(store, null, 2);
    fs.writeFileSync(this.storagePath, content, "utf-8");
  }

  getPath(): string {
    return this.storagePath;
  }
}
