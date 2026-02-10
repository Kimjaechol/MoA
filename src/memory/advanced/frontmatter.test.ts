import { describe, it, expect } from "vitest";
import {
  parseFrontmatter,
  serializeFrontmatter,
  extractInternalLinks,
  extractExternalLinks,
  autoLinkEntities,
} from "./frontmatter.js";

describe("parseFrontmatter", () => {
  it("parses YAML frontmatter from markdown", () => {
    const content = `---
id: mem_20260310_001
type: dispute
created: "2026-03-10T14:30:00+09:00"
people: ["민수씨", "민수씨 아내"]
case: 잔디밭_분쟁_2026-03
place: 우리집 앞마당
tags: [이웃분쟁, 잔디밭, 경계선]
importance: 7
status: active
---

# 옆집 민수씨와 잔디밭 경계 분쟁

내용입니다.`;

    const { frontmatter, body } = parseFrontmatter(content);
    expect(frontmatter).not.toBeNull();
    expect(frontmatter!.id).toBe("mem_20260310_001");
    expect(frontmatter!.type).toBe("dispute");
    expect(frontmatter!.importance).toBe(7);
    expect(frontmatter!.status).toBe("active");
    expect(body).toContain("# 옆집 민수씨와 잔디밭 경계 분쟁");
  });

  it("returns null frontmatter when no frontmatter present", () => {
    const content = "# Just a heading\n\nSome content without frontmatter.";
    const { frontmatter, body } = parseFrontmatter(content);
    expect(frontmatter).toBeNull();
    expect(body).toBe(content);
  });

  it("handles inline arrays", () => {
    const content = `---
tags: [tag1, tag2, tag3]
---

Body.`;

    const { frontmatter } = parseFrontmatter(content);
    expect(frontmatter).not.toBeNull();
    expect(frontmatter!.tags).toEqual(["tag1", "tag2", "tag3"]);
  });

  it("handles boolean and number values", () => {
    const content = `---
importance: 8
status: active
confidence: 0.9
---

Body.`;

    const { frontmatter } = parseFrontmatter(content);
    expect(frontmatter!.importance).toBe(8);
    expect(frontmatter!.confidence).toBe(0.9);
  });
});

describe("serializeFrontmatter", () => {
  it("serializes frontmatter to markdown", () => {
    const frontmatter = {
      id: "test_001",
      type: "meeting" as const,
      created: "2026-03-10T14:30:00Z",
      tags: ["work", "meeting"],
      importance: 7,
    };
    const body = "# Meeting Notes\n\nContent here.";

    const result = serializeFrontmatter(frontmatter, body);
    expect(result).toContain("---");
    expect(result).toContain("id: test_001");
    expect(result).toContain("type: meeting");
    expect(result).toContain("importance: 7");
    expect(result).toContain("# Meeting Notes");
  });

  it("handles empty frontmatter", () => {
    const result = serializeFrontmatter({}, "Just body content.");
    expect(result).toBe("Just body content.");
  });
});

describe("extractInternalLinks", () => {
  it("extracts [[simple links]]", () => {
    const content = "Talked to [[옆집 민수씨]] about [[잔디밭_분쟁_2026-03|잔디밭 경계]].";
    const links = extractInternalLinks(content);
    expect(links).toHaveLength(2);
    expect(links[0].target).toBe("옆집 민수씨");
    expect(links[1].target).toBe("잔디밭_분쟁_2026-03");
    expect(links[1].display).toBe("잔디밭 경계");
  });

  it("deduplicates links", () => {
    const content = "Talked to [[John]] and then [[John]] again.";
    const links = extractInternalLinks(content);
    expect(links).toHaveLength(1);
  });

  it("returns empty array for no links", () => {
    const links = extractInternalLinks("No links here.");
    expect(links).toHaveLength(0);
  });
});

describe("extractExternalLinks", () => {
  it("extracts markdown-style external links", () => {
    const content = "See [Google](https://google.com) and [GitHub](https://github.com).";
    const links = extractExternalLinks(content);
    expect(links).toHaveLength(2);
    expect(links[0].title).toBe("Google");
    expect(links[0].url).toBe("https://google.com");
  });
});

describe("autoLinkEntities", () => {
  it("wraps entity names with [[]]", () => {
    const content = "I talked to 민수씨 about the project.";
    const result = autoLinkEntities(content, ["민수씨"]);
    expect(result).toContain("[[민수씨]]");
  });

  it("does not double-link already linked entities", () => {
    const content = "I talked to [[민수씨]] about the project.";
    const result = autoLinkEntities(content, ["민수씨"]);
    expect(result).toBe(content);
  });
});
