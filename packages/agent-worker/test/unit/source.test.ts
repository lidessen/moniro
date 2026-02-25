import { describe, test, expect } from "bun:test";
import { parseGitHubRef, isRemoteSource } from "../../src/workflow/source.ts";

describe("isRemoteSource", () => {
  test("detects github: prefix", () => {
    expect(isRemoteSource("github:owner/repo/path.yml")).toBe(true);
    expect(isRemoteSource("github:owner/repo#name")).toBe(true);
  });

  test("rejects local paths", () => {
    expect(isRemoteSource("./review.yml")).toBe(false);
    expect(isRemoteSource("review.yml")).toBe(false);
    expect(isRemoteSource("/absolute/path.yml")).toBe(false);
  });
});

describe("parseGitHubRef", () => {
  describe("full path format", () => {
    test("parses owner/repo/path with default ref", () => {
      const ref = parseGitHubRef("github:lidessen/moniro/workflows/review.yml");
      expect(ref).toEqual({
        owner: "lidessen",
        repo: "moniro",
        ref: "main",
        path: "workflows/review.yml",
      });
    });

    test("parses owner/repo@ref/path", () => {
      const ref = parseGitHubRef("github:lidessen/moniro@v1.0/workflows/review.yml");
      expect(ref).toEqual({
        owner: "lidessen",
        repo: "moniro",
        ref: "v1.0",
        path: "workflows/review.yml",
      });
    });

    test("parses branch ref with slashes in path", () => {
      const ref = parseGitHubRef("github:acme/tools@main/deep/nested/workflow.yml");
      expect(ref).toEqual({
        owner: "acme",
        repo: "tools",
        ref: "main",
        path: "deep/nested/workflow.yml",
      });
    });

    test("parses commit hash as ref", () => {
      const ref = parseGitHubRef("github:acme/tools@abc123/workflows/ci.yml");
      expect(ref).toEqual({
        owner: "acme",
        repo: "tools",
        ref: "abc123",
        path: "workflows/ci.yml",
      });
    });
  });

  describe("shorthand format", () => {
    test("parses owner/repo#name with default ref", () => {
      const ref = parseGitHubRef("github:lidessen/moniro#review");
      expect(ref).toEqual({
        owner: "lidessen",
        repo: "moniro",
        ref: "main",
        path: "workflows/review.yml",
      });
    });

    test("parses owner/repo@ref#name", () => {
      const ref = parseGitHubRef("github:lidessen/moniro@v2#review");
      expect(ref).toEqual({
        owner: "lidessen",
        repo: "moniro",
        ref: "v2",
        path: "workflows/review.yml",
      });
    });
  });

  describe("error cases", () => {
    test("throws on missing github: prefix", () => {
      expect(() => parseGitHubRef("owner/repo/path.yml")).toThrow("Not a GitHub reference");
    });

    test("throws on incomplete path (only owner/repo)", () => {
      expect(() => parseGitHubRef("github:owner/repo")).toThrow("Invalid GitHub reference");
    });

    test("throws on missing name after #", () => {
      expect(() => parseGitHubRef("github:owner/repo#")).toThrow("Missing workflow name");
    });

    test("throws on empty ref after @", () => {
      expect(() => parseGitHubRef("github:owner/repo@/path.yml")).toThrow("Empty ref");
    });

    test("throws on missing repo", () => {
      expect(() => parseGitHubRef("github:owner")).toThrow("Invalid GitHub reference");
    });

    test("rejects ref with shell metacharacters", () => {
      expect(() => parseGitHubRef("github:owner/repo@main;rm -rf //path.yml")).toThrow(
        "Invalid git ref",
      );
      expect(() => parseGitHubRef("github:owner/repo@$(whoami)#name")).toThrow("Invalid git ref");
      expect(() => parseGitHubRef("github:owner/repo@`id`/path.yml")).toThrow("Invalid git ref");
    });

    test("accepts valid refs", () => {
      // semver tag
      expect(parseGitHubRef("github:owner/repo@v1.2.3#name").ref).toBe("v1.2.3");
      // SHA
      expect(parseGitHubRef("github:owner/repo@abc1234/workflows/a.yml").ref).toBe("abc1234");
      // branch with hyphens and dots
      expect(parseGitHubRef("github:owner/repo@release-2.0/workflows/a.yml").ref).toBe(
        "release-2.0",
      );
    });
  });
});
