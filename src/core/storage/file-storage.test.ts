import { describe, it, expect } from "vitest";
import * as path from "node:path";
import * as os from "node:os";
import { FileStorage } from "./file-storage.js";

describe("FileStorage", () => {
  describe("tilde expansion", () => {
    it("expands ~ in string path", () => {
      const storage = new FileStorage("~/.dex");
      const identifier = storage.getIdentifier();

      // Should expand to home directory
      expect(identifier).toBe(path.join(os.homedir(), ".dex"));
      expect(identifier).not.toContain("~");
    });

    it("expands ~ in options.path", () => {
      const storage = new FileStorage({ path: "~/.dex" });
      const identifier = storage.getIdentifier();

      // Should expand to home directory
      expect(identifier).toBe(path.join(os.homedir(), ".dex"));
      expect(identifier).not.toContain("~");
    });

    it("expands ~/subdir correctly", () => {
      const storage = new FileStorage("~/custom/path/.dex");
      const identifier = storage.getIdentifier();

      expect(identifier).toBe(
        path.join(os.homedir(), "custom", "path", ".dex"),
      );
      expect(identifier).not.toContain("~");
    });

    it("leaves absolute paths unchanged", () => {
      const storage = new FileStorage("/absolute/path/.dex");
      const identifier = storage.getIdentifier();

      expect(identifier).toBe("/absolute/path/.dex");
    });

    it("leaves relative paths unchanged", () => {
      const storage = new FileStorage("./.dex");
      const identifier = storage.getIdentifier();

      expect(identifier).toBe("./.dex");
    });
  });
});
