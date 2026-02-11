"use client";

import { useState, useCallback, useRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TextAlign from "@tiptap/extension-text-align";
import FontFamily from "@tiptap/extension-font-family";
import TextStyle from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import ImageExt from "@tiptap/extension-image";
import Underline from "@tiptap/extension-underline";
import Placeholder from "@tiptap/extension-placeholder";
import Nav from "../../components/Nav";
import EditorToolbar from "../../components/editor/EditorToolbar";
import { FontSize } from "../../components/editor/font-size-extension";
import {
  exportAsHtml,
  exportAsMarkdown,
  exportAsText,
  exportAsPdf,
  exportAsDocx,
  exportAsHwpx,
  exportAsXlsx,
} from "../../components/editor/export-utils";
import { exportAsPptx } from "../../components/editor/pptx-generator";
import "../../components/editor/editor.css";

/**
 * MoA Document Editor Page
 *
 * TipTap (ProseMirror) based rich text editor with:
 *   - Full formatting toolbar (headings, fonts, colors, alignment, tables)
 *   - Upload & convert PDF/Office documents
 *   - Export to HTML, Markdown, Text, PDF, DOCX, HWPX, XLSX, PPTX
 *   - AI-powered PPTX: summarizes content into presentation slides
 */

const SUPPORTED_EXTENSIONS = [".pdf", ".docx", ".xlsx", ".pptx", ".hwpx"];

const PPTX_THEMES = [
  { value: "blue", label: "Blue", color: "#667eea" },
  { value: "dark", label: "Dark", color: "#bb86fc" },
  { value: "green", label: "Green", color: "#4caf50" },
  { value: "red", label: "Red", color: "#e53935" },
  { value: "purple", label: "Purple", color: "#9c27b0" },
] as const;

export default function EditorPage() {
  const [title, setTitle] = useState("제목 없는 문서");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPptxDialog, setShowPptxDialog] = useState(false);
  const [pptxTheme, setPptxTheme] = useState<string>("blue");
  const [pptxMaxSlides, setPptxMaxSlides] = useState(12);
  const [pptxUseAi, setPptxUseAi] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4] },
      }),
      Table.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
      TextAlign.configure({
        types: ["heading", "paragraph"],
      }),
      TextStyle,
      FontFamily,
      FontSize,
      Color,
      Highlight.configure({ multicolor: true }),
      ImageExt.configure({ inline: false }),
      Underline,
      Placeholder.configure({
        placeholder: "문서 내용을 입력하세요...",
      }),
    ],
    content: "",
    editorProps: {
      attributes: {
        class: "ProseMirror",
      },
    },
  });

  const charCount = editor?.storage.characterCount?.characters?.() ?? editor?.getText().length ?? 0;
  const wordCount = editor?.getText().trim().split(/\s+/).filter(Boolean).length ?? 0;

  const handleFileUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !editor) return;

      const ext = "." + file.name.split(".").pop()?.toLowerCase();
      if (!SUPPORTED_EXTENSIONS.includes(ext)) {
        setError(`지원하지 않는 파일 형식입니다: ${ext}\n지원: ${SUPPORTED_EXTENSIONS.join(", ")}`);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const fileName = file.name.replace(/\.[^.]+$/, "");
        setTitle(fileName);

        const sizeMb = (file.size / 1024 / 1024).toFixed(2);
        const infoHtml = [
          `<h2>${fileName}</h2>`,
          `<p style="color:#666">파일 크기: ${sizeMb} MB | 형식: ${ext.toUpperCase()}</p>`,
          "<hr>",
          "<p>이 문서를 변환하려면 MoA 에이전트에게 다음과 같이 요청하세요:</p>",
          "<br>",
          "<pre><code>",
          `vision({ action: "convert", file: "${file.name}", output_format: "html" })`,
          "</code></pre>",
          "<br>",
          "<p>또는 에이전트에게 직접 말씀하세요:</p>",
          `<p><em>"${file.name} 파일을 HTML로 변환해서 에디터에서 보여줘"</em></p>`,
          "<br>",
          "<p>변환 후 이 에디터에서 내용을 수정하고 원하는 형식으로 저장할 수 있습니다.</p>",
        ].join("\n");

        editor.commands.setContent(infoHtml);
      } catch (err) {
        setError(`파일 처리 중 오류: ${String(err)}`);
      } finally {
        setIsLoading(false);
      }
    },
    [editor],
  );

  const getHtmlContent = useCallback((): string => {
    if (!editor) return "";
    return editor.getHTML();
  }, [editor]);

  const getTextContent = useCallback((): string => {
    if (!editor) return "";
    return editor.getText();
  }, [editor]);

  const handleExport = useCallback(
    async (format: string) => {
      const html = getHtmlContent();
      const text = getTextContent();

      switch (format) {
        case "html":
          exportAsHtml(html, title);
          break;
        case "md":
          exportAsMarkdown(html, title);
          break;
        case "txt":
          exportAsText(text, title);
          break;
        case "pdf":
          exportAsPdf();
          break;
        case "docx":
          await exportAsDocx(html, title);
          break;
        case "hwpx":
          await exportAsHwpx(html, title);
          break;
        case "xlsx":
          await exportAsXlsx(html, title);
          break;
        case "pptx":
          setShowPptxDialog(true);
          break;
      }
    },
    [title, getHtmlContent, getTextContent],
  );

  const handlePptxGenerate = useCallback(async () => {
    setIsGenerating(true);
    setShowPptxDialog(false);
    try {
      const html = getHtmlContent();
      await exportAsPptx(html, {
        title,
        theme: pptxTheme as "blue" | "dark" | "green" | "red" | "purple",
        maxSlides: pptxMaxSlides,
        useAi: pptxUseAi,
      });
    } catch (err) {
      setError(`PPTX 생성 중 오류: ${String(err)}`);
    } finally {
      setIsGenerating(false);
    }
  }, [title, pptxTheme, pptxMaxSlides, pptxUseAi, getHtmlContent]);

  return (
    <>
      <Nav />
      <div style={{ paddingTop: 64, height: "100vh", display: "flex", flexDirection: "column" }}>
        {/* Title Bar */}
        <div className="editor-title-bar">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="제목 없는 문서"
            className="editor-title-input"
          />
          <div className="export-group">
            <button className="export-btn" onClick={() => fileInputRef.current?.click()}>
              파일 열기
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept={SUPPORTED_EXTENSIONS.join(",")}
              style={{ display: "none" }}
              onChange={handleFileUpload}
            />
            <button className="export-btn" onClick={() => handleExport("html")}>
              HTML
            </button>
            <button className="export-btn" onClick={() => handleExport("md")}>
              MD
            </button>
            <button className="export-btn" onClick={() => handleExport("txt")}>
              TXT
            </button>
            <button className="export-btn" onClick={() => handleExport("docx")}>
              DOCX
            </button>
            <button className="export-btn" onClick={() => handleExport("hwpx")}>
              HWPX
            </button>
            <button className="export-btn" onClick={() => handleExport("xlsx")}>
              XLSX
            </button>
            <button
              className="export-btn export-btn-pptx"
              onClick={() => handleExport("pptx")}
              disabled={isGenerating}
            >
              {isGenerating ? "생성중..." : "PPTX"}
            </button>
            <button className="export-btn export-btn-primary" onClick={() => handleExport("pdf")}>
              PDF
            </button>
          </div>
        </div>

        {/* Toolbar */}
        <EditorToolbar editor={editor} />

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
        {(isLoading || isGenerating) && (
          <div
            style={{
              padding: "12px 16px",
              textAlign: "center",
              color: "var(--primary)",
              fontSize: 14,
              flexShrink: 0,
            }}
          >
            {isGenerating ? "AI 프레젠테이션 생성 중..." : "문서 변환 중..."}
          </div>
        )}

        {/* Editor */}
        <div className="editor-wrapper">
          <div className="tiptap-editor">
            <EditorContent editor={editor} />
          </div>
        </div>

        {/* Status Bar */}
        <div className="editor-status-bar">
          <span>{charCount} 글자 | {wordCount} 단어</span>
          <span>MoA Document Editor (TipTap)</span>
        </div>
      </div>

      {/* PPTX Generation Dialog */}
      {showPptxDialog && (
        <div className="pptx-dialog-overlay" onClick={() => setShowPptxDialog(false)}>
          <div className="pptx-dialog" onClick={(e) => e.stopPropagation()}>
            <h3 className="pptx-dialog-title">AI 프레젠테이션 생성</h3>
            <p className="pptx-dialog-desc">
              문서 내용을 요약하여 발표용 PPTX 슬라이드를 생성합니다.
              핵심 키워드 위주로 스토리 흐름에 맞게 구성됩니다.
            </p>

            {/* Theme Selection */}
            <div className="pptx-dialog-section">
              <label className="pptx-dialog-label">테마 색상</label>
              <div className="pptx-theme-grid">
                {PPTX_THEMES.map((t) => (
                  <button
                    key={t.value}
                    className={`pptx-theme-btn ${pptxTheme === t.value ? "active" : ""}`}
                    onClick={() => setPptxTheme(t.value)}
                    style={{ "--theme-color": t.color } as React.CSSProperties}
                  >
                    <span className="pptx-theme-swatch" style={{ background: t.color }} />
                    <span>{t.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Max Slides */}
            <div className="pptx-dialog-section">
              <label className="pptx-dialog-label">
                최대 슬라이드 수: <strong>{pptxMaxSlides}</strong>
              </label>
              <input
                type="range"
                min={5}
                max={30}
                value={pptxMaxSlides}
                onChange={(e) => setPptxMaxSlides(parseInt(e.target.value, 10))}
                className="pptx-slider"
              />
              <div className="pptx-slider-labels">
                <span>5</span>
                <span>15</span>
                <span>30</span>
              </div>
            </div>

            {/* AI Toggle */}
            <div className="pptx-dialog-section">
              <label className="pptx-toggle-label">
                <input
                  type="checkbox"
                  checked={pptxUseAi}
                  onChange={(e) => setPptxUseAi(e.target.checked)}
                  className="pptx-toggle"
                />
                <span>AI 요약 사용 (LLM API 키 필요)</span>
              </label>
              <p className="pptx-dialog-hint">
                {pptxUseAi
                  ? "LLM이 문서 내용을 분석하여 최적의 발표 구조를 생성합니다. API 키가 없으면 자동으로 스마트 추출 모드로 전환됩니다."
                  : "HTML 구조를 분석하여 제목/내용 기반으로 슬라이드를 구성합니다."}
              </p>
            </div>

            {/* Actions */}
            <div className="pptx-dialog-actions">
              <button
                className="pptx-dialog-cancel"
                onClick={() => setShowPptxDialog(false)}
              >
                취소
              </button>
              <button
                className="pptx-dialog-generate"
                onClick={handlePptxGenerate}
              >
                프레젠테이션 생성
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
