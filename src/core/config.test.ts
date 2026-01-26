import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";
import { loadConfig, getConfigPath, getProjectConfigPath } from "./config.js";

describe("Config", () => {
  describe("getConfigPath", () => {
    it("returns ~/.config/dex/dex.toml by default", () => {
      const configPath = getConfigPath();
      const expected = path.join(os.homedir(), ".config", "dex", "dex.toml");
      expect(configPath).toBe(expected);
    });

    it("respects XDG_CONFIG_HOME if set", () => {
      const originalXdg = process.env.XDG_CONFIG_HOME;
      process.env.XDG_CONFIG_HOME = "/tmp/custom-config";

      const configPath = getConfigPath();
      expect(configPath).toBe("/tmp/custom-config/dex/dex.toml");

      // Restore
      if (originalXdg !== undefined) {
        process.env.XDG_CONFIG_HOME = originalXdg;
      } else {
        delete process.env.XDG_CONFIG_HOME;
      }
    });
  });

  describe("loadConfig", () => {
    let tempConfigPath: string;
    let originalXdg: string | undefined;

    beforeEach(() => {
      // Save original XDG_CONFIG_HOME
      originalXdg = process.env.XDG_CONFIG_HOME;

      // Create temp config directory structure: /tmp/xxx/dex/dex.toml
      const tempBaseDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "dex-config-test-"),
      );
      const tempDexDir = path.join(tempBaseDir, "dex");
      fs.mkdirSync(tempDexDir, { recursive: true });
      tempConfigPath = path.join(tempDexDir, "dex.toml");

      // Override XDG_CONFIG_HOME to temp base directory
      process.env.XDG_CONFIG_HOME = tempBaseDir;
    });

    afterEach(() => {
      // Clean up
      if (fs.existsSync(tempConfigPath)) {
        fs.unlinkSync(tempConfigPath);
      }
      const dexDir = path.dirname(tempConfigPath); // /tmp/xxx/dex
      if (fs.existsSync(dexDir)) {
        fs.rmdirSync(dexDir);
      }
      const baseDir = path.dirname(dexDir); // /tmp/xxx
      if (fs.existsSync(baseDir)) {
        fs.rmdirSync(baseDir);
      }

      // Restore original XDG_CONFIG_HOME
      if (originalXdg !== undefined) {
        process.env.XDG_CONFIG_HOME = originalXdg;
      } else {
        delete process.env.XDG_CONFIG_HOME;
      }
    });

    it("returns default config when file doesn't exist", () => {
      const config = loadConfig();

      expect(config.storage.engine).toBe("file");
      expect(config.storage.file?.path).toBeUndefined();
    });

    it("loads file storage config", () => {
      fs.writeFileSync(
        tempConfigPath,
        `[storage]
engine = "file"

[storage.file]
path = "/custom/path/.dex"
`,
      );

      const config = loadConfig();

      expect(config.storage.engine).toBe("file");
      expect(config.storage.file?.path).toBe("/custom/path/.dex");
    });

    it("throws error on malformed TOML", () => {
      fs.writeFileSync(tempConfigPath, "invalid toml [[[");

      expect(() => loadConfig()).toThrow("Failed to parse config file");
    });

    it("handles missing storage section", () => {
      fs.writeFileSync(tempConfigPath, "# Empty config\n");

      const config = loadConfig();

      expect(config.storage.engine).toBe("file");
    });
  });

  describe("getProjectConfigPath", () => {
    let tempGitDir: string;
    let originalCwd: string;

    beforeEach(() => {
      originalCwd = process.cwd();

      // Create temp git repo
      tempGitDir = fs.mkdtempSync(path.join(os.tmpdir(), "dex-git-test-"));
      process.chdir(tempGitDir);
      execSync("git init", { cwd: tempGitDir, stdio: "ignore" });
    });

    afterEach(() => {
      process.chdir(originalCwd);
      // Clean up temp directory
      fs.rmSync(tempGitDir, { recursive: true, force: true });
    });

    it("returns .dex/config.toml at git root", () => {
      const projectConfigPath = getProjectConfigPath();

      // Normalize paths for macOS /private prefix
      const expectedDir = fs.realpathSync(tempGitDir);
      const expectedPath = path.join(expectedDir, ".dex", "config.toml");
      expect(projectConfigPath).toBe(expectedPath);
    });

    it("finds git root from subdirectory", () => {
      // Create nested directory
      const subdir = path.join(tempGitDir, "src", "cli");
      fs.mkdirSync(subdir, { recursive: true });
      process.chdir(subdir);

      const projectConfigPath = getProjectConfigPath();

      // Should still point to git root (normalize paths for macOS)
      const expectedDir = fs.realpathSync(tempGitDir);
      const expectedPath = path.join(expectedDir, ".dex", "config.toml");
      expect(projectConfigPath).toBe(expectedPath);
    });

    it("returns null when not in a git repo", () => {
      // Change to temp dir without git
      const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), "dex-non-git-"));
      try {
        process.chdir(nonGitDir);

        const projectConfigPath = getProjectConfigPath();

        expect(projectConfigPath).toBeNull();
      } finally {
        process.chdir(originalCwd);
        fs.rmSync(nonGitDir, { recursive: true, force: true });
      }
    });

    it("project config has precedence over global config", () => {
      // Write global config
      fs.writeFileSync(
        getConfigPath(),
        `[sync.github]
enabled = false
`,
        { flag: "w" },
      );

      // Write project config
      const projectConfigPath = path.join(tempGitDir, ".dex", "config.toml");
      fs.mkdirSync(path.dirname(projectConfigPath), { recursive: true });
      fs.writeFileSync(
        projectConfigPath,
        `[sync.github]
enabled = true
`,
      );

      try {
        const config = loadConfig();

        // Project config should override global
        expect(config.sync?.github?.enabled).toBe(true);
      } finally {
        // Clean up
        fs.unlinkSync(getConfigPath());
        fs.unlinkSync(projectConfigPath);
      }
    });
  });
});
