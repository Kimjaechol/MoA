"use client";

import { useState, useRef, useCallback } from "react";
import Link from "next/link";
import Nav from "../../components/Nav";

/**
 * MoA Multi-Document Synthesis Page
 *
 * Allows users to upload multiple documents/references,
 * then uses LLM (large context windows) to synthesize them
 * into a new comprehensive document.
 */

interface SourceDoc {
  id: string;
  name: string;
  type: string;
  size: number;
  content: string;
  status: "ready" | "processing" | "error";
}

interface SynthesisResult {
  title: string;
  content: string;
  model: string;
  sourceCount: number;
  wordCount: number;
}

const OUTPUT_FORMATS = [
  { id: "report", label: "종합 보고서", desc: "체계적인 분석 보고서" },
  { id: "summary", label: "요약문", desc: "핵심 내용 요약" },
  { id: "comparison", label: "비교 분석", desc: "자료 간 비교 분석" },
  { id: "proposal", label: "기획서/제안서", desc: "비즈니스 기획 문서" },
  { id: "essay", label: "에세이/논문", desc: "학술 형식 문서" },
  { id: "brief", label: "브리핑 자료", desc: "간결한 브리핑" },
] as const;

const SUPPORTED_TYPES = [
  ".txt", ".md", ".html", ".json", ".csv",
  ".pdf", ".docx", ".xlsx", ".pptx", ".hwpx",
];

export default function SynthesisPage() {
  const [sources, setSources] = useState<SourceDoc[]>([]);
  const [textInput, setTextInput] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [outputFormat, setOutputFormat] = useState("report");
  const [customInstructions, setCustomInstructions] = useState("");
  const [outputLength, setOutputLength] = useState<"short" | "medium" | "long">("medium");
  const [language, setLanguage] = useState<"ko" | "en" | "auto">("ko");
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<SynthesisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addTextSource = useCallback(() => {
    if (!textInput.trim()) return;
    const doc: SourceDoc = {
      id: `text_${Date.now()}`,
      name: `텍스트 입력 ${sources.length + 1}`,
      type: "text/plain",
      size: new Blob([textInput]).size,
      content: textInput.trim(),
      status: "ready",
    };
    setSources((prev) => [...prev, doc]);
    setTextInput("");
  }, [textInput, sources.length]);

  const addUrlSource = useCallback(async () => {
    if (!urlInput.trim()) return;
    const doc: SourceDoc = {
      id: `url_${Date.now()}`,
      name: urlInput.trim(),
      type: "url",
      size: 0,
      content: `[URL Reference] ${urlInput.trim()}`,
      status: "ready",
    };
    setSources((prev) => [...prev, doc]);
    setUrlInput("");
  }, [urlInput]);

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    for (const file of files) {
      const ext = "." + file.name.split(".").pop()?.toLowerCase();
      if (!SUPPORTED_TYPES.includes(ext)) continue;

      const reader = new FileReader();
      reader.onload = () => {
        const content = typeof reader.result === "string" ? reader.result : "";
        const doc: SourceDoc = {
          id: `file_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          name: file.name,
          type: file.type || ext,
          size: file.size,
          content,
          status: "ready",
        };
        setSources((prev) => [...prev, doc]);
      };
      reader.readAsText(file);
    }
    if (e.target) e.target.value = "";
  }, []);

  const removeSource = (id: string) => {
    setSources((prev) => prev.filter((s) => s.id !== id));
  };

  const handleSynthesize = async () => {
    if (sources.length === 0) {
      setError("최소 1개 이상의 자료를 추가해주세요.");
      return;
    }

    setIsProcessing(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/synthesis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sources: sources.map((s) => ({
            name: s.name,
            content: s.content.slice(0, 30000),
          })),
          format: outputFormat,
          length: outputLength,
          language,
          instructions: customInstructions,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error ?? `HTTP ${res.status}`);
      }

      const data = await res.json();
      setResult({
        title: data.title,
        content: data.content,
        model: data.model,
        sourceCount: sources.length,
        wordCount: data.content.split(/\s+/).length,
      });
    } catch (err) {
      setError(`종합문서 생성 실패: ${String(err)}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const exportToEditor = () => {
    if (!result) return;
    const html = result.content
      .replace(/\n\n/g, "</p><p>")
      .replace(/\n/g, "<br>")
      .replace(/^/, "<p>")
      .replace(/$/, "</p>");
    sessionStorage.setItem("moa_editor_content", html);
    sessionStorage.setItem("moa_editor_title", result.title);
    window.open("/editor", "_blank");
  };

  const downloadAsText = () => {
    if (!result) return;
    const blob = new Blob([`# ${result.title}\n\n${result.content}`], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${result.title}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <Nav />
      <div className="synthesis-layout">
        {/* Header */}
        <div className="synthesis-header">
          <div className="synthesis-header-inner">
            <Link href="/chat" className="synthesis-back">&larr; 채팅으로</Link>
            <h1>종합문서 작성</h1>
            <p>여러 문서와 참고자료를 종합하여 새로운 문서를 생성합니다</p>
          </div>
        </div>

        <div className="synthesis-content">
          {/* Left Panel: Sources */}
          <div className="synthesis-panel synthesis-sources">
            <h2>참고 자료 ({sources.length})</h2>

            {/* File Upload */}
            <div className="synthesis-upload-zone" onClick={() => fileInputRef.current?.click()}>
              <span className="synthesis-upload-icon">📁</span>
              <p>파일을 드래그하거나 클릭하여 업로드</p>
              <p className="synthesis-upload-hint">
                {SUPPORTED_TYPES.join(", ")}
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept={SUPPORTED_TYPES.join(",")}
                multiple
                style={{ display: "none" }}
                onChange={handleFileUpload}
              />
            </div>

            {/* Text Input */}
            <div className="synthesis-add-section">
              <h3>텍스트 직접 입력</h3>
              <textarea
                className="synthesis-textarea"
                placeholder="참고할 텍스트를 입력하세요..."
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                rows={4}
              />
              <button className="synthesis-add-btn" onClick={addTextSource} disabled={!textInput.trim()}>
                + 텍스트 추가
              </button>
            </div>

            {/* URL Input */}
            <div className="synthesis-add-section">
              <h3>URL 참조 추가</h3>
              <div className="synthesis-url-row">
                <input
                  type="url"
                  className="synthesis-url-input"
                  placeholder="https://example.com/article"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                />
                <button className="synthesis-add-btn" onClick={addUrlSource} disabled={!urlInput.trim()}>
                  추가
                </button>
              </div>
            </div>

            {/* Source List */}
            <div className="synthesis-source-list">
              {sources.map((src) => (
                <div key={src.id} className="synthesis-source-item">
                  <div className="synthesis-source-icon">
                    {src.type === "url" ? "🌐" : src.type.includes("text") ? "📝" : "📄"}
                  </div>
                  <div className="synthesis-source-info">
                    <span className="synthesis-source-name">{src.name}</span>
                    <span className="synthesis-source-meta">
                      {src.size > 0 ? `${(src.size / 1024).toFixed(1)}KB` : "URL"} &middot;{" "}
                      {src.content.length.toLocaleString()}자
                    </span>
                  </div>
                  <button className="synthesis-source-remove" onClick={() => removeSource(src.id)}>
                    ✕
                  </button>
                </div>
              ))}
              {sources.length === 0 && (
                <p className="synthesis-empty">아직 추가된 자료가 없습니다.</p>
              )}
            </div>
          </div>

          {/* Right Panel: Config & Result */}
          <div className="synthesis-panel synthesis-config">
            <h2>생성 설정</h2>

            {/* Output Format */}
            <div className="synthesis-option-group">
              <label>출력 형식</label>
              <div className="synthesis-format-grid">
                {OUTPUT_FORMATS.map((fmt) => (
                  <button
                    key={fmt.id}
                    className={`synthesis-format-btn ${outputFormat === fmt.id ? "active" : ""}`}
                    onClick={() => setOutputFormat(fmt.id)}
                  >
                    <strong>{fmt.label}</strong>
                    <span>{fmt.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Length */}
            <div className="synthesis-option-group">
              <label>문서 길이</label>
              <div className="synthesis-length-row">
                {(["short", "medium", "long"] as const).map((len) => (
                  <button
                    key={len}
                    className={`synthesis-length-btn ${outputLength === len ? "active" : ""}`}
                    onClick={() => setOutputLength(len)}
                  >
                    {{ short: "간결 (1-2페이지)", medium: "보통 (3-5페이지)", long: "상세 (5+페이지)" }[len]}
                  </button>
                ))}
              </div>
            </div>

            {/* Language */}
            <div className="synthesis-option-group">
              <label>언어</label>
              <div className="synthesis-length-row">
                {(["ko", "en", "auto"] as const).map((lang) => (
                  <button
                    key={lang}
                    className={`synthesis-length-btn ${language === lang ? "active" : ""}`}
                    onClick={() => setLanguage(lang)}
                  >
                    {{ ko: "한국어", en: "English", auto: "자동 감지" }[lang]}
                  </button>
                ))}
              </div>
            </div>

            {/* Custom Instructions */}
            <div className="synthesis-option-group">
              <label>추가 지시사항 (선택)</label>
              <textarea
                className="synthesis-textarea"
                placeholder="예: 법률 용어 중심으로 정리해주세요. 표로 비교해주세요..."
                value={customInstructions}
                onChange={(e) => setCustomInstructions(e.target.value)}
                rows={3}
              />
            </div>

            {/* Generate Button */}
            <button
              className="synthesis-generate-btn"
              onClick={handleSynthesize}
              disabled={isProcessing || sources.length === 0}
            >
              {isProcessing ? "AI 종합문서 생성 중..." : `종합문서 생성 (자료 ${sources.length}개)`}
            </button>

            {/* Error */}
            {error && (
              <div className="synthesis-error">
                {error}
                <button onClick={() => setError(null)}>✕</button>
              </div>
            )}

            {/* Result */}
            {result && (
              <div className="synthesis-result">
                <div className="synthesis-result-header">
                  <h3>{result.title}</h3>
                  <div className="synthesis-result-meta">
                    모델: {result.model} | 자료 {result.sourceCount}개 | {result.wordCount}단어
                  </div>
                </div>
                <div className="synthesis-result-content">
                  {result.content.split("\n").map((line, i) => (
                    <span key={i}>
                      {line}
                      {i < result.content.split("\n").length - 1 && <br />}
                    </span>
                  ))}
                </div>
                <div className="synthesis-result-actions">
                  <button className="synthesis-action-btn" onClick={exportToEditor}>
                    에디터에서 편집
                  </button>
                  <button className="synthesis-action-btn" onClick={downloadAsText}>
                    Markdown 다운로드
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
