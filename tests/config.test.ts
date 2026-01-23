import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { loadConfig, getConfigPath } from "../src/core/config.js";

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
      const tempBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), "dex-config-test-"));
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
`
      );

      const config = loadConfig();

      expect(config.storage.engine).toBe("file");
      expect(config.storage.file?.path).toBe("/custom/path/.dex");
    });

    it("loads github-issues storage config", () => {
      fs.writeFileSync(
        tempConfigPath,
        `[storage]
engine = "github-issues"

[storage.github-issues]
owner = "zeeg"
repo = "dex-tasks"
token_env = "GITHUB_TOKEN"
label_prefix = "dex"
`
      );

      const config = loadConfig();

      expect(config.storage.engine).toBe("github-issues");
      expect(config.storage["github-issues"]?.owner).toBe("zeeg");
      expect(config.storage["github-issues"]?.repo).toBe("dex-tasks");
      expect(config.storage["github-issues"]?.token_env).toBe("GITHUB_TOKEN");
      expect(config.storage["github-issues"]?.label_prefix).toBe("dex");
    });

    it("loads github-projects storage config", () => {
      fs.writeFileSync(
        tempConfigPath,
        `[storage]
engine = "github-projects"

[storage.github-projects]
owner = "zeeg"
project_number = 1
token_env = "GITHUB_TOKEN"

[storage.github-projects.field_names]
status = "Status"
priority = "Priority"
result = "Result"
`
      );

      const config = loadConfig();

      expect(config.storage.engine).toBe("github-projects");
      expect(config.storage["github-projects"]?.owner).toBe("zeeg");
      expect(config.storage["github-projects"]?.project_number).toBe(1);
      expect(config.storage["github-projects"]?.field_names?.status).toBe("Status");
      expect(config.storage["github-projects"]?.field_names?.priority).toBe("Priority");
    });

    it("returns defaults on malformed TOML", () => {
      fs.writeFileSync(tempConfigPath, "invalid toml [[[");

      const config = loadConfig();

      expect(config.storage.engine).toBe("file");
    });

    it("handles missing storage section", () => {
      fs.writeFileSync(tempConfigPath, "# Empty config\n");

      const config = loadConfig();

      expect(config.storage.engine).toBe("file");
    });
  });

});
