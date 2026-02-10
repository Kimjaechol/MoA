import { describe, it, expect } from "vitest";
import {
  parseFrontmatter,
  serializeFrontmatter,
  extractInternalLinks,
  extractLinkTargets,
  autoLinkEntities,
  frontmatterToMetadata,
} from "./frontmatter.js";

describe("parseFrontmatter", () => {
  it("parses YAML frontmatter from markdown", () => {
    const content = `---
type: dispute
importance: 7
tags: [이웃분쟁, 잔디밭]
---

# Some content`;

    const { frontmatter, body } = parseFrontmatter(content);
    expect(frontmatter.type).toBe("dispute");
    expect(frontmatter.importance).toBe(7);
    expect(frontmatter.tags).toEqual(["이웃분쟁", "잔디밭"]);
    expect(body).toContain("# Some content");
  });

  it("returns empty frontmatter for content without YAML", () => {
    const { frontmatter, body } = parseFrontmatter("Just plain text");
    expect(frontmatter).toEqual({});
    expect(body).toBe("Just plain text");
  });

  it("parses people with identifier", () => {
    const content = `---
people:
  - name: 민수씨
    identifier: 옆집, 40대
  - name: 영희
    identifier: 디자이너
---

Body`;

    const { frontmatter } = parseFrontmatter(content);
    expect(frontmatter.people).toBeDefined();
    const people = frontmatter.people as Array<{ name: string; identifier: string }>;
    expect(people).toHaveLength(2);
    expect(people[0].name).toBe("민수씨");
    expect(people[0].identifier).toContain("옆집");
  });

  it("parses nested objects", () => {
    const content = `---
type: dispute
status: active
emotion: frustrated
---

Body text`;

    const { frontmatter } = parseFrontmatter(content);
    expect(frontmatter.type).toBe("dispute");
    expect(frontmatter.status).toBe("active");
    expect(frontmatter.emotion).toBe("frustrated");
  });
});

describe("serializeFrontmatter", () => {
  it("serializes frontmatter back to markdown", () => {
    const fm = { type: "dispute", importance: 7, tags: ["분쟁", "이웃"] };
    const result = serializeFrontmatter(fm, "# Content");
    expect(result).toContain("---");
    expect(result).toContain("type: dispute");
    expect(result).toContain("importance: 7");
    expect(result).toContain("# Content");
  });

  it("serializes people with identifiers", () => {
    const fm = {
      people: [
        { name: "민수씨", identifier: "옆집, 40대" },
        { name: "영희", identifier: "디자이너" },
      ],
    };
    const result = serializeFrontmatter(fm, "Body");
    expect(result).toContain("민수씨");
    expect(result).toContain("옆집, 40대");
  });
});

describe("extractInternalLinks", () => {
  it("extracts [[target]] links", () => {
    const links = extractInternalLinks("대화 중 [[민수씨]]가 [[잔디밭_분쟁]]을 언급했다.");
    expect(links).toHaveLength(2);
    expect(links[0].target).toBe("민수씨");
    expect(links[1].target).toBe("잔디밭_분쟁");
  });

  it("extracts [[target|display]] links", () => {
    const links = extractInternalLinks("[[잔디밭_분쟁_2026-03|잔디밭 경계]] 문제");
    expect(links).toHaveLength(1);
    expect(links[0].target).toBe("잔디밭_분쟁_2026-03");
    expect(links[0].display).toBe("잔디밭 경계");
  });
});

describe("extractLinkTargets", () => {
  it("returns deduplicated link targets", () => {
    const targets = extractLinkTargets(
      "[[민수씨]]와 [[잔디밭_분쟁]] 관련. [[민수씨]]에게 다시 연락.",
    );
    expect(targets).toHaveLength(2);
    expect(targets).toContain("민수씨");
    expect(targets).toContain("잔디밭_분쟁");
  });
});

describe("autoLinkEntities", () => {
  it("wraps entity names with [[]]", () => {
    const result = autoLinkEntities("민수씨와 잔디밭에서 대화했다.", ["민수씨", "잔디밭"]);
    expect(result).toContain("[[민수씨]]");
    expect(result).toContain("[[잔디밭]]");
  });

  it("does not double-link already linked entities", () => {
    const result = autoLinkEntities("[[민수씨]]와 이야기했다.", ["민수씨"]);
    expect(result).toBe("[[민수씨]]와 이야기했다.");
  });

  it("links longer names first", () => {
    const result = autoLinkEntities("옆집 민수씨와 민수씨 아내가 왔다.", [
      "민수씨",
      "옆집 민수씨",
      "민수씨 아내",
    ]);
    expect(result).toContain("[[옆집 민수씨]]");
    expect(result).toContain("[[민수씨 아내]]");
  });
});

describe("frontmatterToMetadata", () => {
  it("converts frontmatter to ExtractedMetadata", () => {
    const fm = {
      type: "dispute",
      people: [{ name: "민수씨", identifier: "옆집" }],
      tags: ["분쟁", "이웃"],
      importance: 8,
      emotion: "frustrated",
      domain: "daily",
      case: "잔디밭_분쟁",
    };

    const meta = frontmatterToMetadata(fm);
    expect(meta.type).toBe("dispute");
    expect(meta.people).toHaveLength(1);
    expect(meta.people![0].name).toBe("민수씨");
    expect(meta.tags).toEqual(["분쟁", "이웃"]);
    expect(meta.importance).toBe(8);
    expect(meta.caseRef).toBe("잔디밭_분쟁");
  });

  it("handles string-only people entries", () => {
    const fm = { people: ["민수씨", "영희"] };
    const meta = frontmatterToMetadata(fm);
    expect(meta.people).toHaveLength(2);
    expect(meta.people![0].name).toBe("민수씨");
    expect(meta.people![1].name).toBe("영희");
  });
});
