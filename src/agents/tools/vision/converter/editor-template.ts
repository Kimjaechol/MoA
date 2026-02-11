/**
 * Self-contained HTML Editor Template
 *
 * Generates a standalone HTML file with an embedded WYSIWYG editor featuring:
 *   - Toolbar with formatting buttons (bold, italic, underline, alignment, lists)
 *   - Font family and size selectors
 *   - Table editing
 *   - Save as HTML / Save as Markdown / Save as text
 *   - Export to PDF (via print)
 *   - Dark/light theme toggle
 *   - The converted document content pre-loaded
 *
 * No external dependencies — pure HTML/CSS/JS.
 */

export interface EditorTemplateOptions {
  /** Document title shown in the editor. */
  title?: string;
  /** Initial HTML content to load into the editor. */
  content?: string;
  /** Theme: "light" or "dark". Default "light". */
  theme?: "light" | "dark";
  /** Language for UI labels. Default "ko". */
  lang?: "ko" | "en";
  /** Enable auto-save to localStorage. Default true. */
  autoSave?: boolean;
}

const LABELS = {
  ko: {
    save: "저장",
    saveHtml: "HTML 저장",
    saveMd: "마크다운 저장",
    saveTxt: "텍스트 저장",
    exportPdf: "PDF 내보내기",
    bold: "굵게",
    italic: "기울임",
    underline: "밑줄",
    strike: "취소선",
    alignLeft: "왼쪽 정렬",
    alignCenter: "가운데 정렬",
    alignRight: "오른쪽 정렬",
    alignJustify: "양쪽 정렬",
    listUl: "글머리 기호",
    listOl: "번호 목록",
    insertTable: "표 삽입",
    undo: "실행취소",
    redo: "다시실행",
    heading: "제목",
    normal: "본문",
    fontFamily: "글꼴",
    fontSize: "글자크기",
    theme: "테마",
    saved: "저장됨",
    untitled: "제목 없는 문서",
  },
  en: {
    save: "Save",
    saveHtml: "Save as HTML",
    saveMd: "Save as Markdown",
    saveTxt: "Save as Text",
    exportPdf: "Export PDF",
    bold: "Bold",
    italic: "Italic",
    underline: "Underline",
    strike: "Strikethrough",
    alignLeft: "Align Left",
    alignCenter: "Align Center",
    alignRight: "Align Right",
    alignJustify: "Justify",
    listUl: "Bullet List",
    listOl: "Numbered List",
    insertTable: "Insert Table",
    undo: "Undo",
    redo: "Redo",
    heading: "Heading",
    normal: "Normal",
    fontFamily: "Font",
    fontSize: "Size",
    theme: "Theme",
    saved: "Saved",
    untitled: "Untitled Document",
  },
};

function escapeForTemplate(str: string): string {
  return str.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$/g, "\\$");
}

/**
 * Generate a self-contained HTML editor with the given content.
 */
export function generateEditorHtml(opts?: EditorTemplateOptions): string {
  const lang = opts?.lang ?? "ko";
  const L = LABELS[lang];
  const title = opts?.title ?? L.untitled;
  const content = opts?.content ?? "";
  const theme = opts?.theme ?? "light";
  const autoSave = opts?.autoSave ?? true;

  // Escape content for embedding in the template
  const escapedContent = content
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  // We need to unescape back to HTML for the editor
  // The content is already valid HTML from our converters

  return `<!DOCTYPE html>
<html lang="${lang}" data-theme="${theme}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)} - MoA Editor</title>
<style>
:root {
  --editor-bg: #ffffff;
  --editor-text: #222222;
  --toolbar-bg: #f8f9fa;
  --toolbar-border: #dee2e6;
  --btn-hover: #e9ecef;
  --btn-active: #d3d8de;
  --editor-border: #ccc;
  --status-bg: #f1f3f5;
  --shadow: 0 2px 8px rgba(0,0,0,0.08);
}
[data-theme="dark"] {
  --editor-bg: #1a1a2e;
  --editor-text: #e8e8f0;
  --toolbar-bg: #16162b;
  --toolbar-border: #2a2a45;
  --btn-hover: #252540;
  --btn-active: #333355;
  --editor-border: #2a2a45;
  --status-bg: #12122a;
  --shadow: 0 2px 8px rgba(0,0,0,0.3);
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: "Malgun Gothic", "맑은 고딕", -apple-system, sans-serif;
  background: var(--status-bg);
  color: var(--editor-text);
  height: 100vh;
  display: flex;
  flex-direction: column;
}

/* Toolbar */
.toolbar {
  background: var(--toolbar-bg);
  border-bottom: 1px solid var(--toolbar-border);
  padding: 6px 12px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
  box-shadow: var(--shadow);
  z-index: 10;
}
.toolbar-group {
  display: flex;
  gap: 2px;
  align-items: center;
}
.toolbar-group + .toolbar-group {
  margin-left: 4px;
  padding-left: 8px;
  border-left: 1px solid var(--toolbar-border);
}
.toolbar button {
  background: none;
  border: 1px solid transparent;
  border-radius: 4px;
  padding: 4px 8px;
  cursor: pointer;
  color: var(--editor-text);
  font-size: 14px;
  line-height: 1;
  min-width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.toolbar button:hover { background: var(--btn-hover); }
.toolbar button.active { background: var(--btn-active); border-color: var(--toolbar-border); }
.toolbar select {
  background: var(--toolbar-bg);
  border: 1px solid var(--toolbar-border);
  border-radius: 4px;
  padding: 4px 6px;
  color: var(--editor-text);
  font-size: 12px;
  height: 28px;
  cursor: pointer;
}
.toolbar .separator {
  width: 1px;
  height: 20px;
  background: var(--toolbar-border);
  margin: 0 4px;
}

/* Title bar */
.title-bar {
  background: var(--toolbar-bg);
  border-bottom: 1px solid var(--toolbar-border);
  padding: 8px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.title-bar input {
  background: none;
  border: none;
  font-size: 16px;
  font-weight: 600;
  color: var(--editor-text);
  flex: 1;
  outline: none;
}
.title-bar input:focus {
  border-bottom: 2px solid #667eea;
}
.save-group {
  display: flex;
  gap: 6px;
}
.save-btn {
  padding: 6px 14px;
  border: 1px solid var(--toolbar-border);
  border-radius: 6px;
  background: var(--toolbar-bg);
  color: var(--editor-text);
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
  transition: all 0.15s;
}
.save-btn:hover { background: var(--btn-hover); }
.save-btn.primary {
  background: #667eea;
  color: white;
  border-color: #5a67d8;
}
.save-btn.primary:hover { background: #5a67d8; }

/* Editor area */
.editor-wrapper {
  flex: 1;
  overflow: auto;
  padding: 24px;
  display: flex;
  justify-content: center;
}
.editor {
  width: 100%;
  max-width: 816px;
  min-height: 1056px;
  background: var(--editor-bg);
  padding: 56px 64px;
  box-shadow: var(--shadow);
  border-radius: 4px;
  outline: none;
  font-size: 12pt;
  line-height: 1.6;
  color: var(--editor-text);
}
.editor:focus { box-shadow: 0 0 0 2px rgba(102,126,234,0.3), var(--shadow); }
.editor table { border-collapse: collapse; width: 100%; margin: 12px 0; }
.editor td, .editor th { border: 1px solid var(--toolbar-border); padding: 6px 10px; min-width: 60px; }
.editor th { background: var(--btn-hover); font-weight: 600; }
.editor img { max-width: 100%; height: auto; }
.editor h1 { font-size: 24px; margin: 16px 0 8px; }
.editor h2 { font-size: 20px; margin: 14px 0 6px; }
.editor h3 { font-size: 16px; margin: 10px 0 4px; }
.editor p { margin: 4px 0; }

/* Status bar */
.status-bar {
  background: var(--status-bg);
  border-top: 1px solid var(--toolbar-border);
  padding: 4px 16px;
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: #888;
}

@media print {
  .toolbar, .title-bar, .status-bar { display: none !important; }
  .editor-wrapper { padding: 0; }
  .editor { box-shadow: none; max-width: none; padding: 24px; }
  body { background: white; }
}
</style>
</head>
<body>
<div class="title-bar">
  <input type="text" id="docTitle" value="${escapeHtml(title)}" placeholder="${L.untitled}">
  <div class="save-group">
    <button class="save-btn" onclick="saveAs('html')" title="${L.saveHtml}">HTML</button>
    <button class="save-btn" onclick="saveAs('md')" title="${L.saveMd}">MD</button>
    <button class="save-btn" onclick="saveAs('txt')" title="${L.saveTxt}">TXT</button>
    <button class="save-btn" onclick="exportPdf()" title="${L.exportPdf}">PDF</button>
    <button class="save-btn primary" onclick="saveAs('html')">${L.save}</button>
  </div>
</div>

<div class="toolbar">
  <div class="toolbar-group">
    <button onclick="execCmd('undo')" title="${L.undo}">&#x21B6;</button>
    <button onclick="execCmd('redo')" title="${L.redo}">&#x21B7;</button>
  </div>
  <div class="toolbar-group">
    <select onchange="applyHeading(this.value)" title="${L.heading}">
      <option value="p">${L.normal}</option>
      <option value="h1">H1</option>
      <option value="h2">H2</option>
      <option value="h3">H3</option>
      <option value="h4">H4</option>
    </select>
  </div>
  <div class="toolbar-group">
    <select id="fontFamily" onchange="execCmd('fontName',this.value)" title="${L.fontFamily}">
      <option value="Malgun Gothic">맑은 고딕</option>
      <option value="Batang">바탕</option>
      <option value="Gulim">굴림</option>
      <option value="Dotum">돋움</option>
      <option value="Nanum Gothic">나눔고딕</option>
      <option value="Nanum Myeongjo">나눔명조</option>
      <option value="Arial">Arial</option>
      <option value="Times New Roman">Times New Roman</option>
      <option value="Courier New">Courier New</option>
    </select>
    <select id="fontSize" onchange="execCmd('fontSize',this.value)" title="${L.fontSize}">
      <option value="1">8pt</option>
      <option value="2">10pt</option>
      <option value="3" selected>12pt</option>
      <option value="4">14pt</option>
      <option value="5">18pt</option>
      <option value="6">24pt</option>
      <option value="7">36pt</option>
    </select>
  </div>
  <div class="toolbar-group">
    <button onclick="execCmd('bold')" title="${L.bold}"><b>B</b></button>
    <button onclick="execCmd('italic')" title="${L.italic}"><i>I</i></button>
    <button onclick="execCmd('underline')" title="${L.underline}"><u>U</u></button>
    <button onclick="execCmd('strikeThrough')" title="${L.strike}"><s>S</s></button>
  </div>
  <div class="toolbar-group">
    <button onclick="execCmd('justifyLeft')" title="${L.alignLeft}">&#x2190;</button>
    <button onclick="execCmd('justifyCenter')" title="${L.alignCenter}">&#x2194;</button>
    <button onclick="execCmd('justifyRight')" title="${L.alignRight}">&#x2192;</button>
    <button onclick="execCmd('justifyFull')" title="${L.alignJustify}">&#x2195;</button>
  </div>
  <div class="toolbar-group">
    <button onclick="execCmd('insertUnorderedList')" title="${L.listUl}">&#x2022;</button>
    <button onclick="execCmd('insertOrderedList')" title="${L.listOl}">1.</button>
  </div>
  <div class="toolbar-group">
    <button onclick="insertTable()" title="${L.insertTable}">&#x25A6;</button>
  </div>
  <div class="toolbar-group">
    <button onclick="toggleTheme()" title="${L.theme}">&#x263C;</button>
  </div>
</div>

<div class="editor-wrapper">
  <div class="editor" id="editor" contenteditable="true"></div>
</div>

<div class="status-bar">
  <span id="charCount">0 chars</span>
  <span id="saveStatus"></span>
</div>

<script>
(function() {
  var editor = document.getElementById('editor');
  var initialContent = ${JSON.stringify(content)};

  // Decode the initial HTML content
  editor.innerHTML = initialContent;

  // Update char count
  function updateStatus() {
    var text = editor.innerText || '';
    document.getElementById('charCount').textContent = text.length + ' chars';
  }
  editor.addEventListener('input', updateStatus);
  updateStatus();

  // Auto-save
  ${
    autoSave
      ? `
  var saveTimer;
  editor.addEventListener('input', function() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function() {
      try {
        localStorage.setItem('moa-editor-content', editor.innerHTML);
        localStorage.setItem('moa-editor-title', document.getElementById('docTitle').value);
        document.getElementById('saveStatus').textContent = '${L.saved}';
        setTimeout(function() { document.getElementById('saveStatus').textContent = ''; }, 2000);
      } catch(e) {}
    }, 1000);
  });
  // Restore from localStorage if empty
  if (!initialContent) {
    var saved = localStorage.getItem('moa-editor-content');
    if (saved) editor.innerHTML = saved;
    var savedTitle = localStorage.getItem('moa-editor-title');
    if (savedTitle) document.getElementById('docTitle').value = savedTitle;
    updateStatus();
  }
  `
      : ""
  }

  // Expose functions to window
  window.execCmd = function(cmd, val) {
    document.execCommand(cmd, false, val || null);
    editor.focus();
  };

  window.applyHeading = function(tag) {
    if (tag === 'p') {
      document.execCommand('formatBlock', false, 'p');
    } else {
      document.execCommand('formatBlock', false, tag);
    }
    editor.focus();
  };

  window.insertTable = function() {
    var rows = prompt('행 수 (Rows):', '3');
    var cols = prompt('열 수 (Columns):', '3');
    if (!rows || !cols) return;
    var r = parseInt(rows), c = parseInt(cols);
    if (isNaN(r) || isNaN(c) || r < 1 || c < 1) return;
    var html = '<table style="width:100%;border-collapse:collapse;margin:12px 0">';
    for (var i = 0; i < r; i++) {
      html += '<tr>';
      for (var j = 0; j < c; j++) {
        var tag = i === 0 ? 'th' : 'td';
        html += '<' + tag + ' style="border:1px solid #ccc;padding:6px 10px">&nbsp;</' + tag + '>';
      }
      html += '</tr>';
    }
    html += '</table><p><br></p>';
    document.execCommand('insertHTML', false, html);
    editor.focus();
  };

  window.toggleTheme = function() {
    var html = document.documentElement;
    var current = html.getAttribute('data-theme');
    html.setAttribute('data-theme', current === 'dark' ? 'light' : 'dark');
  };

  window.saveAs = function(format) {
    var title = document.getElementById('docTitle').value || '${L.untitled}';
    var content, mimeType, ext;

    switch (format) {
      case 'html':
        content = buildFullHtml(editor.innerHTML, title);
        mimeType = 'text/html';
        ext = '.html';
        break;
      case 'md':
        content = htmlToMarkdown(editor.innerHTML);
        mimeType = 'text/markdown';
        ext = '.md';
        break;
      case 'txt':
        content = editor.innerText || '';
        mimeType = 'text/plain';
        ext = '.txt';
        break;
      default:
        return;
    }

    var blob = new Blob([content], { type: mimeType + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = title + ext;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  window.exportPdf = function() {
    window.print();
  };

  function buildFullHtml(bodyHtml, title) {
    return '<!DOCTYPE html>\\n<html lang="${lang}">\\n<head>\\n' +
      '<meta charset="UTF-8">\\n<meta name="viewport" content="width=device-width, initial-scale=1.0">\\n' +
      '<title>' + escapeHtmlStr(title) + '</title>\\n' +
      '<style>\\n' +
      'body { font-family: "Malgun Gothic", sans-serif; max-width: 794px; margin: 0 auto; padding: 48px 56px; line-height: 1.6; color: #222; }\\n' +
      'table { border-collapse: collapse; width: 100%; margin: 12px 0; }\\n' +
      'td, th { border: 1px solid #ccc; padding: 6px 10px; }\\n' +
      'th { background: #f8f8f8; font-weight: 600; }\\n' +
      'img { max-width: 100%; }\\n' +
      '</style>\\n</head>\\n<body>\\n' + bodyHtml + '\\n</body>\\n</html>';
  }

  function escapeHtmlStr(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // Simple HTML → Markdown for save-as-md
  function htmlToMarkdown(html) {
    var md = html;
    // Tables
    md = md.replace(/<table[^>]*>([\\s\\S]*?)<\\/table>/gi, function(m, content) {
      var rows = [];
      content.replace(/<tr[^>]*>([\\s\\S]*?)<\\/tr>/gi, function(m2, row) {
        var cells = [];
        row.replace(/<(?:td|th)[^>]*>([\\s\\S]*?)<\\/(?:td|th)>/gi, function(m3, cell) {
          cells.push(cell.replace(/<[^>]+>/g,'').trim());
        });
        rows.push(cells);
      });
      if (!rows.length) return '';
      var maxCols = Math.max.apply(null, rows.map(function(r){return r.length}));
      var lines = [];
      lines.push('| ' + rows[0].join(' | ') + ' |');
      lines.push('| ' + rows[0].map(function(){return '---'}).join(' | ') + ' |');
      for (var i = 1; i < rows.length; i++) {
        while (rows[i].length < maxCols) rows[i].push('');
        lines.push('| ' + rows[i].join(' | ') + ' |');
      }
      return '\\n' + lines.join('\\n') + '\\n';
    });
    md = md.replace(/<h1[^>]*>([\\s\\S]*?)<\\/h1>/gi, function(m,t){return '\\n# '+t.replace(/<[^>]+>/g,'')+'\\n'});
    md = md.replace(/<h2[^>]*>([\\s\\S]*?)<\\/h2>/gi, function(m,t){return '\\n## '+t.replace(/<[^>]+>/g,'')+'\\n'});
    md = md.replace(/<h3[^>]*>([\\s\\S]*?)<\\/h3>/gi, function(m,t){return '\\n### '+t.replace(/<[^>]+>/g,'')+'\\n'});
    md = md.replace(/<strong[^>]*>([\\s\\S]*?)<\\/strong>/gi, '**$1**');
    md = md.replace(/<b[^>]*>([\\s\\S]*?)<\\/b>/gi, '**$1**');
    md = md.replace(/<em[^>]*>([\\s\\S]*?)<\\/em>/gi, '*$1*');
    md = md.replace(/<i[^>]*>([\\s\\S]*?)<\\/i>/gi, '*$1*');
    md = md.replace(/<br\\s*\\/?>/gi, '  \\n');
    md = md.replace(/<p[^>]*>([\\s\\S]*?)<\\/p>/gi, function(m,t){return '\\n'+t.replace(/<[^>]+>/g,'')+'\\n'});
    md = md.replace(/<[^>]+>/g, '');
    md = md.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&nbsp;/g,' ');
    md = md.replace(/\\n{3,}/g, '\\n\\n');
    return md.trim() + '\\n';
  }
})();
</script>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
