import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { accessSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createSkillTool,
  parseImportSpec,
  buildGitUrl,
  getSpecDisplayName,
  SkillImporter,
} from "@moniro/agent-loop";

// Test skill content
const validSkillMd = `---
name: test-skill
description: A test skill for validation
---

# Test Skill

This is a test skill.

## See Also

Check [references/example.md](references/example.md) for details.
`;

const exampleReference = `# Example Reference

This is a reference file for progressive disclosure.
`;

// ==================== createSkillTool Tests ====================

describe("createSkillTool", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `skills-tool-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {}
  });

  test("discovers skills from directory", async () => {
    const skillDir = join(testDir, "test-skill");
    mkdirSync(skillDir);
    writeFileSync(join(skillDir, "SKILL.md"), validSkillMd);

    const toolkit = await createSkillTool({ skillsDirectory: testDir });

    expect(toolkit.skills).toHaveLength(1);
    expect(toolkit.skills[0]!.name).toBe("test-skill");
    expect(toolkit.skills[0]!.description).toBe("A test skill for validation");
  });

  test("returns skill tool", async () => {
    const skillDir = join(testDir, "test-skill");
    mkdirSync(skillDir);
    writeFileSync(join(skillDir, "SKILL.md"), validSkillMd);

    const toolkit = await createSkillTool({ skillsDirectory: testDir });

    expect(toolkit.skill).toBeDefined();
    expect(toolkit.skill.description).toContain("test-skill");
  });

  test("collects files for bash tool", async () => {
    const skillDir = join(testDir, "test-skill");
    const refsDir = join(skillDir, "references");
    mkdirSync(refsDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), validSkillMd);
    writeFileSync(join(refsDir, "example.md"), exampleReference);

    const toolkit = await createSkillTool({ skillsDirectory: testDir });

    // Files should include both SKILL.md and reference
    const fileKeys = Object.keys(toolkit.files);
    expect(fileKeys.length).toBeGreaterThanOrEqual(2);
    expect(fileKeys.some((k) => k.includes("SKILL.md"))).toBe(true);
    expect(fileKeys.some((k) => k.includes("example.md"))).toBe(true);
  });

  test("generates instructions for bash tool", async () => {
    const skillDir = join(testDir, "test-skill");
    mkdirSync(skillDir);
    writeFileSync(join(skillDir, "SKILL.md"), validSkillMd);

    const toolkit = await createSkillTool({ skillsDirectory: testDir });

    expect(toolkit.instructions).toContain("test-skill");
    expect(toolkit.instructions).toContain("SKILL");
  });

  test("skill tool loads instructions", async () => {
    const skillDir = join(testDir, "test-skill");
    mkdirSync(skillDir);
    writeFileSync(join(skillDir, "SKILL.md"), validSkillMd);

    const toolkit = await createSkillTool({ skillsDirectory: testDir });
    const result = (await toolkit.skill.execute!(
      { skillName: "test-skill" },
      {} as never,
    )) as any;

    expect(result.success).toBe(true);
    expect(result.skill.name).toBe("test-skill");
    expect(result.instructions).toContain("Test Skill");
  });

  test("skill tool returns error for unknown skill", async () => {
    const skillDir = join(testDir, "test-skill");
    mkdirSync(skillDir);
    writeFileSync(join(skillDir, "SKILL.md"), validSkillMd);

    const toolkit = await createSkillTool({ skillsDirectory: testDir });
    const result = (await toolkit.skill.execute!(
      { skillName: "nonexistent" },
      {} as never,
    )) as any;

    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });

  test("discovers multiple skills", async () => {
    for (const name of ["skill-one", "skill-two"]) {
      const dir = join(testDir, name);
      mkdirSync(dir);
      writeFileSync(
        join(dir, "SKILL.md"),
        `---\nname: ${name}\ndescription: ${name} desc\n---\n# ${name}\n`,
      );
    }
    // Create non-skill directory
    mkdirSync(join(testDir, "not-a-skill"));

    const toolkit = await createSkillTool({ skillsDirectory: testDir });

    expect(toolkit.skills).toHaveLength(2);
    expect(toolkit.skills.map((s) => s.name).sort()).toEqual(["skill-one", "skill-two"]);
  });

  test("returns empty when no skills found", async () => {
    const toolkit = await createSkillTool({ skillsDirectory: testDir });

    expect(toolkit.skills).toHaveLength(0);
    expect(Object.keys(toolkit.files)).toHaveLength(0);
  });

  test("custom destination for sandbox paths", async () => {
    const skillDir = join(testDir, "test-skill");
    mkdirSync(skillDir);
    writeFileSync(join(skillDir, "SKILL.md"), validSkillMd);

    const toolkit = await createSkillTool({
      skillsDirectory: testDir,
      destination: "my-skills",
    });

    expect(toolkit.skills[0]!.sandboxPath).toContain("my-skills");
  });

  test("works with AgentWorker", async () => {
    const { AgentWorker } = await import("@moniro/agent-loop");

    const skillDir = join(testDir, "session-skill");
    mkdirSync(skillDir);
    writeFileSync(
      join(skillDir, "SKILL.md"),
      `---\nname: session-skill\ndescription: Skill for session testing\n---\n# Session Skill\n`,
    );

    const toolkit = await createSkillTool({ skillsDirectory: testDir });

    const session = new AgentWorker({
      model: "openai/gpt-5.2",
      system: "You are a helpful assistant.",
      tools: { skill: toolkit.skill as any },
    });

    expect(session.id).toBeDefined();
    const tools = session.getTools();
    expect(tools.map((t) => t.name)).toContain("skill");
  });
});

// ==================== Import Spec Tests ====================

describe("parseImportSpec", () => {
  test("parses minimal spec (owner/repo)", () => {
    const spec = parseImportSpec("vercel-labs/agent-skills");
    expect(spec.provider).toBe("github");
    expect(spec.owner).toBe("vercel-labs");
    expect(spec.repo).toBe("agent-skills");
    expect(spec.ref).toBe("main");
    expect(spec.skills).toBe("all");
    expect(spec.rawSpec).toBe("vercel-labs/agent-skills");
  });

  test("parses with single skill", () => {
    const spec = parseImportSpec("vercel-labs/agent-skills:react");
    expect(spec.skills).toEqual(["react"]);
  });

  test("parses with multiple skills (brace expansion)", () => {
    const spec = parseImportSpec("vercel-labs/agent-skills:{react,web,nextjs}");
    expect(spec.skills).toEqual(["react", "web", "nextjs"]);
  });

  test("parses with ref", () => {
    const spec = parseImportSpec("vercel-labs/agent-skills@v1.0.0:react");
    expect(spec.ref).toBe("v1.0.0");
    expect(spec.skills).toEqual(["react"]);
  });

  test("parses with provider", () => {
    const spec = parseImportSpec("gitlab:myorg/myrepo:skill1");
    expect(spec.provider).toBe("gitlab");
    expect(spec.owner).toBe("myorg");
    expect(spec.repo).toBe("myrepo");
  });

  test("parses gitee provider", () => {
    const spec = parseImportSpec("gitee:org/repo@main:{a,b}");
    expect(spec.provider).toBe("gitee");
    expect(spec.ref).toBe("main");
    expect(spec.skills).toEqual(["a", "b"]);
  });

  test("throws on invalid format", () => {
    expect(() => parseImportSpec("invalid")).toThrow("Invalid import spec");
    expect(() => parseImportSpec("no-slash")).toThrow("Invalid import spec");
    expect(() => parseImportSpec("/no-owner/repo")).toThrow("Invalid import spec");
  });

  test("throws on unsupported provider", () => {
    expect(() => parseImportSpec("bitbucket:owner/repo")).toThrow("Unsupported provider");
  });

  test("throws on empty skill list in braces", () => {
    expect(() => parseImportSpec("owner/repo:{}")).toThrow("Empty skill list in braces");
  });

  test("handles whitespace in skill lists", () => {
    const spec = parseImportSpec("owner/repo:{ a , b , c }");
    expect(spec.skills).toEqual(["a", "b", "c"]);
  });

  // Security tests: prevent git argument injection
  test("rejects owner starting with hyphen", () => {
    expect(() => parseImportSpec("--upload-pack=evil/repo")).toThrow("Invalid owner");
  });

  test("rejects repo starting with hyphen", () => {
    expect(() => parseImportSpec("owner/--config=evil")).toThrow("Invalid repo");
  });

  test("rejects ref starting with hyphen", () => {
    expect(() => parseImportSpec("owner/repo@--upload-pack=evil")).toThrow("Invalid ref");
  });

  test("rejects owner with shell metacharacters", () => {
    expect(() => parseImportSpec("owner;whoami/repo")).toThrow("Invalid owner");
    expect(() => parseImportSpec("owner$(cmd)/repo")).toThrow("Invalid owner");
    expect(() => parseImportSpec("owner`cmd`/repo")).toThrow("Invalid owner");
  });

  test("rejects repo with shell metacharacters", () => {
    expect(() => parseImportSpec("owner/repo;whoami")).toThrow("Invalid repo");
    expect(() => parseImportSpec("owner/repo&&cmd")).toThrow("Invalid repo");
    expect(() => parseImportSpec("owner/repo|cat")).toThrow("Invalid repo");
  });

  test("rejects ref with shell metacharacters", () => {
    expect(() => parseImportSpec("owner/repo@v1.0;evil")).toThrow("Invalid ref");
  });

  test("rejects names with spaces", () => {
    expect(() => parseImportSpec("owner with spaces/repo")).toThrow("Invalid owner");
    expect(() => parseImportSpec("owner/repo with spaces")).toThrow("Invalid repo");
  });

  test("rejects names with quotes", () => {
    expect(() => parseImportSpec('owner/"repo"')).toThrow("Invalid repo");
    expect(() => parseImportSpec("owner/'repo'")).toThrow("Invalid repo");
  });

  test("rejects names with newlines", () => {
    expect(() => parseImportSpec("owner/repo\nmalicious")).toThrow("Invalid repo");
  });

  test("rejects names with null bytes", () => {
    expect(() => parseImportSpec("owner/repo\x00")).toThrow("Invalid repo");
  });

  test("accepts valid names with hyphens, underscores, dots", () => {
    const spec1 = parseImportSpec("my-org/my-repo");
    expect(spec1.owner).toBe("my-org");
    expect(spec1.repo).toBe("my-repo");

    const spec2 = parseImportSpec("my_org/my_repo.js");
    expect(spec2.owner).toBe("my_org");
    expect(spec2.repo).toBe("my_repo.js");

    const spec3 = parseImportSpec("org123/repo456@v1.2.3");
    expect(spec3.ref).toBe("v1.2.3");
  });
});

describe("buildGitUrl", () => {
  test("builds GitHub URL", () => {
    const spec = parseImportSpec("vercel-labs/agent-skills");
    const url = buildGitUrl(spec);
    expect(url).toBe("https://github.com/vercel-labs/agent-skills.git");
  });

  test("builds GitLab URL", () => {
    const spec = parseImportSpec("gitlab:myorg/myrepo");
    const url = buildGitUrl(spec);
    expect(url).toBe("https://gitlab.com/myorg/myrepo.git");
  });

  test("builds Gitee URL", () => {
    const spec = parseImportSpec("gitee:org/repo");
    const url = buildGitUrl(spec);
    expect(url).toBe("https://gitee.com/org/repo.git");
  });
});

describe("getSpecDisplayName", () => {
  test('displays "all skills" when skills is "all"', () => {
    const spec = parseImportSpec("owner/repo");
    const name = getSpecDisplayName(spec);
    expect(name).toBe("owner/repo@main (all skills)");
  });

  test("displays single skill name", () => {
    const spec = parseImportSpec("owner/repo:react");
    const name = getSpecDisplayName(spec);
    expect(name).toBe("owner/repo@main (react)");
  });

  test("displays skill count for multiple skills", () => {
    const spec = parseImportSpec("owner/repo:{a,b,c}");
    const name = getSpecDisplayName(spec);
    expect(name).toBe("owner/repo@main (3 skills)");
  });
});

// ==================== SkillImporter Tests ====================

describe("SkillImporter", () => {
  let importer: SkillImporter;
  let sessionId: string;

  beforeEach(() => {
    sessionId = `test-${Date.now()}`;
    importer = new SkillImporter(sessionId);
  });

  afterEach(async () => {
    await importer.cleanup();
  });

  test("creates temp directory with session ID", () => {
    const tempDir = importer.getTempDir();
    expect(tempDir).toContain(`agent-worker-skills-${sessionId}`);
  });

  test("cleanup removes temp directory", async () => {
    const tempDir = importer.getTempDir();

    // Create temp dir to simulate import
    mkdirSync(tempDir, { recursive: true });
    writeFileSync(join(tempDir, "test.txt"), "test");

    await importer.cleanup();

    // Verify it's gone
    expect(() => accessSync(tempDir)).toThrow();
  });

  test("getImportedSkills returns empty array initially", () => {
    expect(importer.getImportedSkills()).toEqual([]);
  });

  test("getAllImportedSkillPaths returns empty array initially", () => {
    expect(importer.getAllImportedSkillPaths()).toEqual([]);
  });

  test("getImportedSkillPath returns null for unknown skill", () => {
    expect(importer.getImportedSkillPath("unknown")).toBeNull();
  });

  test("importMultiple handles multiple specs", async () => {
    // Mock the import method to avoid actual git clones
    const originalImport = importer.import.bind(importer);
    let importCalls = 0;

    importer.import = async (spec: string) => {
      importCalls++;
      // Simulate failure for one spec
      if (spec.includes("failing")) {
        throw new Error("Git clone failed");
      }
      return [];
    };

    const specs = ["owner/repo1:skill1", "owner/failing:skill2", "owner/repo3:skill3"];
    const result = await importer.importMultiple(specs);

    // Should continue after error
    expect(importCalls).toBe(3);
    expect(result).toEqual([]);

    // Restore original method
    importer.import = originalImport;
  });

  test("cleanup is safe when temp dir does not exist", async () => {
    // Should not throw when cleaning up non-existent directory
    await expect(importer.cleanup()).resolves.toBeUndefined();
  });

  test("cleanup can be called multiple times", async () => {
    const tempDir = importer.getTempDir();
    mkdirSync(tempDir, { recursive: true });

    await importer.cleanup();
    await importer.cleanup(); // Should not throw

    // Still cleaned up
    expect(() => accessSync(tempDir)).toThrow();
  });

  test("getImportedSkills returns imported skill metadata", () => {
    // Manually set an imported skill to test getters
    const mockSkill = {
      name: "test-skill",
      source: "owner/repo:test-skill",
      tempPath: "/tmp/test-skill",
    };

    // Access private property for testing
    (importer as any).imported.set("test-skill", mockSkill);

    const skills = importer.getImportedSkills();
    expect(skills).toHaveLength(1);
    expect(skills[0]).toEqual(mockSkill);

    const path = importer.getImportedSkillPath("test-skill");
    expect(path).toBe("/tmp/test-skill");

    const paths = importer.getAllImportedSkillPaths();
    expect(paths).toEqual(["/tmp/test-skill"]);
  });

  test("getSkillsDirectory creates flat symlink directory", async () => {
    const tempDir = importer.getTempDir();

    // Simulate the nested clone structure: tempDir/owner-repo/skills/skill-a/SKILL.md
    const nestedSkillPath = join(tempDir, "owner-repo", "skills", "skill-a");
    mkdirSync(nestedSkillPath, { recursive: true });
    writeFileSync(
      join(nestedSkillPath, "SKILL.md"),
      `---\nname: skill-a\ndescription: Test skill A\n---\n# Skill A\n`,
    );

    const nestedSkillPath2 = join(tempDir, "owner-repo", "skills", "skill-b");
    mkdirSync(nestedSkillPath2, { recursive: true });
    writeFileSync(
      join(nestedSkillPath2, "SKILL.md"),
      `---\nname: skill-b\ndescription: Test skill B\n---\n# Skill B\n`,
    );

    // Register imported skills (simulates what extractSkills does)
    (importer as any).imported.set("skill-a", {
      name: "skill-a",
      source: "owner/repo:{skill-a,skill-b}",
      tempPath: nestedSkillPath,
    });
    (importer as any).imported.set("skill-b", {
      name: "skill-b",
      source: "owner/repo:{skill-a,skill-b}",
      tempPath: nestedSkillPath2,
    });

    // getSkillsDirectory should create a flat directory with symlinks
    const skillsDir = await importer.getSkillsDirectory();
    expect(skillsDir).toContain("_skills");

    // Verify symlinks exist and point to correct paths
    const { lstatSync, readlinkSync } = await import("node:fs");
    const linkA = join(skillsDir, "skill-a");
    const linkB = join(skillsDir, "skill-b");
    expect(lstatSync(linkA).isSymbolicLink()).toBe(true);
    expect(lstatSync(linkB).isSymbolicLink()).toBe(true);
    expect(readlinkSync(linkA)).toBe(nestedSkillPath);
    expect(readlinkSync(linkB)).toBe(nestedSkillPath2);
  });

  test("getSkillsDirectory works with createSkillTool", async () => {
    const tempDir = importer.getTempDir();

    // Create nested skill structure
    const skillPath = join(tempDir, "owner-repo", "skills", "test-skill");
    mkdirSync(skillPath, { recursive: true });
    writeFileSync(
      join(skillPath, "SKILL.md"),
      `---\nname: test-skill\ndescription: Imported test skill\n---\n# Imported Skill\nInstructions here.\n`,
    );

    (importer as any).imported.set("test-skill", {
      name: "test-skill",
      source: "owner/repo:test-skill",
      tempPath: skillPath,
    });

    // The full flow: importer → getSkillsDirectory → createSkillTool
    const skillsDir = await importer.getSkillsDirectory();
    const toolkit = await createSkillTool({ skillsDirectory: skillsDir });

    expect(toolkit.skills).toHaveLength(1);
    expect(toolkit.skills[0]!.name).toBe("test-skill");

    // Verify the skill tool can load instructions
    const result = (await toolkit.skill.execute!(
      { skillName: "test-skill" },
      {} as never,
    )) as any;
    expect(result.success).toBe(true);
    expect(result.instructions).toContain("Imported Skill");
  });

  test("getSkillsDirectory is idempotent", async () => {
    const tempDir = importer.getTempDir();
    const skillPath = join(tempDir, "owner-repo", "skills", "my-skill");
    mkdirSync(skillPath, { recursive: true });
    writeFileSync(
      join(skillPath, "SKILL.md"),
      `---\nname: my-skill\ndescription: Test\n---\n# Test\n`,
    );

    (importer as any).imported.set("my-skill", {
      name: "my-skill",
      source: "owner/repo:my-skill",
      tempPath: skillPath,
    });

    const dir1 = await importer.getSkillsDirectory();
    const dir2 = await importer.getSkillsDirectory();
    expect(dir1).toBe(dir2);
  });

  test("getSkillsDirectory updates symlinks when skill is re-imported", async () => {
    const tempDir = importer.getTempDir();
    const { readlinkSync } = await import("node:fs");

    // First import: skill-a at path v1
    const v1Path = join(tempDir, "repo-v1", "skills", "skill-a");
    mkdirSync(v1Path, { recursive: true });
    writeFileSync(
      join(v1Path, "SKILL.md"),
      `---\nname: skill-a\ndescription: Version 1\n---\n# V1\n`,
    );

    (importer as any).imported.set("skill-a", {
      name: "skill-a",
      source: "owner/repo:skill-a",
      tempPath: v1Path,
    });

    const dir1 = await importer.getSkillsDirectory();
    expect(readlinkSync(join(dir1, "skill-a"))).toBe(v1Path);

    // Re-import: skill-a now points to v2
    const v2Path = join(tempDir, "repo-v2", "skills", "skill-a");
    mkdirSync(v2Path, { recursive: true });
    writeFileSync(
      join(v2Path, "SKILL.md"),
      `---\nname: skill-a\ndescription: Version 2\n---\n# V2\n`,
    );

    (importer as any).imported.set("skill-a", {
      name: "skill-a",
      source: "owner/repo@v2:skill-a",
      tempPath: v2Path,
    });

    // getSkillsDirectory must reflect the updated path
    const dir2 = await importer.getSkillsDirectory();
    expect(readlinkSync(join(dir2, "skill-a"))).toBe(v2Path);
  });
});
