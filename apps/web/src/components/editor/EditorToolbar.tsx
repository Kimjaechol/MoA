"use client";

import type { Editor } from "@tiptap/react";
import "./font-size-extension"; // type augmentation for setFontSize command

interface ToolbarProps {
  editor: Editor | null;
}

const FONT_FAMILIES = [
  { label: "맑은 고딕", value: "Malgun Gothic" },
  { label: "바탕", value: "Batang" },
  { label: "굴림", value: "Gulim" },
  { label: "돋움", value: "Dotum" },
  { label: "나눔고딕", value: "Nanum Gothic" },
  { label: "나눔명조", value: "Nanum Myeongjo" },
  { label: "Arial", value: "Arial" },
  { label: "Times New Roman", value: "Times New Roman" },
  { label: "Courier New", value: "Courier New" },
];

const FONT_SIZES = [
  { label: "8", value: "8px" },
  { label: "9", value: "9px" },
  { label: "10", value: "10px" },
  { label: "11", value: "11px" },
  { label: "12", value: "12px" },
  { label: "14", value: "14px" },
  { label: "16", value: "16px" },
  { label: "18", value: "18px" },
  { label: "20", value: "20px" },
  { label: "24", value: "24px" },
  { label: "28", value: "28px" },
  { label: "36", value: "36px" },
  { label: "48", value: "48px" },
];

const COLORS = [
  "#000000", "#434343", "#666666", "#999999", "#cccccc",
  "#d32f2f", "#e64a19", "#f57c00", "#fbc02d", "#388e3c",
  "#1976d2", "#512da8", "#c2185b", "#00796b", "#455a64",
];

export default function EditorToolbar({ editor }: ToolbarProps) {
  if (!editor) return null;

  const insertTable = () => {
    editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
  };

  const addImage = () => {
    const url = prompt("이미지 URL을 입력하세요:");
    if (url) {
      editor.chain().focus().setImage({ src: url }).run();
    }
  };

  return (
    <div className="editor-toolbar">
      {/* Undo / Redo */}
      <div className="toolbar-group">
        <ToolbarButton
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
          title="실행취소 (Ctrl+Z)"
          icon="↶"
        />
        <ToolbarButton
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
          title="다시실행 (Ctrl+Y)"
          icon="↷"
        />
      </div>

      <div className="toolbar-sep" />

      {/* Heading */}
      <div className="toolbar-group">
        <select
          className="toolbar-select"
          value={
            editor.isActive("heading", { level: 1 }) ? "h1" :
            editor.isActive("heading", { level: 2 }) ? "h2" :
            editor.isActive("heading", { level: 3 }) ? "h3" :
            editor.isActive("heading", { level: 4 }) ? "h4" : "p"
          }
          onChange={(e) => {
            const val = e.target.value;
            if (val === "p") {
              editor.chain().focus().setParagraph().run();
            } else {
              const level = parseInt(val.replace("h", ""), 10) as 1 | 2 | 3 | 4;
              editor.chain().focus().toggleHeading({ level }).run();
            }
          }}
          title="단락 스타일"
        >
          <option value="p">본문</option>
          <option value="h1">제목 1</option>
          <option value="h2">제목 2</option>
          <option value="h3">제목 3</option>
          <option value="h4">제목 4</option>
        </select>
      </div>

      <div className="toolbar-sep" />

      {/* Font Family */}
      <div className="toolbar-group">
        <select
          className="toolbar-select toolbar-select-font"
          onChange={(e) => {
            editor.chain().focus().setFontFamily(e.target.value).run();
          }}
          title="글꼴"
          defaultValue="Malgun Gothic"
        >
          {FONT_FAMILIES.map((f) => (
            <option key={f.value} value={f.value} style={{ fontFamily: f.value }}>
              {f.label}
            </option>
          ))}
        </select>

        {/* Font Size */}
        <select
          className="toolbar-select toolbar-select-size"
          onChange={(e) => {
            editor.chain().focus().setFontSize(e.target.value).run();
          }}
          title="글자 크기"
          defaultValue="12px"
        >
          {FONT_SIZES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      <div className="toolbar-sep" />

      {/* Text Formatting */}
      <div className="toolbar-group">
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBold().run()}
          active={editor.isActive("bold")}
          title="굵게 (Ctrl+B)"
          icon={<b>B</b>}
        />
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleItalic().run()}
          active={editor.isActive("italic")}
          title="기울임 (Ctrl+I)"
          icon={<i>I</i>}
        />
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          active={editor.isActive("underline")}
          title="밑줄 (Ctrl+U)"
          icon={<u>U</u>}
        />
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleStrike().run()}
          active={editor.isActive("strike")}
          title="취소선"
          icon={<s>S</s>}
        />
      </div>

      <div className="toolbar-sep" />

      {/* Text Color */}
      <div className="toolbar-group">
        <div className="toolbar-color-wrapper">
          <ToolbarButton
            onClick={() => {}}
            title="글자 색상"
            icon="A"
            className="toolbar-color-btn"
          />
          <div className="toolbar-color-dropdown">
            {COLORS.map((color) => (
              <button
                key={color}
                className="toolbar-color-swatch"
                style={{ background: color }}
                onClick={() => editor.chain().focus().setColor(color).run()}
                title={color}
              />
            ))}
            <button
              className="toolbar-color-reset"
              onClick={() => editor.chain().focus().unsetColor().run()}
            >
              기본 색상
            </button>
          </div>
        </div>
        <div className="toolbar-color-wrapper">
          <ToolbarButton
            onClick={() => {}}
            title="배경 색상"
            icon="⬛"
            className="toolbar-color-btn"
          />
          <div className="toolbar-color-dropdown">
            {COLORS.map((color) => (
              <button
                key={color}
                className="toolbar-color-swatch"
                style={{ background: color }}
                onClick={() => editor.chain().focus().toggleHighlight({ color }).run()}
                title={color}
              />
            ))}
            <button
              className="toolbar-color-reset"
              onClick={() => editor.chain().focus().unsetHighlight().run()}
            >
              배경 제거
            </button>
          </div>
        </div>
      </div>

      <div className="toolbar-sep" />

      {/* Alignment */}
      <div className="toolbar-group">
        <ToolbarButton
          onClick={() => editor.chain().focus().setTextAlign("left").run()}
          active={editor.isActive({ textAlign: "left" })}
          title="왼쪽 정렬"
          icon="⫷"
        />
        <ToolbarButton
          onClick={() => editor.chain().focus().setTextAlign("center").run()}
          active={editor.isActive({ textAlign: "center" })}
          title="가운데 정렬"
          icon="⫿"
        />
        <ToolbarButton
          onClick={() => editor.chain().focus().setTextAlign("right").run()}
          active={editor.isActive({ textAlign: "right" })}
          title="오른쪽 정렬"
          icon="⫸"
        />
        <ToolbarButton
          onClick={() => editor.chain().focus().setTextAlign("justify").run()}
          active={editor.isActive({ textAlign: "justify" })}
          title="양쪽 정렬"
          icon="☰"
        />
      </div>

      <div className="toolbar-sep" />

      {/* Lists */}
      <div className="toolbar-group">
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          active={editor.isActive("bulletList")}
          title="글머리 기호"
          icon="•"
        />
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          active={editor.isActive("orderedList")}
          title="번호 목록"
          icon="1."
        />
      </div>

      <div className="toolbar-sep" />

      {/* Insert */}
      <div className="toolbar-group">
        <ToolbarButton
          onClick={insertTable}
          title="표 삽입"
          icon="⊞"
        />
        <ToolbarButton
          onClick={addImage}
          title="이미지 삽입"
          icon="🖼"
        />
        <ToolbarButton
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
          title="구분선"
          icon="—"
        />
      </div>

      <div className="toolbar-sep" />

      {/* Block quotes & Code */}
      <div className="toolbar-group">
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          active={editor.isActive("blockquote")}
          title="인용문"
          icon="❝"
        />
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          active={editor.isActive("codeBlock")}
          title="코드 블록"
          icon="⟨/⟩"
        />
      </div>

      {/* Table Controls — only visible when inside a table */}
      {editor.isActive("table") && (
        <>
          <div className="toolbar-sep" />
          <div className="toolbar-group toolbar-table-group">
            <ToolbarButton
              onClick={() => editor.chain().focus().addColumnAfter().run()}
              title="열 추가"
              icon="+|"
            />
            <ToolbarButton
              onClick={() => editor.chain().focus().deleteColumn().run()}
              title="열 삭제"
              icon="-|"
            />
            <ToolbarButton
              onClick={() => editor.chain().focus().addRowAfter().run()}
              title="행 추가"
              icon="+─"
            />
            <ToolbarButton
              onClick={() => editor.chain().focus().deleteRow().run()}
              title="행 삭제"
              icon="-─"
            />
            <ToolbarButton
              onClick={() => editor.chain().focus().mergeCells().run()}
              title="셀 병합"
              icon="⊟"
            />
            <ToolbarButton
              onClick={() => editor.chain().focus().splitCell().run()}
              title="셀 분할"
              icon="⊞"
            />
            <ToolbarButton
              onClick={() => editor.chain().focus().deleteTable().run()}
              title="표 삭제"
              icon="✕"
              className="toolbar-btn-danger"
            />
          </div>
        </>
      )}
    </div>
  );
}

function ToolbarButton({
  onClick,
  title,
  icon,
  active,
  disabled,
  className,
}: {
  onClick: () => void;
  title: string;
  icon: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={`toolbar-btn ${active ? "active" : ""} ${className ?? ""}`}
    >
      {icon}
    </button>
  );
}
