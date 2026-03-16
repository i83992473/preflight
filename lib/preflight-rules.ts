import type { PreflightRules, RuleSeverity } from "./contracts";

const DEFAULT_ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/tiff", "application/pdf"];
const DEFAULT_ALLOWED_COLOR_SPACES = ["RGB", "sRGB", "CMYK", "GRAY"];

export const DEFAULT_PREFLIGHT_RULES: PreflightRules = {
  skipPreflight: false,
  allowedMimeTypes: DEFAULT_ALLOWED_MIME_TYPES,
  minFileSizeBytes: 1024,
  maxFileSizeBytes: 104_857_600,
  fileSizeSeverity: "FAIL",
  minWidthPx: 200,
  maxWidthPx: null,
  widthSeverity: "FAIL",
  minHeightPx: 200,
  maxHeightPx: null,
  heightSeverity: "FAIL",
  minDpi: 72,
  maxDpi: null,
  dpiSeverity: "WARN",
  minTargetPrintDpi: 150,
  maxTargetPrintDpi: null,
  targetPrintDpiSeverity: "WARN",
  targetPrintWidthIn: 8.5,
  targetPrintHeightIn: 11,
  pdfPageSizeSeverity: "WARN",
  mimeTypeSeverity: "FAIL",
  mimeMatchSeverity: "WARN",
  allowedColorSpaces: DEFAULT_ALLOWED_COLOR_SPACES,
  colorSpaceSeverity: "WARN",
};

export function normalizePreflightRules(rawRules: unknown): PreflightRules {
  const input = isRecord(rawRules) ? rawRules : {};

  const legacyMinDpi = asNumber(input.minDpi);
  const legacyMaxFileSizeBytes = asNumber(input.maxFileSizeBytes);

  const normalizedRules: PreflightRules = {
    skipPreflight: input.skipPreflight === true,
    allowedMimeTypes: normalizeMimeTypes(input.allowedMimeTypes),
    minFileSizeBytes: nonNegative(asNumber(input.minFileSizeBytes), DEFAULT_PREFLIGHT_RULES.minFileSizeBytes),
    maxFileSizeBytes: nullableNonNegative(
      firstNumber(
        input.maxFileSizeBytes,
        legacyMaxFileSizeBytes,
        DEFAULT_PREFLIGHT_RULES.maxFileSizeBytes,
      ),
    ),
    fileSizeSeverity: normalizeSeverity(input.fileSizeSeverity, DEFAULT_PREFLIGHT_RULES.fileSizeSeverity),
    minWidthPx: nonNegative(asNumber(input.minWidthPx), DEFAULT_PREFLIGHT_RULES.minWidthPx),
    maxWidthPx: nullableNonNegative(asNumber(input.maxWidthPx)),
    widthSeverity: normalizeSeverity(input.widthSeverity, DEFAULT_PREFLIGHT_RULES.widthSeverity),
    minHeightPx: nonNegative(asNumber(input.minHeightPx), DEFAULT_PREFLIGHT_RULES.minHeightPx),
    maxHeightPx: nullableNonNegative(asNumber(input.maxHeightPx)),
    heightSeverity: normalizeSeverity(input.heightSeverity, DEFAULT_PREFLIGHT_RULES.heightSeverity),
    minDpi: nonNegative(firstNumber(input.minDpi, legacyMinDpi, DEFAULT_PREFLIGHT_RULES.minDpi),
      DEFAULT_PREFLIGHT_RULES.minDpi),
    maxDpi: nullableNonNegative(asNumber(input.maxDpi)),
    dpiSeverity: normalizeSeverity(input.dpiSeverity, DEFAULT_PREFLIGHT_RULES.dpiSeverity),
    minTargetPrintDpi: nonNegative(
      firstNumber(input.minTargetPrintDpi, legacyMinDpi, DEFAULT_PREFLIGHT_RULES.minTargetPrintDpi),
      DEFAULT_PREFLIGHT_RULES.minTargetPrintDpi,
    ),
    maxTargetPrintDpi: nullableNonNegative(
      firstNumber(input.maxTargetPrintDpi, asNumber(input.maxDpi), null),
    ),
    targetPrintDpiSeverity: normalizeSeverity(
      input.targetPrintDpiSeverity,
      DEFAULT_PREFLIGHT_RULES.targetPrintDpiSeverity,
    ),
    targetPrintWidthIn: nullablePositive(
      firstNumber(input.targetPrintWidthIn, DEFAULT_PREFLIGHT_RULES.targetPrintWidthIn),
    ),
    targetPrintHeightIn: nullablePositive(
      firstNumber(input.targetPrintHeightIn, DEFAULT_PREFLIGHT_RULES.targetPrintHeightIn),
    ),
    pdfPageSizeSeverity: normalizeSeverity(
      input.pdfPageSizeSeverity,
      DEFAULT_PREFLIGHT_RULES.pdfPageSizeSeverity,
    ),
    mimeTypeSeverity: normalizeSeverity(input.mimeTypeSeverity, DEFAULT_PREFLIGHT_RULES.mimeTypeSeverity),
    mimeMatchSeverity: normalizeSeverity(input.mimeMatchSeverity, DEFAULT_PREFLIGHT_RULES.mimeMatchSeverity),
    allowedColorSpaces: normalizeColorSpaces(input.allowedColorSpaces),
    colorSpaceSeverity: normalizeSeverity(input.colorSpaceSeverity, DEFAULT_PREFLIGHT_RULES.colorSpaceSeverity),
  };

  if (
    normalizedRules.maxFileSizeBytes != null &&
    normalizedRules.maxFileSizeBytes < normalizedRules.minFileSizeBytes
  ) {
    normalizedRules.maxFileSizeBytes = normalizedRules.minFileSizeBytes;
  }

  if (normalizedRules.maxWidthPx != null && normalizedRules.maxWidthPx < normalizedRules.minWidthPx) {
    normalizedRules.maxWidthPx = normalizedRules.minWidthPx;
  }

  if (normalizedRules.maxHeightPx != null && normalizedRules.maxHeightPx < normalizedRules.minHeightPx) {
    normalizedRules.maxHeightPx = normalizedRules.minHeightPx;
  }

  if (normalizedRules.maxDpi != null && normalizedRules.maxDpi < normalizedRules.minDpi) {
    normalizedRules.maxDpi = normalizedRules.minDpi;
  }

  if (
    normalizedRules.maxTargetPrintDpi != null &&
    normalizedRules.maxTargetPrintDpi < normalizedRules.minTargetPrintDpi
  ) {
    normalizedRules.maxTargetPrintDpi = normalizedRules.minTargetPrintDpi;
  }

  return normalizedRules;
}

function normalizeMimeTypes(rawValue: unknown): string[] {
  if (!Array.isArray(rawValue)) {
    return DEFAULT_ALLOWED_MIME_TYPES;
  }

  const mimeTypes = rawValue
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean);
  return mimeTypes.length > 0 ? mimeTypes : DEFAULT_ALLOWED_MIME_TYPES;
}

function normalizeColorSpaces(rawValue: unknown): string[] {
  if (!Array.isArray(rawValue)) {
    return DEFAULT_ALLOWED_COLOR_SPACES;
  }

  const colorSpaces = rawValue
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean);
  return colorSpaces.length > 0 ? colorSpaces : DEFAULT_ALLOWED_COLOR_SPACES;
}

function normalizeSeverity(rawSeverity: unknown, fallback: RuleSeverity): RuleSeverity {
  return rawSeverity === "WARN" || rawSeverity === "FAIL" ? rawSeverity : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstNumber(...values: Array<unknown>): number | null {
  for (const value of values) {
    const parsed = asNumber(value);
    if (parsed != null) {
      return parsed;
    }
  }

  return null;
}

function asNumber(value: unknown): number | null {
  if (value == null || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function nonNegative(value: number | null, fallback: number): number {
  if (value == null) {
    return fallback;
  }

  return Math.max(0, value);
}

function nullableNonNegative(value: number | null): number | null {
  if (value == null) {
    return null;
  }

  return Math.max(0, value);
}

function nullablePositive(value: number | null): number | null {
  if (value == null) {
    return null;
  }

  return value > 0 ? value : null;
}
