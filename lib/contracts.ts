export type JobStatus = "PENDING" | "RUNNING" | "PASSED" | "FAILED" | "ERROR";
export type CheckSeverity = "FAIL" | "WARN" | "INFO";
export type RuleSeverity = "FAIL" | "WARN";

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
  minFileSizeBytes: number;
  maxFileSizeBytes: number | null;
  fileSizeSeverity: RuleSeverity;
  minWidthPx: number;
  maxWidthPx: number | null;
  widthSeverity: RuleSeverity;
  minHeightPx: number;
  maxHeightPx: number | null;
  heightSeverity: RuleSeverity;
  minDpi: number;
  maxDpi: number | null;
  dpiSeverity: RuleSeverity;
  minTargetPrintDpi: number;
  maxTargetPrintDpi: number | null;
  targetPrintDpiSeverity: RuleSeverity;
  targetPrintWidthIn: number | null;
  targetPrintHeightIn: number | null;
  pdfPageSizeSeverity: RuleSeverity;
  mimeTypeSeverity: RuleSeverity;
  mimeMatchSeverity: RuleSeverity;
  allowedColorSpaces?: string[];
}
