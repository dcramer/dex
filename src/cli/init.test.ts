import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { runCli } from "./index.js";
import { captureOutput, createTempStorage, CapturedOutput } from "./test-helpers.js";

// Store the real tmpdir before mocking
const realTmpdir = os.tmpdir();

// Mock os module to allow overriding homedir
vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return {
    ...actual,
    homedir: vi.fn(() => actual.homedir()),
  };
});

describe("init command", () => {
  let output: CapturedOutput;
  let mockExit: ReturnType<typeof vi.spyOn>;
  let tempDir: string;
  let tempHomeDir: string;
  let tempStorage: ReturnType<typeof createTempStorage>;

  beforeEach(() => {
    // Create temp directories for config and home using the real tmpdir
    tempDir = fs.mkdtempSync(path.join(realTmpdir, "dex-init-test-"));
    tempHomeDir = fs.mkdtempSync(path.join(realTmpdir, "dex-init-home-"));

    // runCli requires CliOptions with storage, even though init doesn't use it
    tempStorage = createTempStorage();
    output = captureOutput();
    mockExit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as () => never);
    // Mock os.homedir() to return temp home directory for shell detection tests
    vi.mocked(os.homedir).mockReturnValue(tempHomeDir);
  });

  afterEach(() => {
    output.restore();
    tempStorage.cleanup();
    mockExit.mockRestore();
    vi.mocked(os.homedir).mockRestore();

    // Clean up temp directories
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.rmSync(tempHomeDir, { recursive: true, force: true });
  });

  it("shows help with --help flag", async () => {
    await runCli(["init", "--help"], { storage: tempStorage.storage });

    const out = output.stdout.join("\n");
    expect(out).toContain("dex init");
    expect(out).toContain("--yes");
    expect(out).toContain("--config-dir");
    expect(out).toContain("--help");
  });

  it("creates config file in fresh directory", async () => {
    await runCli(["init", "-y", "--config-dir", tempDir], { storage: tempStorage.storage });

    const out = output.stdout.join("\n");
    expect(out).toContain("Created config file");

    // Verify config file was created
    const configPath = path.join(tempDir, "dex.toml");
    expect(fs.existsSync(configPath)).toBe(true);

    // Verify config content
    const content = fs.readFileSync(configPath, "utf-8");
    expect(content).toContain("[storage]");
    expect(content).toContain('engine = "file"');
  });

  it("creates config directory structure", async () => {
    const nestedConfigDir = path.join(tempDir, "config", "dex");
    await runCli(["init", "-y", "--config-dir", nestedConfigDir], { storage: tempStorage.storage });

    // Verify directory was created
    expect(fs.existsSync(nestedConfigDir)).toBe(true);
    expect(fs.statSync(nestedConfigDir).isDirectory()).toBe(true);
  });

  it("fails when config already exists", async () => {
    // Create existing config file
    fs.mkdirSync(tempDir, { recursive: true });
    const configPath = path.join(tempDir, "dex.toml");
    fs.writeFileSync(configPath, "existing config");

    await expect(
      runCli(["init", "--config-dir", tempDir], { storage: tempStorage.storage })
    ).rejects.toThrow("process.exit");

    const err = output.stderr.join("\n");
    expect(err).toContain("Config file already exists");
    expect(err).toContain("dex config edit");
  });

  it("detects and configures bash completion with -y flag", async () => {
    // Create .bashrc in temp home
    const bashrcPath = path.join(tempHomeDir, ".bashrc");
    fs.writeFileSync(bashrcPath, "# existing bashrc content\n");

    await runCli(["init", "-y", "--config-dir", tempDir], { storage: tempStorage.storage });

    const out = output.stdout.join("\n");
    expect(out).toContain("Created config file");
    expect(out).toContain("Added completions");

    // Verify completion was added to .bashrc
    const bashrcContent = fs.readFileSync(bashrcPath, "utf-8");
    expect(bashrcContent).toContain("dex completion bash");
    expect(bashrcContent).toContain("# dex completions");
  });

  it("detects and configures zsh completion with -y flag", async () => {
    // Create .zshrc in temp home
    const zshrcPath = path.join(tempHomeDir, ".zshrc");
    fs.writeFileSync(zshrcPath, "# existing zshrc content\n");

    await runCli(["init", "-y", "--config-dir", tempDir], { storage: tempStorage.storage });

    const out = output.stdout.join("\n");
    expect(out).toContain("Added completions");

    // Verify completion was added to .zshrc
    const zshrcContent = fs.readFileSync(zshrcPath, "utf-8");
    expect(zshrcContent).toContain("dex completion zsh");
  });

  it("detects and configures fish completion with -y flag", async () => {
    // Create fish config directory and file
    const fishConfigDir = path.join(tempHomeDir, ".config", "fish");
    fs.mkdirSync(fishConfigDir, { recursive: true });
    const fishConfigPath = path.join(fishConfigDir, "config.fish");
    fs.writeFileSync(fishConfigPath, "# existing fish config\n");

    await runCli(["init", "-y", "--config-dir", tempDir], { storage: tempStorage.storage });

    const out = output.stdout.join("\n");
    expect(out).toContain("Added completions");

    // Verify completion was added to config.fish
    const fishContent = fs.readFileSync(fishConfigPath, "utf-8");
    expect(fishContent).toContain("dex completion fish");
  });

  it("skips shells that are already configured", async () => {
    // Create .bashrc with existing dex completion
    const bashrcPath = path.join(tempHomeDir, ".bashrc");
    fs.writeFileSync(bashrcPath, '# existing\neval "$(dex completion bash)"\n');

    await runCli(["init", "-y", "--config-dir", tempDir], { storage: tempStorage.storage });

    const out = output.stdout.join("\n");
    expect(out).toContain("Created config file");

    // Verify it wasn't added again
    const bashrcContent = fs.readFileSync(bashrcPath, "utf-8");
    const matches = bashrcContent.match(/dex completion/g);
    expect(matches?.length).toBe(1); // Should only appear once
  });

  it("handles multiple shells at once", async () => {
    // Create both .bashrc and .zshrc
    const bashrcPath = path.join(tempHomeDir, ".bashrc");
    const zshrcPath = path.join(tempHomeDir, ".zshrc");
    fs.writeFileSync(bashrcPath, "# bash config\n");
    fs.writeFileSync(zshrcPath, "# zsh config\n");

    await runCli(["init", "-y", "--config-dir", tempDir], { storage: tempStorage.storage });

    const out = output.stdout.join("\n");
    expect(out).toContain("Detected shells: bash, zsh");

    // Verify both were configured
    expect(fs.readFileSync(bashrcPath, "utf-8")).toContain("dex completion bash");
    expect(fs.readFileSync(zshrcPath, "utf-8")).toContain("dex completion zsh");
  });

  it("works with no shells detected", async () => {
    // No shell config files in temp home
    await runCli(["init", "-y", "--config-dir", tempDir], { storage: tempStorage.storage });

    const out = output.stdout.join("\n");
    expect(out).toContain("Created config file");
    // Should not show shell completion section
    expect(out).not.toContain("Shell Completions");
  });

  it("includes documentation URL in output", async () => {
    await runCli(["init", "-y", "--config-dir", tempDir], { storage: tempStorage.storage });

    const out = output.stdout.join("\n");
    expect(out).toContain("https://github.com/dcramer/dex");
  });
});
