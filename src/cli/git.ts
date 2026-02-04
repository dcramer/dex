import { execSync } from "node:child_process";

export interface GitCommitInfo {
  sha: string;
  message?: string;
  branch?: string;
}

function gitExec(command: string): string | undefined {
  try {
    return (
      execSync(command, {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim() || undefined
    );
  } catch {
    return undefined;
  }
}

export function verifyCommitExists(sha: string): boolean {
  return gitExec(`git rev-parse --verify ${sha}^{commit}`) !== undefined;
}

export function getCommitInfo(sha: string): GitCommitInfo {
  const message = gitExec(`git show -s --format=%s ${sha}`);
  const branch = gitExec("git rev-parse --abbrev-ref HEAD");

  return {
    sha,
    message,
    branch: branch && branch !== "HEAD" ? branch : undefined,
  };
}
