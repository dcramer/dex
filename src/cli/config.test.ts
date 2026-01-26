import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { configCommand } from "./config.js";
import { captureOutput, CapturedOutput } from "./test-helpers.js";

describe("config command", () => {
  let output: CapturedOutput;
  let mockExit: ReturnType<typeof vi.spyOn>;
  let tempDir: string;
  let tempStorageDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dex-config-test-"));
    tempStorageDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "dex-config-storage-"),
    );
    output = captureOutput();
    mockExit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as () => never);

    // Override config path by setting DEX_HOME
    process.env.DEX_HOME = tempDir;
  });

  afterEach(() => {
    output.restore();
    mockExit.mockRestore();
    delete process.env.DEX_HOME;

    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.rmSync(tempStorageDir, { recursive: true, force: true });
  });

  describe("--help", () => {
    it("shows help text", async () => {
      await configCommand(["--help"]);
      const out = output.stdout.join("\n");
      expect(out).toContain("dex config");
      expect(out).toContain("Get and set configuration options");
      expect(out).toContain("--global");
      expect(out).toContain("--local");
      expect(out).toContain("sync.github.enabled");
    });
  });

  describe("get", () => {
    it("returns (not set) for unset key", async () => {
      await configCommand(["sync.github.enabled"]);
      const out = output.stdout.join("\n");
      expect(out).toContain("(not set)");
    });

    it("returns value for set key", async () => {
      // Create config file with a value
      fs.writeFileSync(
        path.join(tempDir, "dex.toml"),
        "[sync.github]\nenabled = true\n",
      );

      await configCommand(["sync.github.enabled"]);
      const out = output.stdout.join("\n");
      expect(out).toBe("true");
    });

    it("fails for unknown key", async () => {
      await expect(configCommand(["invalid.key"])).rejects.toThrow(
        "process.exit",
      );
      const err = output.stderr.join("\n");
      expect(err).toContain("Unknown config key");
    });
  });

  describe("set", () => {
    it("sets a string value", async () => {
      await configCommand(["sync.github.token_env=MY_TOKEN"]);
      const out = output.stdout.join("\n");
      expect(out).toContain("Set");
      expect(out).toContain("sync.github.token_env");
      expect(out).toContain("MY_TOKEN");

      // Verify file was created
      const configPath = path.join(tempDir, "dex.toml");
      expect(fs.existsSync(configPath)).toBe(true);
      const content = fs.readFileSync(configPath, "utf-8");
      expect(content).toContain("MY_TOKEN");
    });

    it("sets a boolean value", async () => {
      await configCommand(["sync.github.enabled=true"]);
      const out = output.stdout.join("\n");
      expect(out).toContain("Set");
      expect(out).toContain("true");

      const configPath = path.join(tempDir, "dex.toml");
      const content = fs.readFileSync(configPath, "utf-8");
      expect(content).toContain("enabled = true");
    });

    it("accepts various boolean formats", async () => {
      await configCommand(["sync.github.enabled=yes"]);
      let out = output.stdout.join("\n");
      expect(out).toContain("true");

      output.stdout.length = 0;
      await configCommand(["sync.github.enabled=1"]);
      out = output.stdout.join("\n");
      expect(out).toContain("true");

      output.stdout.length = 0;
      await configCommand(["sync.github.enabled=no"]);
      out = output.stdout.join("\n");
      expect(out).toContain("false");

      output.stdout.length = 0;
      await configCommand(["sync.github.enabled=0"]);
      out = output.stdout.join("\n");
      expect(out).toContain("false");
    });

    it("validates enum values", async () => {
      await expect(configCommand(["storage.engine=invalid"])).rejects.toThrow(
        "process.exit",
      );
      const err = output.stderr.join("\n");
      expect(err).toContain("Invalid value");
      expect(err).toContain("file");
      expect(err).toContain("file");
    });

    it("rejects invalid boolean values", async () => {
      await expect(
        configCommand(["sync.github.enabled=maybe"]),
      ).rejects.toThrow("process.exit");
      const err = output.stderr.join("\n");
      expect(err).toContain("Invalid boolean value");
    });
  });

  describe("--unset", () => {
    it("removes a config key", async () => {
      // First set a value
      fs.writeFileSync(
        path.join(tempDir, "dex.toml"),
        '[sync.github]\nenabled = true\nlabel_prefix = "dex"\n',
      );

      await configCommand(["--unset", "sync.github.label_prefix"]);
      const out = output.stdout.join("\n");
      expect(out).toContain("Unset");

      // Verify the key was removed
      const content = fs.readFileSync(path.join(tempDir, "dex.toml"), "utf-8");
      expect(content).not.toContain("label_prefix");
      expect(content).toContain("enabled"); // other key still there
    });

    it("reports when key was not set", async () => {
      fs.writeFileSync(path.join(tempDir, "dex.toml"), "[sync.github]\n");

      await configCommand(["--unset", "sync.github.label_prefix"]);
      const out = output.stdout.join("\n");
      expect(out).toContain("was not set");
    });
  });

  describe("--list", () => {
    it("lists all set config values", async () => {
      fs.writeFileSync(
        path.join(tempDir, "dex.toml"),
        '[storage]\nengine = "file"\n\n[sync.github]\nenabled = true\n',
      );

      await configCommand(["--list"]);
      const out = output.stdout.join("\n");
      expect(out).toContain("Configuration:");
      expect(out).toContain("storage.engine = file");
      expect(out).toContain("sync.github.enabled = true");
      expect(out).toContain("[global]");
    });

    it("shows local config values with source", async () => {
      fs.writeFileSync(
        path.join(tempDir, "dex.toml"),
        "[sync.github]\nenabled = false\n",
      );
      fs.writeFileSync(
        path.join(tempStorageDir, "config.toml"),
        "[sync.github]\nenabled = true\n",
      );

      await configCommand(["--list"], { storagePath: tempStorageDir });
      const out = output.stdout.join("\n");
      expect(out).toContain("sync.github.enabled = true");
      expect(out).toContain("[local]");
    });
  });

  describe("--local", () => {
    it("writes to project config file", async () => {
      await configCommand(["--local", "sync.github.enabled=true"], {
        storagePath: tempStorageDir,
      });

      const projectConfig = path.join(tempStorageDir, "config.toml");
      expect(fs.existsSync(projectConfig)).toBe(true);
      const content = fs.readFileSync(projectConfig, "utf-8");
      expect(content).toContain("enabled = true");

      // Global config should not exist
      const globalConfig = path.join(tempDir, "dex.toml");
      expect(fs.existsSync(globalConfig)).toBe(false);
    });

    it("fails without storage path", async () => {
      await expect(
        configCommand(["--local", "sync.github.enabled=true"]),
      ).rejects.toThrow("process.exit");
      const err = output.stderr.join("\n");
      expect(err).toContain("--local requires being in a dex project");
    });
  });

  describe("--global and --local conflict", () => {
    it("fails when both are specified", async () => {
      await expect(
        configCommand(["--global", "--local", "sync.github.enabled=true"], {
          storagePath: tempStorageDir,
        }),
      ).rejects.toThrow("process.exit");
      const err = output.stderr.join("\n");
      expect(err).toContain("Cannot use both --global and --local");
    });
  });

  describe("precedence", () => {
    it("local config overrides global config", async () => {
      fs.writeFileSync(
        path.join(tempDir, "dex.toml"),
        "[sync.github]\nenabled = false\n",
      );
      fs.writeFileSync(
        path.join(tempStorageDir, "config.toml"),
        "[sync.github]\nenabled = true\n",
      );

      await configCommand(["sync.github.enabled"], {
        storagePath: tempStorageDir,
      });
      const out = output.stdout.join("\n");
      expect(out).toBe("true");
    });

    it("falls back to global when local is not set", async () => {
      fs.writeFileSync(
        path.join(tempDir, "dex.toml"),
        '[sync.github]\nlabel_prefix = "global-prefix"\n',
      );
      fs.writeFileSync(
        path.join(tempStorageDir, "config.toml"),
        "[sync.github]\nenabled = true\n",
      );

      await configCommand(["sync.github.label_prefix"], {
        storagePath: tempStorageDir,
      });
      const out = output.stdout.join("\n");
      expect(out).toBe("global-prefix");
    });
  });

  describe("nested keys", () => {
    it("creates nested structure for deep keys", async () => {
      await configCommand(["sync.github.auto.on_change=true"]);

      const content = fs.readFileSync(path.join(tempDir, "dex.toml"), "utf-8");
      expect(content).toContain("[sync.github.auto]");
      expect(content).toContain("on_change = true");
    });
  });
});
