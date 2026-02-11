/**
 * Vision System Types
 *
 * 4-layer vision system for MoA:
 * - Layer 1: Accessibility API (UI tree reader)
 * - Layer 2: Document file parser (.docx/.xlsx/.pptx/.hwpx)
 * - Layer 3: Smart screenshot (diff-based auto capture)
 * - Layer 4: PDF rendering (digital + scanned/image PDF with OCR support)
 */

/** Platform capabilities for vision operations */
export interface VisionPlatform {
  isWindows: boolean;
  isMacOS: boolean;
  isLinux: boolean;
}

/** Layer 1: Accessibility snapshot result */
export interface AccessibilitySnapshot {
  /** Structured text representation of the UI tree */
  tree: string;
  /** Number of elements found */
  elementCount: number;
  /** Focused element name/role */
  focusedElement?: string;
  /** Active window title */
  activeWindow?: string;
  /** Timestamp of the snapshot */
  timestamp: string;
}

/** Layer 2: Document parse result */
export interface DocumentParseResult {
  /** Extracted text content */
  text: string;
  /** Document type */
  type: "docx" | "xlsx" | "pptx" | "hwpx" | "unknown";
  /** Number of pages/sheets/slides */
  pageCount: number;
  /** Metadata (title, author, etc.) */
  metadata: Record<string, string>;
  /** Image references found */
  imageCount: number;
  /** Warning message (e.g. HWP conversion notice) */
  warning?: string;
}

/** Layer 3: Smart screenshot result */
export interface SmartScreenshotResult {
  /** Base64-encoded image data */
  base64: string;
  /** MIME type (image/png or image/jpeg) */
  mimeType: string;
  /** Width in pixels */
  width: number;
  /** Height in pixels */
  height: number;
  /** Whether changes were detected since last capture */
  hasChanges: boolean;
  /** Regions where changes were detected */
  changedRegions?: Array<{ x: number; y: number; w: number; h: number }>;
  /** Timestamp of the capture */
  timestamp: string;
}

/** Per-page text extraction info for scanned PDF analysis */
export interface PdfPageTextInfo {
  /** Page number (1-based) */
  page: number;
  /** Extracted text length (chars) */
  textLength: number;
  /** Whether this page appears to be scanned/image-based */
  isScanned: boolean;
}

/** Layout region detected in a scanned PDF page */
export interface PdfLayoutRegion {
  /** Region type */
  type: "text-block" | "image" | "table" | "header" | "footer";
  /** Bounding box (relative 0-1 coordinates) */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Page number this region belongs to */
  page: number;
}

/** Layer 4: PDF render result */
export interface PdfRenderResult {
  /** Extracted text from all pages */
  text: string;
  /** Number of pages */
  pageCount: number;
  /** Whether the PDF is detected as scanned/image-based */
  isScanned: boolean;
  /** Per-page text analysis */
  pageAnalysis?: PdfPageTextInfo[];
  /** Layout regions detected (for scanned PDFs) */
  layoutRegions?: PdfLayoutRegion[];
  /** Page images as base64 (auto-rendered for scanned PDFs, optional for digital) */
  pageImages?: Array<{
    page: number;
    base64: string;
    mimeType: string;
    width?: number;
    height?: number;
  }>;
  /** OCR guidance message when scanned PDF is detected */
  ocrGuidance?: string;
}

/** Document conversion result */
export interface DocumentConvertResult {
  /** Converted content (HTML, Markdown, or editor HTML). */
  content: string;
  /** Output format. */
  format: "html" | "markdown" | "editor";
  /** Source document type. */
  sourceType: "pdf" | "docx" | "xlsx" | "pptx" | "hwpx" | "unknown";
  /** Number of pages/sheets/slides. */
  pageCount: number;
  /** Whether the PDF was scanned/image-based. */
  isScanned?: boolean;
  /** Plain text extraction. */
  plainText: string;
  /** Path where output was saved. */
  savedTo?: string;
}

/** Combined vision result from the orchestrator */
export interface VisionResult {
  /** Which layers contributed to this result */
  layers: Array<"accessibility" | "document" | "screenshot" | "pdf">;
  /** Layer 1 result */
  accessibility?: AccessibilitySnapshot;
  /** Layer 2 result */
  document?: DocumentParseResult;
  /** Layer 3 result */
  screenshot?: SmartScreenshotResult;
  /** Layer 4 result */
  pdf?: PdfRenderResult;
  /** Human-readable summary */
  summary: string;
}
