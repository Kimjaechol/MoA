"use client";

import { useState, useRef, useCallback } from "react";
import Nav from "../../components/Nav";

/**
 * MoA Document Editor Page
 *
 * Client-side document editor that supports:
 *   - Uploading PDF/Office documents
 *   - Converting to HTML for editing
 *   - WYSIWYG editing with formatting toolbar
 *   - Exporting to HTML, Markdown, or text
 *
 * Note: The actual conversion uses the MoA vision tool's "convert" action
 * server-side. This page provides the editing UI for converted documents
 * and a local file upload + API call flow.
 */

type ExportFormat = "html" | "md" | "txt";

const SUPPORTED_EXTENSIONS = [".pdf", ".docx", ".xlsx", ".pptx", ".hwpx"];

export default function EditorPage() {
  const [content, setContent] = useState<string>("");
  const [title, setTitle] = useState("제목 없는 문서");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [charCount, setCharCount] = useState(0);
  const editorRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const updateCharCount = useCallback(() => {
    if (editorRef.current) {
      setCharCount(editorRef.current.innerText?.length ?? 0);
    }
  }, []);

  const execCommand = useCallback((cmd: string, value?: string) => {
    document.execCommand(cmd, false, value ?? undefined);
    editorRef.current?.focus();
  }, []);

  const applyHeading = useCallback((tag: string) => {
    document.execCommand("formatBlock", false, tag);
    editorRef.current?.focus();
  }, []);

  const insertTable = useCallback(() => {
    const rows = prompt("행 수 (Rows):", "3");
    const cols = prompt("열 수 (Columns):", "3");
    if (!rows || !cols) return;
    const r = parseInt(rows, 10);
    const c = parseInt(cols, 10);
    if (isNaN(r) || isNaN(c) || r < 1 || c < 1) return;

    let html = '<table style="width:100%;border-collapse:collapse;margin:12px 0">';
    for (let i = 0; i < r; i++) {
      html += "<tr>";
      for (let j = 0; j < c; j++) {
        const tag = i === 0 ? "th" : "td";
        html += `<${tag} style="border:1px solid #ccc;padding:6px 10px">&nbsp;</${tag}>`;
      }
      html += "</tr>";
    }
    html += "</table><p><br></p>";
    document.execCommand("insertHTML", false, html);
    editorRef.current?.focus();
  }, []);

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const ext = "." + file.name.split(".").pop()?.toLowerCase();
    if (!SUPPORTED_EXTENSIONS.includes(ext)) {
      setError(`지원하지 않는 파일 형식입니다: ${ext}\n지원: ${SUPPORTED_EXTENSIONS.join(", ")}`);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Read file as text or process locally
      const fileName = file.name.replace(/\.[^.]+$/, "");
      setTitle(fileName);

      // For now, show file info and instructions
      // Full conversion requires server-side MoA vision tool
      const sizeMb = (file.size / 1024 / 1024).toFixed(2);
      const infoHtml = [
        `<h2>${fileName}</h2>`,
        `<p style="color:#666">파일 크기: ${sizeMb} MB | 형식: ${ext.toUpperCase()}</p>`,
        "<hr>",
        "<p>이 문서를 변환하려면 MoA 에이전트에게 다음과 같이 요청하세요:</p>",
        "<br>",
        '<pre style="background:#f5f5f5;padding:12px;border-radius:4px;font-size:12px">',
        `vision({ action: "convert", file: "${file.name}", output_format: "html" })`,
        "</pre>",
        "<br>",
        "<p>또는 에이전트에게 직접 말씀하세요:</p>",
        `<p style="color:#667eea;font-style:italic">"${file.name} 파일을 HTML로 변환해서 에디터에서 보여줘"</p>`,
        "<br>",
        "<p>변환 후 이 에디터에서 내용을 수정하고 원하는 형식으로 저장할 수 있습니다.</p>",
      ].join("\n");

      if (editorRef.current) {
        editorRef.current.innerHTML = infoHtml;
        setContent(infoHtml);
        updateCharCount();
      }
    } catch (err) {
      setError(`파일 처리 중 오류: ${String(err)}`);
    } finally {
      setIsLoading(false);
    }
  }, [updateCharCount]);

  const exportDocument = useCallback((format: ExportFormat) => {
    if (!editorRef.current) return;

    let exportContent: string;
    let mimeType: string;
    let ext: string;

    switch (format) {
      case "html": {
        const bodyHtml = editorRef.current.innerHTML;
        exportContent = [
          "<!DOCTYPE html>",
          '<html lang="ko">',
          "<head>",
          '<meta charset="UTF-8">',
          '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
          `<title>${title}</title>`,
          "<style>",
          'body { font-family: "Malgun Gothic", sans-serif; max-width: 794px; margin: 0 auto; padding: 48px 56px; line-height: 1.6; color: #222; }',
          "table { border-collapse: collapse; width: 100%; margin: 12px 0; }",
          "td, th { border: 1px solid #ccc; padding: 6px 10px; }",
          "th { background: #f8f8f8; font-weight: 600; }",
          "img { max-width: 100%; }",
          "</style>",
          "</head>",
          "<body>",
          bodyHtml,
          "</body>",
          "</html>",
        ].join("\n");
        mimeType = "text/html";
        ext = ".html";
        break;
      }
      case "md": {
        // Simple HTML to Markdown conversion
        let md = editorRef.current.innerHTML;
        md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, t: string) => `\n# ${t.replace(/<[^>]+>/g, "")}\n`);
        md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, t: string) => `\n## ${t.replace(/<[^>]+>/g, "")}\n`);
        md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, t: string) => `\n### ${t.replace(/<[^>]+>/g, "")}\n`);
        md = md.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, "**$1**");
        md = md.replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, "**$1**");
        md = md.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, "*$1*");
        md = md.replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, "*$1*");
        md = md.replace(/<br\s*\/?>/gi, "  \n");
        md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, t: string) => `\n${t.replace(/<[^>]+>/g, "")}\n`);
        md = md.replace(/<[^>]+>/g, "");
        md = md.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ");
        md = md.replace(/\n{3,}/g, "\n\n");
        exportContent = md.trim() + "\n";
        mimeType = "text/markdown";
        ext = ".md";
        break;
      }
      case "txt":
        exportContent = editorRef.current.innerText ?? "";
        mimeType = "text/plain";
        ext = ".txt";
        break;
    }

    const blob = new Blob([exportContent], { type: `${mimeType};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = title + ext;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [title]);

  return (
    <>
      <Nav />
      <div style={{ paddingTop: 64, height: "100vh", display: "flex", flexDirection: "column" }}>
        {/* Title Bar */}
        <div
          style={{
            background: "var(--bg-card)",
            borderBottom: "1px solid var(--border)",
            padding: "8px 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexShrink: 0,
          }}
        >
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="제목 없는 문서"
            style={{
              background: "none",
              border: "none",
              fontSize: "16px",
              fontWeight: 600,
              color: "var(--text)",
              flex: 1,
              outline: "none",
            }}
          />
          <div style={{ display: "flex", gap: 6 }}>
            <button className="btn btn-sm btn-outline" onClick={() => fileInputRef.current?.click()}>
              파일 열기
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept={SUPPORTED_EXTENSIONS.join(",")}
              style={{ display: "none" }}
              onChange={handleFileUpload}
            />
            <button className="btn btn-sm btn-outline" onClick={() => exportDocument("html")}>
              HTML
            </button>
            <button className="btn btn-sm btn-outline" onClick={() => exportDocument("md")}>
              MD
            </button>
            <button className="btn btn-sm btn-outline" onClick={() => exportDocument("txt")}>
              TXT
            </button>
            <button className="btn btn-sm btn-primary" onClick={() => window.print()}>
              PDF
            </button>
          </div>
        </div>

        {/* Toolbar */}
        <div
          style={{
            background: "var(--bg-card)",
            borderBottom: "1px solid var(--border)",
            padding: "6px 12px",
            display: "flex",
            flexWrap: "wrap",
            gap: 4,
            alignItems: "center",
            flexShrink: 0,
          }}
        >
          {/* Undo/Redo */}
          <div style={{ display: "flex", gap: 2 }}>
            <ToolbarBtn onClick={() => execCommand("undo")} title="실행취소">&#x21B6;</ToolbarBtn>
            <ToolbarBtn onClick={() => execCommand("redo")} title="다시실행">&#x21B7;</ToolbarBtn>
          </div>
          <Separator />

          {/* Heading */}
          <select
            onChange={(e) => applyHeading(e.target.value)}
            title="제목"
            style={{
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              padding: "4px 6px",
              color: "var(--text)",
              fontSize: 12,
              height: 28,
            }}
          >
            <option value="p">본문</option>
            <option value="h1">제목 1</option>
            <option value="h2">제목 2</option>
            <option value="h3">제목 3</option>
          </select>
          <Separator />

          {/* Font */}
          <select
            onChange={(e) => execCommand("fontName", e.target.value)}
            title="글꼴"
            style={{
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              padding: "4px 6px",
              color: "var(--text)",
              fontSize: 12,
              height: 28,
            }}
          >
            <option value="Malgun Gothic">맑은 고딕</option>
            <option value="Batang">바탕</option>
            <option value="Gulim">굴림</option>
            <option value="Nanum Gothic">나눔고딕</option>
            <option value="Arial">Arial</option>
            <option value="Times New Roman">Times New Roman</option>
          </select>

          <select
            onChange={(e) => execCommand("fontSize", e.target.value)}
            defaultValue="3"
            title="글자크기"
            style={{
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              padding: "4px 6px",
              color: "var(--text)",
              fontSize: 12,
              height: 28,
            }}
          >
            <option value="1">8pt</option>
            <option value="2">10pt</option>
            <option value="3">12pt</option>
            <option value="4">14pt</option>
            <option value="5">18pt</option>
            <option value="6">24pt</option>
          </select>
          <Separator />

          {/* Formatting */}
          <div style={{ display: "flex", gap: 2 }}>
            <ToolbarBtn onClick={() => execCommand("bold")} title="굵게"><b>B</b></ToolbarBtn>
            <ToolbarBtn onClick={() => execCommand("italic")} title="기울임"><i>I</i></ToolbarBtn>
            <ToolbarBtn onClick={() => execCommand("underline")} title="밑줄"><u>U</u></ToolbarBtn>
            <ToolbarBtn onClick={() => execCommand("strikeThrough")} title="취소선"><s>S</s></ToolbarBtn>
          </div>
          <Separator />

          {/* Alignment */}
          <div style={{ display: "flex", gap: 2 }}>
            <ToolbarBtn onClick={() => execCommand("justifyLeft")} title="왼쪽 정렬">&#x2190;</ToolbarBtn>
            <ToolbarBtn onClick={() => execCommand("justifyCenter")} title="가운데 정렬">&#x2194;</ToolbarBtn>
            <ToolbarBtn onClick={() => execCommand("justifyRight")} title="오른쪽 정렬">&#x2192;</ToolbarBtn>
            <ToolbarBtn onClick={() => execCommand("justifyFull")} title="양쪽 정렬">&#x2195;</ToolbarBtn>
          </div>
          <Separator />

          {/* Lists & Table */}
          <div style={{ display: "flex", gap: 2 }}>
            <ToolbarBtn onClick={() => execCommand("insertUnorderedList")} title="글머리 기호">&#x2022;</ToolbarBtn>
            <ToolbarBtn onClick={() => execCommand("insertOrderedList")} title="번호 목록">1.</ToolbarBtn>
            <ToolbarBtn onClick={insertTable} title="표 삽입">&#x25A6;</ToolbarBtn>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div
            style={{
              background: "rgba(252,129,129,0.1)",
              borderBottom: "1px solid var(--danger)",
              padding: "8px 16px",
              color: "var(--danger)",
              fontSize: 13,
              flexShrink: 0,
            }}
          >
            {error}
            <button
              onClick={() => setError(null)}
              style={{
                float: "right",
                background: "none",
                border: "none",
                color: "var(--danger)",
                cursor: "pointer",
              }}
            >
              &times;
            </button>
          </div>
        )}

        {/* Loading */}
        {isLoading && (
          <div
            style={{
              padding: "12px 16px",
              textAlign: "center",
              color: "var(--primary)",
              fontSize: 14,
              flexShrink: 0,
            }}
          >
            문서 변환 중...
          </div>
        )}

        {/* Editor */}
        <div
          style={{
            flex: 1,
            overflow: "auto",
            padding: 24,
            display: "flex",
            justifyContent: "center",
          }}
        >
          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            onInput={updateCharCount}
            style={{
              width: "100%",
              maxWidth: 816,
              minHeight: 1056,
              background: "white",
              color: "#222",
              padding: "56px 64px",
              boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
              borderRadius: 4,
              outline: "none",
              fontSize: "12pt",
              lineHeight: 1.6,
            }}
            dangerouslySetInnerHTML={content ? { __html: content } : undefined}
          />
        </div>

        {/* Status Bar */}
        <div
          style={{
            background: "var(--bg-card)",
            borderTop: "1px solid var(--border)",
            padding: "4px 16px",
            display: "flex",
            justifyContent: "space-between",
            fontSize: 11,
            color: "var(--text-muted)",
            flexShrink: 0,
          }}
        >
          <span>{charCount} 글자</span>
          <span>MoA Document Editor</span>
        </div>
      </div>
    </>
  );
}

function ToolbarBtn({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        background: "none",
        border: "1px solid transparent",
        borderRadius: 4,
        padding: "4px 8px",
        cursor: "pointer",
        color: "var(--text)",
        fontSize: 14,
        lineHeight: 1,
        minWidth: 28,
        height: 28,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onMouseOver={(e) => {
        (e.target as HTMLElement).style.background = "var(--bg-card-hover)";
      }}
      onMouseOut={(e) => {
        (e.target as HTMLElement).style.background = "none";
      }}
    >
      {children}
    </button>
  );
}

function Separator() {
  return (
    <div
      style={{
        width: 1,
        height: 20,
        background: "var(--border)",
        margin: "0 4px",
      }}
    />
  );
}
