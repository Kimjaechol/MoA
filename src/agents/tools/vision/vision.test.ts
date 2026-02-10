import JSZip from "jszip";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createVisionTool } from "./index.js";
import { parseDocument } from "./layer2-document.js";

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

  it("has correct parameter schema", () => {
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
});
