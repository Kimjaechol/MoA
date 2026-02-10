/**
 * Vision System Types
 *
 * 4-layer vision system for MoA:
 * - Layer 1: Accessibility API (UI tree reader)
 * - Layer 2: Document file parser (.docx/.xlsx/.pptx)
 * - Layer 3: Smart screenshot (diff-based auto capture)
 * - Layer 4: PDF rendering (final verification)
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
  type: "docx" | "xlsx" | "pptx" | "unknown";
  /** Number of pages/sheets/slides */
  pageCount: number;
  /** Metadata (title, author, etc.) */
  metadata: Record<string, string>;
  /** Image references found */
  imageCount: number;
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

/** Layer 4: PDF render result */
export interface PdfRenderResult {
  /** Extracted text from all pages */
  text: string;
  /** Number of pages */
  pageCount: number;
  /** Page images as base64 (optional, only if requested) */
  pageImages?: Array<{ page: number; base64: string; mimeType: string }>;
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
