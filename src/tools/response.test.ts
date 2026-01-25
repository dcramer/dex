import { describe, it, expect } from "vitest";
import { jsonResponse, errorResponse } from "./response.js";
import { DexError, NotFoundError, ValidationError } from "../errors.js";

describe("response utilities", () => {
  describe("jsonResponse", () => {
    it("formats object as JSON content", () => {
      const data = { id: "123", name: "test" };
      const response = jsonResponse(data);

      expect(response.content).toHaveLength(1);
      expect(response.content[0].type).toBe("text");
      expect(JSON.parse(response.content[0].text)).toEqual(data);
      expect(response.isError).toBeUndefined();
    });

    it("formats array as JSON content", () => {
      const data = [{ id: "1" }, { id: "2" }];
      const response = jsonResponse(data);

      expect(JSON.parse(response.content[0].text)).toEqual(data);
    });

    it("formats primitive values", () => {
      expect(JSON.parse(jsonResponse("test").content[0].text)).toBe("test");
      expect(JSON.parse(jsonResponse(42).content[0].text)).toBe(42);
      expect(JSON.parse(jsonResponse(true).content[0].text)).toBe(true);
      expect(JSON.parse(jsonResponse(null).content[0].text)).toBe(null);
    });

    it("pretty-prints JSON with 2-space indentation", () => {
      const data = { a: 1, b: 2 };
      const response = jsonResponse(data);

      expect(response.content[0].text).toBe('{\n  "a": 1,\n  "b": 2\n}');
    });
  });

  describe("errorResponse", () => {
    it("formats Error as error response", () => {
      const error = new Error("Something went wrong");
      const response = errorResponse(error);

      expect(response.isError).toBe(true);
      expect(response.content).toHaveLength(1);
      const parsed = JSON.parse(response.content[0].text);
      expect(parsed.error).toBe("Something went wrong");
      expect(parsed.suggestion).toBeUndefined();
    });

    it("includes suggestion from DexError", () => {
      const error = new DexError("Failed to process", "Try again later");
      const response = errorResponse(error);

      const parsed = JSON.parse(response.content[0].text);
      expect(parsed.error).toBe("Failed to process");
      expect(parsed.suggestion).toBe("Try again later");
    });

    it("includes suggestion from NotFoundError", () => {
      const error = new NotFoundError("Task", "abc123");
      const response = errorResponse(error);

      const parsed = JSON.parse(response.content[0].text);
      expect(parsed.error).toBe('Task "abc123" not found');
      expect(parsed.suggestion).toContain("dex list");
    });

    it("includes suggestion from ValidationError", () => {
      const error = new ValidationError(
        "Invalid parent",
        "Cannot nest more than 3 levels"
      );
      const response = errorResponse(error);

      const parsed = JSON.parse(response.content[0].text);
      expect(parsed.error).toBe("Invalid parent");
      expect(parsed.suggestion).toBe("Cannot nest more than 3 levels");
    });

    it("handles string errors", () => {
      const response = errorResponse("Raw string error");

      const parsed = JSON.parse(response.content[0].text);
      expect(parsed.error).toBe("Raw string error");
    });

    it("handles unknown error types", () => {
      const response = errorResponse({ custom: "object" });

      const parsed = JSON.parse(response.content[0].text);
      expect(parsed.error).toBe("[object Object]");
    });
  });
});
