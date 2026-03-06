export type JobStatus = "PENDING" | "RUNNING" | "PASSED" | "FAILED" | "ERROR";
export type CheckSeverity = "FAIL" | "WARN" | "INFO";

export interface PreflightCheckResult {
  code: string;
  severity: CheckSeverity;
  passed: boolean;
  message: string;
  actual?: string | number | boolean | null;
  expected?: string | number | boolean | null;
}

export interface ImageMetadata {
  format?: string;
  widthPx?: number;
  heightPx?: number;
  dpiX?: number | null;
  dpiY?: number | null;
  orientation?: number | null;
  colorSpace?: string | null;
  hasIccProfile?: boolean;
  bitDepth?: number | null;
  hasAlpha?: boolean;
  pageCount?: number;
  pageWidthIn?: number | null;
  pageHeightIn?: number | null;
  pdfVersion?: string | null;
  isEncrypted?: boolean | null;
  hasAcroForm?: boolean;
  hasJavaScript?: boolean;
  fontObjectCount?: number;
  embeddedFontCount?: number;
  imageObjectCount?: number;
  hasMediaBox?: boolean;
  hasTrimBox?: boolean;
  hasBleedBox?: boolean;
  hasCropBox?: boolean;
}

export interface PreflightRules {
  allowedMimeTypes: string[];
  maxFileSizeBytes: number;
  minWidthPx: number;
  minHeightPx: number;
  minDpi: number;
  targetPrintWidthIn?: number;
  targetPrintHeightIn?: number;
  allowedColorSpaces?: string[];
}
