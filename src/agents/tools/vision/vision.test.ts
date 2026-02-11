import JSZip from "jszip";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { convertDocToHtml } from "./converter/doc-to-html.js";
import { generateEditorHtml } from "./converter/editor-template.js";
import { convertHtmlToMarkdown } from "./converter/html-to-markdown.js";
import { convertDocument } from "./converter/index.js";
import { createVisionTool } from "./index.js";
import { parseDocument, HWP_CONVERSION_NOTICE } from "./layer2-document.js";

// ─── Layer 2: Document Parser Tests ─────────────────────

describe("layer2-document: parseDocument", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vision-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  it("extracts text from a minimal .docx", async () => {
    const zip = new JSZip();
    zip.file(
      "word/document.xml",
      `<?xml version="1.0" encoding="UTF-8"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>
          <w:p>
            <w:r><w:t>Hello World</w:t></w:r>
          </w:p>
          <w:p>
            <w:r><w:t>Second paragraph</w:t></w:r>
          </w:p>
          <w:sectPr/>
        </w:body>
      </w:document>`,
    );
    zip.file(
      "docProps/core.xml",
      `<?xml version="1.0" encoding="UTF-8"?>
      <cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
                         xmlns:dc="http://purl.org/dc/elements/1.1/"
                         xmlns:dcterms="http://purl.org/dc/terms/">
        <dc:title>Test Document</dc:title>
        <dc:creator>Test Author</dc:creator>
      </cp:coreProperties>`,
    );

    const docxPath = path.join(tmpDir, "test.docx");
    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    await fs.writeFile(docxPath, buffer);

    const result = await parseDocument(docxPath);

    expect(result.type).toBe("docx");
    expect(result.text).toContain("Hello World");
    expect(result.text).toContain("Second paragraph");
    expect(result.metadata.title).toBe("Test Document");
    expect(result.metadata.author).toBe("Test Author");
    expect(result.pageCount).toBeGreaterThanOrEqual(1);
  });

  it("extracts text from a minimal .xlsx", async () => {
    const zip = new JSZip();
    zip.file(
      "xl/sharedStrings.xml",
      `<?xml version="1.0" encoding="UTF-8"?>
      <sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
        <si><t>Name</t></si>
        <si><t>Age</t></si>
        <si><t>Alice</t></si>
      </sst>`,
    );
    zip.file(
      "xl/worksheets/sheet1.xml",
      `<?xml version="1.0" encoding="UTF-8"?>
      <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
        <sheetData>
          <row r="1">
            <c r="A1" t="s"><v>0</v></c>
            <c r="B1" t="s"><v>1</v></c>
          </row>
          <row r="2">
            <c r="A2" t="s"><v>2</v></c>
            <c r="B2"><v>30</v></c>
          </row>
        </sheetData>
      </worksheet>`,
    );

    const xlsxPath = path.join(tmpDir, "test.xlsx");
    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    await fs.writeFile(xlsxPath, buffer);

    const result = await parseDocument(xlsxPath);

    expect(result.type).toBe("xlsx");
    expect(result.text).toContain("Name");
    expect(result.text).toContain("Age");
    expect(result.text).toContain("Alice");
    expect(result.text).toContain("30");
    expect(result.pageCount).toBe(1);
  });

  it("extracts text from a minimal .pptx", async () => {
    const zip = new JSZip();
    zip.file(
      "ppt/slides/slide1.xml",
      `<?xml version="1.0" encoding="UTF-8"?>
      <p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
             xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:cSld>
          <p:spTree>
            <p:sp>
              <p:txBody>
                <a:p><a:r><a:t>Slide Title</a:t></a:r></a:p>
              </p:txBody>
            </p:sp>
          </p:spTree>
        </p:cSld>
      </p:sld>`,
    );
    zip.file(
      "ppt/slides/slide2.xml",
      `<?xml version="1.0" encoding="UTF-8"?>
      <p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
             xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:cSld>
          <p:spTree>
            <p:sp>
              <p:txBody>
                <a:p><a:r><a:t>Second Slide</a:t></a:r></a:p>
              </p:txBody>
            </p:sp>
          </p:spTree>
        </p:cSld>
      </p:sld>`,
    );

    const pptxPath = path.join(tmpDir, "test.pptx");
    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    await fs.writeFile(pptxPath, buffer);

    const result = await parseDocument(pptxPath);

    expect(result.type).toBe("pptx");
    expect(result.text).toContain("Slide Title");
    expect(result.text).toContain("Second Slide");
    expect(result.pageCount).toBe(2);
  });

  it("counts images in documents", async () => {
    const zip = new JSZip();
    zip.file(
      "word/document.xml",
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Text</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`,
    );
    zip.file("word/media/image1.png", Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    zip.file("word/media/image2.jpg", Buffer.from([0xff, 0xd8, 0xff]));

    const docxPath = path.join(tmpDir, "with-images.docx");
    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    await fs.writeFile(docxPath, buffer);

    const result = await parseDocument(docxPath);

    expect(result.imageCount).toBe(2);
  });

  it("respects maxChars option", async () => {
    const zip = new JSZip();
    const longText = "A".repeat(1000);
    zip.file(
      "word/document.xml",
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${longText}</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`,
    );

    const docxPath = path.join(tmpDir, "long.docx");
    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    await fs.writeFile(docxPath, buffer);

    const result = await parseDocument(docxPath, { maxChars: 100 });

    expect(result.text.length).toBeLessThanOrEqual(100);
  });

  it("detects unknown file type", async () => {
    const zip = new JSZip();
    zip.file("content.txt", "some content");

    const unknownPath = path.join(tmpDir, "test.unknown");
    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    await fs.writeFile(unknownPath, buffer);

    const result = await parseDocument(unknownPath);
    expect(result.type).toBe("unknown");
  });

  // ─── HWPX Tests ──────────────────────────────────────

  it("extracts text from a minimal .hwpx", async () => {
    const zip = new JSZip();
    zip.file(
      "Contents/section0.xml",
      `<?xml version="1.0" encoding="UTF-8"?>
      <hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/paragraph">
        <hs:p>
          <hs:run>
            <hs:t>한글 문서 테스트입니다.</hs:t>
          </hs:run>
        </hs:p>
        <hs:p>
          <hs:run>
            <hs:t>두 번째 문단입니다.</hs:t>
          </hs:run>
        </hs:p>
      </hs:sec>`,
    );

    const hwpxPath = path.join(tmpDir, "test.hwpx");
    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    await fs.writeFile(hwpxPath, buffer);

    const result = await parseDocument(hwpxPath);

    expect(result.type).toBe("hwpx");
    expect(result.text).toContain("한글 문서 테스트입니다.");
    expect(result.text).toContain("두 번째 문단입니다.");
    expect(result.pageCount).toBeGreaterThanOrEqual(1);
  });

  it("extracts text from .hwpx with multiple sections", async () => {
    const zip = new JSZip();
    zip.file(
      "Contents/section0.xml",
      `<?xml version="1.0" encoding="UTF-8"?>
      <sec xmlns="http://www.hancom.co.kr/hwpml/2011/paragraph">
        <p><run><t>섹션 1 내용</t></run></p>
      </sec>`,
    );
    zip.file(
      "Contents/section1.xml",
      `<?xml version="1.0" encoding="UTF-8"?>
      <sec xmlns="http://www.hancom.co.kr/hwpml/2011/paragraph">
        <p><run><t>섹션 2 내용</t></run></p>
      </sec>`,
    );

    const hwpxPath = path.join(tmpDir, "multi-section.hwpx");
    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    await fs.writeFile(hwpxPath, buffer);

    const result = await parseDocument(hwpxPath);

    expect(result.type).toBe("hwpx");
    expect(result.text).toContain("섹션 1 내용");
    expect(result.text).toContain("섹션 2 내용");
    expect(result.pageCount).toBe(2);
  });

  it("handles .hwpx with hp: namespace prefix", async () => {
    const zip = new JSZip();
    zip.file(
      "Contents/section0.xml",
      `<?xml version="1.0" encoding="UTF-8"?>
      <hp:sec xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">
        <hp:p>
          <hp:run>
            <hp:t>네임스페이스 접두사 hp 테스트</hp:t>
          </hp:run>
        </hp:p>
      </hp:sec>`,
    );

    const hwpxPath = path.join(tmpDir, "hp-namespace.hwpx");
    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    await fs.writeFile(hwpxPath, buffer);

    const result = await parseDocument(hwpxPath);

    expect(result.type).toBe("hwpx");
    expect(result.text).toContain("네임스페이스 접두사 hp 테스트");
  });

  it("auto-detects HWPX format for unknown extension with section files", async () => {
    const zip = new JSZip();
    zip.file(
      "Contents/section0.xml",
      `<?xml version="1.0" encoding="UTF-8"?>
      <sec><p><run><t>자동 감지 테스트</t></run></p></sec>`,
    );

    const unknownPath = path.join(tmpDir, "test.zip");
    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    await fs.writeFile(unknownPath, buffer);

    const result = await parseDocument(unknownPath);

    // Should auto-detect as HWPX structure
    expect(result.text).toContain("자동 감지 테스트");
  });

  // ─── HWP Notice Test ─────────────────────────────────

  it("returns conversion notice for .hwp binary files", async () => {
    // Create a fake HWP binary file with OLE compound document signature
    const oleSignature = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    const fakeHwp = Buffer.concat([oleSignature, Buffer.alloc(512)]);

    const hwpPath = path.join(tmpDir, "document.hwp");
    await fs.writeFile(hwpPath, fakeHwp);

    const result = await parseDocument(hwpPath);

    expect(result.text).toBe("");
    expect(result.warning).toBeDefined();
    expect(result.warning).toContain("HWP");
    expect(result.warning).toContain("HWPX");
    expect(result.warning).toContain("한글");
  });

  it("HWP_CONVERSION_NOTICE contains conversion instructions", () => {
    expect(HWP_CONVERSION_NOTICE).toContain("HWP 파일 감지");
    expect(HWP_CONVERSION_NOTICE).toContain("HWPX");
    expect(HWP_CONVERSION_NOTICE).toContain("다른 이름으로 저장");
    expect(HWP_CONVERSION_NOTICE).toContain(".hwpx");
  });

  // ─── HWPX XML Entity Decoding ─────────────────────────

  it("handles XML entities in .hwpx text", async () => {
    const zip = new JSZip();
    zip.file(
      "Contents/section0.xml",
      `<?xml version="1.0" encoding="UTF-8"?>
      <sec>
        <p>
          <run><t>A &amp; B &lt; C &gt; D</t></run>
        </p>
      </sec>`,
    );

    const hwpxPath = path.join(tmpDir, "entities.hwpx");
    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    await fs.writeFile(hwpxPath, buffer);

    const result = await parseDocument(hwpxPath);

    expect(result.text).toContain("A & B < C > D");
  });
});

// ─── Vision Tool Factory Tests ──────────────────────────

describe("createVisionTool", () => {
  it("returns a valid tool with correct metadata", () => {
    const tool = createVisionTool();
    expect(tool).not.toBeNull();
    expect(tool!.name).toBe("vision");
    expect(tool!.label).toBe("Vision");
    expect(tool!.description).toContain("4-layer vision system");
  });

  it("description mentions HWPX and scanned PDF support", () => {
    const tool = createVisionTool();
    expect(tool).not.toBeNull();
    expect(tool!.description).toContain(".hwpx");
    expect(tool!.description).toContain("scanned");
  });

  it("has correct parameter schema including force_scanned", () => {
    const tool = createVisionTool();
    expect(tool).not.toBeNull();
    const schema = tool!.parameters;
    expect(schema).toBeDefined();
    expect(schema.properties).toHaveProperty("action");
    expect(schema.properties).toHaveProperty("file");
    expect(schema.properties).toHaveProperty("target_id");
    expect(schema.properties).toHaveProperty("profile");
    expect(schema.properties).toHaveProperty("interactive");
    expect(schema.properties).toHaveProperty("full_page");
    expect(schema.properties).toHaveProperty("render_images");
    expect(schema.properties).toHaveProperty("max_pages");
    expect(schema.properties).toHaveProperty("force_scanned");
    expect(schema.properties).toHaveProperty("layers");
  });

  it("throws on unknown action", async () => {
    const tool = createVisionTool();
    expect(tool).not.toBeNull();
    await expect(tool!.execute("test-call-id", { action: "invalid_action" })).rejects.toThrow(
      /Unknown vision action/,
    );
  });

  it("throws when document action is called without file", async () => {
    const tool = createVisionTool();
    expect(tool).not.toBeNull();
    await expect(tool!.execute("test-call-id", { action: "document" })).rejects.toThrow(
      /file parameter required/,
    );
  });

  it("throws when pdf action is called without file", async () => {
    const tool = createVisionTool();
    expect(tool).not.toBeNull();
    await expect(tool!.execute("test-call-id", { action: "pdf" })).rejects.toThrow(
      /file parameter required/,
    );
  });

  it("requires action parameter", async () => {
    const tool = createVisionTool();
    expect(tool).not.toBeNull();
    await expect(tool!.execute("test-call-id", {})).rejects.toThrow(/action required/);
  });

  it("document action handles .hwpx files via tool", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vision-tool-test-"));
    try {
      const zip = new JSZip();
      zip.file("Contents/section0.xml", `<sec><p><run><t>한글 도구 테스트</t></run></p></sec>`);
      const hwpxPath = path.join(tmpDir, "tool-test.hwpx");
      const buffer = await zip.generateAsync({ type: "nodebuffer" });
      await fs.writeFile(hwpxPath, buffer);

      const tool = createVisionTool();
      const result = await tool!.execute("test-call-id", {
        action: "document",
        file: hwpxPath,
      });

      expect(result.content).toBeDefined();
      const text = result.content[0].type === "text" ? result.content[0].text : "";
      expect(text).toContain("한글 도구 테스트");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("document action returns HWP warning via tool", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vision-tool-test-"));
    try {
      const oleSignature = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
      const fakeHwp = Buffer.concat([oleSignature, Buffer.alloc(512)]);
      const hwpPath = path.join(tmpDir, "test.hwp");
      await fs.writeFile(hwpPath, fakeHwp);

      const tool = createVisionTool();
      const result = await tool!.execute("test-call-id", {
        action: "document",
        file: hwpPath,
      });

      expect(result.content).toBeDefined();
      const text = result.content[0].type === "text" ? result.content[0].text : "";
      expect(text).toContain("HWP");
      expect(text).toContain("warning");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("has convert action parameters in schema", () => {
    const tool = createVisionTool();
    expect(tool).not.toBeNull();
    const schema = tool!.parameters;
    expect(schema.properties).toHaveProperty("output_format");
    expect(schema.properties).toHaveProperty("output_path");
    expect(schema.properties).toHaveProperty("editor_theme");
  });

  it("description mentions convert action", () => {
    const tool = createVisionTool();
    expect(tool).not.toBeNull();
    expect(tool!.description).toContain("convert");
    expect(tool!.description).toContain("HTML");
    expect(tool!.description).toContain("Markdown");
    expect(tool!.description).toContain("editor");
  });

  it("throws when convert action is called without file", async () => {
    const tool = createVisionTool();
    expect(tool).not.toBeNull();
    await expect(tool!.execute("test-call-id", { action: "convert" })).rejects.toThrow(
      /file parameter required/,
    );
  });

  it("throws on invalid output_format for convert", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vision-tool-test-"));
    try {
      const zip = new JSZip();
      zip.file(
        "word/document.xml",
        `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Test</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`,
      );
      const docxPath = path.join(tmpDir, "test.docx");
      await fs.writeFile(docxPath, await zip.generateAsync({ type: "nodebuffer" }));

      const tool = createVisionTool();
      await expect(
        tool!.execute("test-call-id", { action: "convert", file: docxPath, output_format: "docx" }),
      ).rejects.toThrow(/Invalid output_format/);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});

// ─── Document Converter Tests ─────────────────────────

describe("converter: doc-to-html", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "converter-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  it("converts a .docx with formatting to HTML", async () => {
    const zip = new JSZip();
    zip.file(
      "word/document.xml",
      `<?xml version="1.0" encoding="UTF-8"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>
          <w:p>
            <w:pPr>
              <w:jc w:val="center"/>
            </w:pPr>
            <w:r>
              <w:rPr><w:b/></w:rPr>
              <w:t>Bold Title</w:t>
            </w:r>
          </w:p>
          <w:p>
            <w:r>
              <w:rPr><w:i/></w:rPr>
              <w:t>Italic text</w:t>
            </w:r>
          </w:p>
          <w:sectPr/>
        </w:body>
      </w:document>`,
    );

    const docxPath = path.join(tmpDir, "formatted.docx");
    await fs.writeFile(docxPath, await zip.generateAsync({ type: "nodebuffer" }));

    const result = await convertDocToHtml(docxPath);

    expect(result.type).toBe("docx");
    expect(result.html).toContain("<strong>Bold Title</strong>");
    expect(result.html).toContain("<em>Italic text</em>");
    expect(result.html).toContain("text-align:center");
    expect(result.html).toContain("<!DOCTYPE html>");
  });

  it("converts a .xlsx to HTML table", async () => {
    const zip = new JSZip();
    zip.file(
      "xl/sharedStrings.xml",
      `<?xml version="1.0" encoding="UTF-8"?>
      <sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
        <si><t>Name</t></si>
        <si><t>Score</t></si>
        <si><t>Alice</t></si>
      </sst>`,
    );
    zip.file(
      "xl/worksheets/sheet1.xml",
      `<?xml version="1.0" encoding="UTF-8"?>
      <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
        <sheetData>
          <row r="1">
            <c r="A1" t="s"><v>0</v></c>
            <c r="B1" t="s"><v>1</v></c>
          </row>
          <row r="2">
            <c r="A2" t="s"><v>2</v></c>
            <c r="B2"><v>95</v></c>
          </row>
        </sheetData>
      </worksheet>`,
    );

    const xlsxPath = path.join(tmpDir, "test.xlsx");
    await fs.writeFile(xlsxPath, await zip.generateAsync({ type: "nodebuffer" }));

    const result = await convertDocToHtml(xlsxPath);

    expect(result.type).toBe("xlsx");
    expect(result.html).toContain("<table");
    expect(result.html).toContain("Name");
    expect(result.html).toContain("Score");
    expect(result.html).toContain("Alice");
    expect(result.html).toContain("95");
  });

  it("converts a .pptx to HTML slides", async () => {
    const zip = new JSZip();
    zip.file(
      "ppt/slides/slide1.xml",
      `<?xml version="1.0" encoding="UTF-8"?>
      <p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
             xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:cSld>
          <p:spTree>
            <p:sp>
              <p:txBody>
                <a:p><a:r><a:rPr b="1"/><a:t>Presentation Title</a:t></a:r></a:p>
              </p:txBody>
            </p:sp>
          </p:spTree>
        </p:cSld>
      </p:sld>`,
    );

    const pptxPath = path.join(tmpDir, "test.pptx");
    await fs.writeFile(pptxPath, await zip.generateAsync({ type: "nodebuffer" }));

    const result = await convertDocToHtml(pptxPath);

    expect(result.type).toBe("pptx");
    expect(result.html).toContain("Presentation Title");
    expect(result.html).toContain("<strong>");
    expect(result.html).toContain("Slide 1");
  });

  it("converts a .hwpx to HTML", async () => {
    const zip = new JSZip();
    zip.file(
      "Contents/section0.xml",
      `<?xml version="1.0" encoding="UTF-8"?>
      <hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/paragraph">
        <hs:p>
          <hs:run><hs:t>한글 HTML 변환 테스트</hs:t></hs:run>
        </hs:p>
      </hs:sec>`,
    );

    const hwpxPath = path.join(tmpDir, "test.hwpx");
    await fs.writeFile(hwpxPath, await zip.generateAsync({ type: "nodebuffer" }));

    const result = await convertDocToHtml(hwpxPath);

    expect(result.type).toBe("hwpx");
    expect(result.html).toContain("한글 HTML 변환 테스트");
    expect(result.html).toContain("<!DOCTYPE html>");
    expect(result.plainText).toContain("한글 HTML 변환 테스트");
  });
});

// ─── HTML → Markdown Converter Tests ──────────────────

describe("converter: html-to-markdown", () => {
  it("converts headings to markdown", () => {
    const html = "<h1>Title</h1><h2>Subtitle</h2><h3>Section</h3>";
    const md = convertHtmlToMarkdown(html);
    expect(md).toContain("# Title");
    expect(md).toContain("## Subtitle");
    expect(md).toContain("### Section");
  });

  it("converts bold and italic", () => {
    const html = "<p><strong>bold</strong> and <em>italic</em></p>";
    const md = convertHtmlToMarkdown(html);
    expect(md).toContain("**bold**");
    expect(md).toContain("*italic*");
  });

  it("converts tables to GFM format", () => {
    const html = `<table>
      <tr><th>Name</th><th>Age</th></tr>
      <tr><td>Alice</td><td>30</td></tr>
    </table>`;
    const md = convertHtmlToMarkdown(html);
    expect(md).toContain("| Name | Age |");
    expect(md).toContain("| --- | --- |");
    expect(md).toContain("| Alice | 30 |");
  });

  it("converts links", () => {
    const html = '<p>Visit <a href="https://example.com">example</a></p>';
    const md = convertHtmlToMarkdown(html);
    expect(md).toContain("[example](https://example.com)");
  });

  it("converts unordered lists", () => {
    const html = "<ul><li>Item 1</li><li>Item 2</li></ul>";
    const md = convertHtmlToMarkdown(html);
    expect(md).toContain("- Item 1");
    expect(md).toContain("- Item 2");
  });

  it("converts ordered lists", () => {
    const html = "<ol><li>First</li><li>Second</li></ol>";
    const md = convertHtmlToMarkdown(html);
    expect(md).toContain("1. First");
    expect(md).toContain("2. Second");
  });

  it("handles horizontal rules", () => {
    const html = "<p>Before</p><hr><p>After</p>";
    const md = convertHtmlToMarkdown(html);
    expect(md).toContain("---");
  });

  it("decodes HTML entities", () => {
    const html = "<p>A &amp; B &lt; C &gt; D</p>";
    const md = convertHtmlToMarkdown(html);
    expect(md).toContain("A & B < C > D");
  });
});

// ─── Editor Template Tests ────────────────────────────

describe("converter: editor-template", () => {
  it("generates a valid self-contained HTML editor", () => {
    const html = generateEditorHtml({
      title: "테스트 문서",
      content: "<p>Hello World</p>",
      theme: "light",
      lang: "ko",
    });

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("테스트 문서");
    expect(html).toContain("contenteditable");
    expect(html).toContain("Hello World");
    expect(html).toContain("MoA Editor");
  });

  it("supports dark theme", () => {
    const html = generateEditorHtml({
      title: "Dark Doc",
      theme: "dark",
    });

    expect(html).toContain('data-theme="dark"');
  });

  it("supports English language", () => {
    const html = generateEditorHtml({
      lang: "en",
    });

    expect(html).toContain("Save");
    expect(html).toContain("Bold");
    expect(html).toContain("Undo");
  });

  it("includes toolbar buttons", () => {
    const html = generateEditorHtml();
    expect(html).toContain("bold");
    expect(html).toContain("italic");
    expect(html).toContain("underline");
    expect(html).toContain("justifyCenter");
    expect(html).toContain("insertTable");
  });

  it("includes save/export functionality", () => {
    const html = generateEditorHtml();
    expect(html).toContain("saveAs");
    expect(html).toContain("exportPdf");
    expect(html).toContain("htmlToMarkdown");
  });
});

// ─── Unified convertDocument Tests ────────────────────

describe("converter: convertDocument", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "convert-doc-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  it("converts .docx to HTML", async () => {
    const zip = new JSZip();
    zip.file(
      "word/document.xml",
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Test Content</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`,
    );
    const docxPath = path.join(tmpDir, "test.docx");
    await fs.writeFile(docxPath, await zip.generateAsync({ type: "nodebuffer" }));

    const result = await convertDocument(docxPath, { format: "html" });

    expect(result.format).toBe("html");
    expect(result.sourceType).toBe("docx");
    expect(result.content).toContain("Test Content");
    expect(result.content).toContain("<!DOCTYPE html>");
  });

  it("converts .docx to Markdown", async () => {
    const zip = new JSZip();
    zip.file(
      "word/document.xml",
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Heading</w:t></w:r></w:p><w:p><w:r><w:t>Body text</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`,
    );
    const docxPath = path.join(tmpDir, "test.docx");
    await fs.writeFile(docxPath, await zip.generateAsync({ type: "nodebuffer" }));

    const result = await convertDocument(docxPath, { format: "markdown" });

    expect(result.format).toBe("markdown");
    expect(result.content).toContain("Heading");
    expect(result.content).toContain("Body text");
  });

  it("converts .docx to editor format", async () => {
    const zip = new JSZip();
    zip.file(
      "word/document.xml",
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Edit me</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`,
    );
    const docxPath = path.join(tmpDir, "test.docx");
    await fs.writeFile(docxPath, await zip.generateAsync({ type: "nodebuffer" }));

    const result = await convertDocument(docxPath, { format: "editor" });

    expect(result.format).toBe("editor");
    expect(result.content).toContain("contenteditable");
    expect(result.content).toContain("MoA Editor");
    expect(result.content).toContain("Edit me");
  });

  it("saves output to file when outputPath is given", async () => {
    const zip = new JSZip();
    zip.file(
      "word/document.xml",
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Saved content</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`,
    );
    const docxPath = path.join(tmpDir, "test.docx");
    await fs.writeFile(docxPath, await zip.generateAsync({ type: "nodebuffer" }));

    const outputPath = path.join(tmpDir, "output.html");
    const result = await convertDocument(docxPath, { format: "html", outputPath });

    expect(result.savedTo).toBe(outputPath);
    const savedContent = await fs.readFile(outputPath, "utf-8");
    expect(savedContent).toContain("Saved content");
  });

  it("rejects unsupported file types", async () => {
    const txtPath = path.join(tmpDir, "test.txt");
    await fs.writeFile(txtPath, "plain text");

    await expect(convertDocument(txtPath)).rejects.toThrow(/지원하지 않는 파일 형식/);
  });
});
