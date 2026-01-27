import { execSync } from "node:child_process";

/**
 * Check if a commit SHA exists on origin/HEAD (has been pushed).
 * Returns true if the commit is an ancestor of origin/HEAD.
 */
export function isCommitOnRemote(sha: string): boolean {
  try {
    // git merge-base --is-ancestor returns 0 if sha is ancestor of origin/HEAD
    execSync(`git merge-base --is-ancestor ${sha} origin/HEAD`, {
      stdio: ["pipe", "pipe", "pipe"],
    });
    return true;
  } catch {
    // Not an ancestor, or git command failed
    return false;
  }
}
