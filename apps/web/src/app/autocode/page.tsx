"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import Link from "next/link";
import Nav from "../../components/Nav";

/**
 * MoA Vision-Based Auto-Coding System
 *
 * AI-powered autonomous coding agent that:
 * 1. Receives a coding goal from the user
 * 2. Generates/modifies code
 * 3. Captures preview screenshots (Vision Layer 3)
 * 4. Detects errors from console/logs
 * 5. Auto-fixes in a loop until the goal is achieved
 *
 * Supports: Claude Opus 4.6, GPT-5, DeepSeek, Gemini
 */

interface LogEntry {
  id: string;
  type: "info" | "error" | "warning" | "success" | "fix";
  message: string;
  timestamp: string;
}

interface CodingIteration {
  iteration: number;
  action: string;
  code?: string;
  errors: string[];
  fixed: boolean;
}

const MODEL_OPTIONS = [
  { id: "auto", label: "자동 선택", desc: "전략에 따라 자동" },
  { id: "claude-opus-4-6", label: "Claude Opus 4.6", desc: "최고 성능" },
  { id: "gpt-5", label: "GPT-5", desc: "OpenAI 최신" },
  { id: "deepseek-chat", label: "DeepSeek V3", desc: "가성비 최고" },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", desc: "Google 최신" },
] as const;

const FRAMEWORK_OPTIONS = [
  { id: "nextjs", label: "Next.js", icon: "▲" },
  { id: "react", label: "React", icon: "⚛️" },
  { id: "vue", label: "Vue.js", icon: "🟢" },
  { id: "python", label: "Python", icon: "🐍" },
  { id: "node", label: "Node.js", icon: "💚" },
  { id: "other", label: "기타", icon: "📦" },
] as const;

export default function AutoCodePage() {
  const [goal, setGoal] = useState("");
  const [framework, setFramework] = useState("nextjs");
  const [selectedModel, setSelectedModel] = useState("auto");
  const [maxIterations, setMaxIterations] = useState(10);
  const [autoFix, setAutoFix] = useState(true);
  const [visionEnabled, setVisionEnabled] = useState(true);

  const [isRunning, setIsRunning] = useState(false);
  const [currentIteration, setCurrentIteration] = useState(0);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [iterations, setIterations] = useState<CodingIteration[]>([]);
  const [generatedCode, setGeneratedCode] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [errorCount, setErrorCount] = useState(0);
  const [fixCount, setFixCount] = useState(0);
  const [status, setStatus] = useState<"idle" | "coding" | "testing" | "fixing" | "complete" | "failed">("idle");

  const logsEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef(false);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const addLog = useCallback((type: LogEntry["type"], message: string) => {
    setLogs((prev) => [...prev, {
      id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
      type,
      message,
      timestamp: new Date().toLocaleTimeString("ko-KR"),
    }]);
  }, []);

  const handleStart = async () => {
    if (!goal.trim()) return;

    setIsRunning(true);
    setStatus("coding");
    setCurrentIteration(0);
    setLogs([]);
    setIterations([]);
    setGeneratedCode("");
    setErrorCount(0);
    setFixCount(0);
    abortRef.current = false;

    addLog("info", `목표 설정: "${goal}"`);
    addLog("info", `프레임워크: ${framework} | 모델: ${selectedModel} | 최대 반복: ${maxIterations}회`);
    addLog("info", `Vision: ${visionEnabled ? "활성" : "비활성"} | 자동 수정: ${autoFix ? "활성" : "비활성"}`);

    try {
      for (let i = 1; i <= maxIterations; i++) {
        if (abortRef.current) {
          addLog("warning", "사용자에 의해 중단되었습니다.");
          setStatus("idle");
          break;
        }

        setCurrentIteration(i);
        addLog("info", `--- 반복 ${i}/${maxIterations} ---`);

        // Step 1: Generate/fix code
        setStatus("coding");
        addLog("info", i === 1 ? "코드 생성 중..." : "코드 수정 중...");

        const codeResult = await fetch("/api/autocode", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            goal,
            framework,
            model: selectedModel,
            iteration: i,
            previousCode: generatedCode,
            previousErrors: iterations.at(-1)?.errors ?? [],
            visionEnabled,
          }),
        });

        if (!codeResult.ok) {
          const errData = await codeResult.json().catch(() => ({}));
          addLog("error", `코드 생성 실패: ${errData.error ?? `HTTP ${codeResult.status}`}`);
          setStatus("failed");
          break;
        }

        const codeData = await codeResult.json();
        setGeneratedCode(codeData.code);

        if (codeData.previewUrl) {
          setPreviewUrl(codeData.previewUrl);
        }

        addLog("success", `코드 생성 완료 (${codeData.model})`);

        // Step 2: Test the code
        setStatus("testing");
        addLog("info", "코드 검증 중...");

        const testResult = await fetch("/api/autocode/test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code: codeData.code,
            framework,
            goal,
            visionEnabled,
          }),
        });

        const testData = await testResult.json();
        const errors = testData.errors ?? [];
        const warnings = testData.warnings ?? [];

        const iteration: CodingIteration = {
          iteration: i,
          action: i === 1 ? "initial" : "fix",
          code: codeData.code,
          errors,
          fixed: errors.length === 0,
        };
        setIterations((prev) => [...prev, iteration]);

        if (warnings.length > 0) {
          warnings.forEach((w: string) => addLog("warning", w));
        }

        if (errors.length === 0) {
          addLog("success", "에러 없음 — 목표 달성!");
          setStatus("complete");
          break;
        }

        setErrorCount((prev) => prev + errors.length);
        errors.forEach((err: string) => addLog("error", err));
        addLog("error", `에러 ${errors.length}개 발견`);

        if (!autoFix) {
          addLog("warning", "자동 수정이 비활성화되어 있습니다. 수동으로 수정해주세요.");
          setStatus("idle");
          break;
        }

        // Step 3: Auto-fix
        setStatus("fixing");
        addLog("fix", `에러 자동 수정 시도 (${errors.length}개)...`);
        setFixCount((prev) => prev + 1);

        if (i === maxIterations) {
          addLog("warning", `최대 반복 횟수(${maxIterations})에 도달했습니다.`);
          setStatus("failed");
        }
      }
    } catch (err) {
      addLog("error", `예외 발생: ${String(err)}`);
      setStatus("failed");
    } finally {
      setIsRunning(false);
    }
  };

  const handleStop = () => {
    abortRef.current = true;
    addLog("warning", "중단 요청 전송...");
  };

  const copyCode = () => {
    if (generatedCode) {
      navigator.clipboard.writeText(generatedCode);
      addLog("info", "코드가 클립보드에 복사되었습니다.");
    }
  };

  const downloadCode = () => {
    if (!generatedCode) return;
    const ext = framework === "python" ? "py" : "tsx";
    const blob = new Blob([generatedCode], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `autocode-result.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <Nav />
      <div className="autocode-layout">
        {/* Header */}
        <div className="autocode-header">
          <div className="autocode-header-left">
            <Link href="/chat" className="autocode-back">&larr;</Link>
            <h1>AI 자동코딩</h1>
            <span className={`autocode-status autocode-status-${status}`}>
              {{ idle: "대기", coding: "코딩 중", testing: "검증 중", fixing: "수정 중", complete: "완료", failed: "실패" }[status]}
            </span>
          </div>
          <div className="autocode-header-right">
            <div className="autocode-stats">
              <span>반복: {currentIteration}/{maxIterations}</span>
              <span>에러: {errorCount}</span>
              <span>수정: {fixCount}</span>
            </div>
          </div>
        </div>

        <div className="autocode-main">
          {/* Left Panel: Config + Logs */}
          <div className="autocode-panel autocode-config-panel">
            {/* Goal Input */}
            <div className="autocode-section">
              <h3>목표 설정</h3>
              <textarea
                className="autocode-goal-input"
                placeholder="만들고 싶은 것을 자세히 설명하세요...&#10;&#10;예: React로 Todo 앱을 만들어줘. LocalStorage에 저장하고, 완료/삭제 기능, 다크 테마 지원."
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                rows={4}
                disabled={isRunning}
              />
            </div>

            {/* Framework */}
            <div className="autocode-section">
              <h3>프레임워크</h3>
              <div className="autocode-framework-grid">
                {FRAMEWORK_OPTIONS.map((fw) => (
                  <button
                    key={fw.id}
                    className={`autocode-fw-btn ${framework === fw.id ? "active" : ""}`}
                    onClick={() => setFramework(fw.id)}
                    disabled={isRunning}
                  >
                    <span>{fw.icon}</span>
                    <span>{fw.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Model Selection */}
            <div className="autocode-section">
              <h3>AI 모델</h3>
              <div className="autocode-model-grid">
                {MODEL_OPTIONS.map((m) => (
                  <button
                    key={m.id}
                    className={`autocode-model-btn ${selectedModel === m.id ? "active" : ""}`}
                    onClick={() => setSelectedModel(m.id)}
                    disabled={isRunning}
                  >
                    <strong>{m.label}</strong>
                    <span>{m.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Options */}
            <div className="autocode-section autocode-options">
              <div className="autocode-option-row">
                <label>최대 반복: <strong>{maxIterations}</strong></label>
                <input type="range" min={1} max={30} value={maxIterations}
                  onChange={(e) => setMaxIterations(parseInt(e.target.value))} disabled={isRunning} />
              </div>
              <label className="autocode-toggle-label">
                <input type="checkbox" checked={autoFix} onChange={(e) => setAutoFix(e.target.checked)} disabled={isRunning} />
                <span>에러 자동 수정</span>
              </label>
              <label className="autocode-toggle-label">
                <input type="checkbox" checked={visionEnabled} onChange={(e) => setVisionEnabled(e.target.checked)} disabled={isRunning} />
                <span>Vision 기반 UI 검증</span>
              </label>
            </div>

            {/* Action Buttons */}
            <div className="autocode-actions">
              {!isRunning ? (
                <button className="autocode-start-btn" onClick={handleStart} disabled={!goal.trim()}>
                  자동코딩 시작
                </button>
              ) : (
                <button className="autocode-stop-btn" onClick={handleStop}>
                  중단
                </button>
              )}
            </div>

            {/* Logs */}
            <div className="autocode-section">
              <h3>실행 로그</h3>
              <div className="autocode-logs">
                {logs.map((log) => (
                  <div key={log.id} className={`autocode-log autocode-log-${log.type}`}>
                    <span className="autocode-log-time">{log.timestamp}</span>
                    <span className="autocode-log-badge">
                      {{ info: "INFO", error: "ERR", warning: "WARN", success: "OK", fix: "FIX" }[log.type]}
                    </span>
                    <span className="autocode-log-msg">{log.message}</span>
                  </div>
                ))}
                {logs.length === 0 && (
                  <p className="autocode-log-empty">로그가 비어있습니다. 자동코딩을 시작하세요.</p>
                )}
                <div ref={logsEndRef} />
              </div>
            </div>
          </div>

          {/* Right Panel: Code + Preview */}
          <div className="autocode-panel autocode-output-panel">
            {/* Code Output */}
            <div className="autocode-section autocode-code-section">
              <div className="autocode-code-header">
                <h3>생성된 코드</h3>
                <div className="autocode-code-actions">
                  <button className="autocode-code-btn" onClick={copyCode} disabled={!generatedCode}>복사</button>
                  <button className="autocode-code-btn" onClick={downloadCode} disabled={!generatedCode}>다운로드</button>
                </div>
              </div>
              <div className="autocode-code-viewer">
                {generatedCode ? (
                  <pre><code>{generatedCode}</code></pre>
                ) : (
                  <div className="autocode-code-empty">
                    <p>아직 코드가 생성되지 않았습니다.</p>
                    <p>목표를 입력하고 자동코딩을 시작하세요.</p>
                  </div>
                )}
              </div>
            </div>

            {/* Preview */}
            <div className="autocode-section autocode-preview-section">
              <h3>미리보기</h3>
              <div className="autocode-preview">
                {previewUrl ? (
                  <iframe src={previewUrl} title="Preview" className="autocode-preview-iframe" />
                ) : (
                  <div className="autocode-preview-empty">
                    <span>🖥️</span>
                    <p>코드 실행 후 미리보기가 여기에 표시됩니다.</p>
                    <p className="autocode-preview-hint">
                      Vision Layer 3이 스크린샷을 캡처하고 에러를 감지합니다.
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Iteration History */}
            {iterations.length > 0 && (
              <div className="autocode-section">
                <h3>반복 기록</h3>
                <div className="autocode-iterations">
                  {iterations.map((iter) => (
                    <div key={iter.iteration} className={`autocode-iter ${iter.fixed ? "autocode-iter-ok" : "autocode-iter-err"}`}>
                      <span className="autocode-iter-num">#{iter.iteration}</span>
                      <span className="autocode-iter-status">{iter.fixed ? "성공" : `에러 ${iter.errors.length}개`}</span>
                      <span className="autocode-iter-action">{iter.action}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
