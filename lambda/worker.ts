import { SQSEvent } from "aws-lambda";
import {
  CopyObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { PDFDocument } from "pdf-lib";
import { Readable } from "stream";
import type { ImageMetadata, PreflightCheckResult, PreflightRules } from "../lib/contracts";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: {
    removeUndefinedValues: true,
  },
});
const s3 = new S3Client({});
const DEFAULT_RULES: PreflightRules = {
  allowedMimeTypes: ["image/jpeg", "image/png", "image/tiff", "application/pdf"],
  maxFileSizeBytes: 26_214_400,
  minWidthPx: 2000,
  minHeightPx: 2000,
  minDpi: 300,
  targetPrintWidthIn: 8.5,
  targetPrintHeightIn: 11,
};

export const handler = async (event: SQSEvent): Promise<void> => {
  const tableName = process.env.JOBS_TABLE_NAME;
  const tempBucket = process.env.UPLOADS_TEMP_BUCKET;
  const approvedBucket = process.env.UPLOADS_APPROVED_BUCKET;
  const quarantineBucket = process.env.UPLOADS_QUARANTINE_BUCKET;
  const rules = parseRules(process.env.PREFLIGHT_RULES_JSON);
  const pdfDeepMode = process.env.PDF_DEEP_MODE === "true";

  if (!tableName || !tempBucket || !approvedBucket || !quarantineBucket) {
    throw new Error("Required environment variables are not configured");
  }

  for (const record of event.Records) {
    const { jobId } = JSON.parse(record.body) as { jobId: string };
    const key = { PK: `JOB#${jobId}`, SK: "METADATA" };

    await markStatus(tableName, key, "RUNNING");

    const job = await ddb.send(
      new GetCommand({
        TableName: tableName,
        Key: key,
      }),
    );

    if (!job.Item?.objectKey) {
      await markError(tableName, key, "objectKey is missing on job item");
      continue;
    }

    const objectKey = job.Item.objectKey as string;

    try {
      const objectHead = await s3.send(
        new HeadObjectCommand({
          Bucket: tempBucket,
          Key: objectKey,
        }),
      );

      const objectResult = await s3.send(
        new GetObjectCommand({
          Bucket: tempBucket,
          Key: objectKey,
        }),
      );
      const objectBytes = await bodyToBuffer(objectResult.Body);
      const mimeType = objectHead.ContentType ?? "application/octet-stream";
      const metadata = await extractFileMetadata(objectBytes, mimeType, pdfDeepMode);

      const checks = buildChecks({
        rules,
        metadata,
        mimeType,
        fileSizeBytes: objectHead.ContentLength ?? 0,
      });

      const passed = checks
        .filter((check) => check.severity === "FAIL")
        .every((check) => check.passed);
      const destinationBucket = passed ? approvedBucket : quarantineBucket;
      const destinationPrefix = passed ? "approved" : "quarantine";
      const destinationKey = `${destinationPrefix}/${objectKey.split("/").pop()}`;

      await s3.send(
        new CopyObjectCommand({
          Bucket: destinationBucket,
          Key: destinationKey,
          CopySource: `${tempBucket}/${objectKey}`,
        }),
      );

      await s3.send(
        new DeleteObjectCommand({
          Bucket: tempBucket,
          Key: objectKey,
        }),
      );

      const now = new Date().toISOString();
      await ddb.send(
        new UpdateCommand({
          TableName: tableName,
          Key: key,
          UpdateExpression:
            "SET #status = :status, updatedAt = :updatedAt, checks = :checks, metadata = :metadata, mimeType = :mimeType, bytes = :bytes, summary = :summary, destinationBucket = :destinationBucket, destinationKey = :destinationKey, GSI1PK = :gsiPk, GSI1SK = :gsiSk",
          ExpressionAttributeNames: {
            "#status": "status",
          },
          ExpressionAttributeValues: {
            ":status": passed ? "PASSED" : "FAILED",
            ":updatedAt": now,
            ":checks": checks,
            ":metadata": metadata,
            ":mimeType": mimeType,
            ":bytes": objectHead.ContentLength ?? null,
            ":summary": buildSummary(checks),
            ":destinationBucket": destinationBucket,
            ":destinationKey": destinationKey,
            ":gsiPk": `STATUS#${passed ? "PASSED" : "FAILED"}`,
            ":gsiSk": `${now}#${jobId}`,
          },
        }),
      );
    } catch (error) {
      await markError(tableName, key, (error as Error).message);
      throw error;
    }
  }
};

async function markStatus(
  tableName: string,
  key: { PK: string; SK: string },
  status: "RUNNING",
): Promise<void> {
  const now = new Date().toISOString();
  await ddb.send(
    new UpdateCommand({
      TableName: tableName,
      Key: key,
      UpdateExpression: "SET #status = :status, updatedAt = :updatedAt, GSI1PK = :gsiPk, GSI1SK = :gsiSk",
      ExpressionAttributeNames: {
        "#status": "status",
      },
      ExpressionAttributeValues: {
        ":status": status,
        ":updatedAt": now,
        ":gsiPk": `STATUS#${status}`,
        ":gsiSk": `${now}#${key.PK}`,
      },
    }),
  );
}

function parseRules(rawRules: string | undefined): PreflightRules {
  if (!rawRules) {
    return DEFAULT_RULES;
  }

  try {
    return {
      ...DEFAULT_RULES,
      ...(JSON.parse(rawRules) as Partial<PreflightRules>),
    };
  } catch {
    return DEFAULT_RULES;
  }
}

function buildChecks(input: {
  rules: PreflightRules;
  metadata: ImageMetadata;
  mimeType: string;
  fileSizeBytes: number;
}): PreflightCheckResult[] {
  const checks: PreflightCheckResult[] = [];
  const detectedMimeType = mimeTypeFromFormat(input.metadata.format);
  const effectiveMimeType = detectedMimeType ?? input.mimeType;

  checks.push({
    code: "ALLOWED_MIME_TYPE",
    severity: "FAIL",
    passed: input.rules.allowedMimeTypes.includes(effectiveMimeType),
    message: "File MIME type must be allowed",
    actual:
      detectedMimeType == null
        ? input.mimeType
        : `${input.mimeType} (uploaded), ${detectedMimeType} (detected)`,
    expected: input.rules.allowedMimeTypes.join(","),
  });

  if (detectedMimeType != null && detectedMimeType !== input.mimeType) {
    checks.push({
      code: "DECLARED_MIME_MATCHES_CONTENT",
      severity: "FAIL",
      passed: false,
      message: "Uploaded MIME type must match file content signature",
      actual: `${input.mimeType} (uploaded), ${detectedMimeType} (detected)`,
      expected: "uploaded MIME and detected MIME should match",
    });
  }

  checks.push({
    code: "MAX_FILE_SIZE",
    severity: "FAIL",
    passed: input.fileSizeBytes <= input.rules.maxFileSizeBytes,
    message: `File size must be <= ${input.rules.maxFileSizeBytes} bytes`,
    actual: input.fileSizeBytes,
    expected: input.rules.maxFileSizeBytes,
  });

  if (effectiveMimeType === "application/pdf") {
    checks.push({
      code: "PDF_PAGE_INFO",
      severity: "INFO",
      passed: input.metadata.pageCount != null && input.metadata.pageCount > 0,
      message: "PDF parser attempted to extract page count and first-page dimensions",
      actual:
        input.metadata.pageCount != null
          ? `${input.metadata.pageCount} pages`
          : "page count unavailable",
      expected: "page info extracted",
    });

    checks.push({
      code: "PDF_ENCRYPTION",
      severity: "WARN",
      passed: input.metadata.isEncrypted !== true,
      message: "Encrypted PDFs can limit downstream preflight checks",
      actual: input.metadata.isEncrypted ?? null,
      expected: false,
    });

    checks.push({
      code: "PDF_FORMS_PRESENT",
      severity: "INFO",
      passed: true,
      message: "Indicates whether AcroForm objects were detected",
      actual: input.metadata.hasAcroForm ?? false,
      expected: false,
    });

    checks.push({
      code: "PDF_IMAGES_DETECTED",
      severity: "INFO",
      passed: true,
      message: "Estimated count of embedded image XObjects",
      actual: input.metadata.imageObjectCount ?? 0,
      expected: ">= 0",
    });

    checks.push({
      code: "PDF_FONTS_DETECTED",
      severity: "INFO",
      passed: true,
      message: "Estimated count of font objects and embedded font streams",
      actual:
        `fonts=${input.metadata.fontObjectCount ?? 0}, embedded=${input.metadata.embeddedFontCount ?? 0}`,
      expected: "fonts/embedded-font metrics",
    });

    const targetPrintSize = getTargetPrintSize(input.rules);
    if (targetPrintSize) {
      const fitsTargetPrintSize = pdfMeetsTargetPrintSize(
        input.metadata.pageWidthIn,
        input.metadata.pageHeightIn,
        targetPrintSize.targetWidthIn,
        targetPrintSize.targetHeightIn,
      );
      checks.push({
        code: "PDF_PAGE_SIZE_FOR_TARGET_PRINT",
        severity: fitsTargetPrintSize == null ? "WARN" : "FAIL",
        passed: fitsTargetPrintSize ?? false,
        message:
          fitsTargetPrintSize == null
            ? "Page dimensions are missing; cannot evaluate target print-size fit"
            : `First-page dimensions must fit ${targetPrintSize.targetWidthIn}x${targetPrintSize.targetHeightIn}in (rotation allowed)`,
        actual:
          input.metadata.pageWidthIn == null || input.metadata.pageHeightIn == null
            ? null
            : `${input.metadata.pageWidthIn}x${input.metadata.pageHeightIn}in`,
        expected: `${targetPrintSize.targetWidthIn}x${targetPrintSize.targetHeightIn}in or rotated`,
      });
    }

    return checks;
  }

  checks.push({
    code: "MIN_WIDTH",
    severity: "FAIL",
    passed: (input.metadata.widthPx ?? 0) >= input.rules.minWidthPx,
    message: `Image width must be >= ${input.rules.minWidthPx}px`,
    actual: input.metadata.widthPx ?? null,
    expected: input.rules.minWidthPx,
  });

  checks.push({
    code: "MIN_HEIGHT",
    severity: "FAIL",
    passed: (input.metadata.heightPx ?? 0) >= input.rules.minHeightPx,
    message: `Image height must be >= ${input.rules.minHeightPx}px`,
    actual: input.metadata.heightPx ?? null,
    expected: input.rules.minHeightPx,
  });

  const targetPrintSize = getTargetPrintSize(input.rules);
  if (targetPrintSize) {
    const targetPrintDpi = getTargetPrintDpi(
      input.metadata.widthPx,
      input.metadata.heightPx,
      targetPrintSize.targetWidthIn,
      targetPrintSize.targetHeightIn,
    );
    checks.push({
      code: "MIN_DPI_AT_TARGET_PRINT_SIZE",
      severity: targetPrintDpi == null ? "WARN" : "FAIL",
      passed: targetPrintDpi == null ? false : targetPrintDpi >= input.rules.minDpi,
      message:
        targetPrintDpi == null
          ? "Pixel dimensions are missing; cannot estimate DPI at target print size"
          : `Estimated DPI at ${targetPrintSize.targetWidthIn}x${targetPrintSize.targetHeightIn}in must be >= ${input.rules.minDpi}`,
      actual: targetPrintDpi == null ? null : round2(targetPrintDpi),
      expected: input.rules.minDpi,
    });
  }

  const effectiveDpi = getEffectiveDpi(input.metadata);
  checks.push({
    code: "MIN_DPI",
    severity: effectiveDpi === null ? "WARN" : "FAIL",
    passed: effectiveDpi === null ? false : effectiveDpi >= input.rules.minDpi,
    message:
      effectiveDpi === null
        ? "DPI metadata is missing; minimum DPI check is advisory"
        : `Effective DPI must be >= ${input.rules.minDpi}`,
    actual: effectiveDpi,
    expected: input.rules.minDpi,
  });

  return checks;
}

function buildSummary(checks: PreflightCheckResult[]): {
  passCount: number;
  warnCount: number;
  failCount: number;
} {
  return {
    passCount: checks.filter((check) => check.passed).length,
    warnCount: checks.filter((check) => check.severity === "WARN" && !check.passed).length,
    failCount: checks.filter((check) => check.severity === "FAIL" && !check.passed).length,
  };
}

function getEffectiveDpi(metadata: ImageMetadata): number | null {
  if (metadata.dpiX == null || metadata.dpiY == null) {
    return null;
  }

  return Math.floor(Math.min(metadata.dpiX, metadata.dpiY));
}

function getTargetPrintSize(
  rules: PreflightRules,
): { targetWidthIn: number; targetHeightIn: number } | null {
  if (
    rules.targetPrintWidthIn == null ||
    rules.targetPrintHeightIn == null ||
    rules.targetPrintWidthIn <= 0 ||
    rules.targetPrintHeightIn <= 0
  ) {
    return null;
  }

  return {
    targetWidthIn: rules.targetPrintWidthIn,
    targetHeightIn: rules.targetPrintHeightIn,
  };
}

function getTargetPrintDpi(
  widthPx: number | undefined,
  heightPx: number | undefined,
  targetWidthIn: number,
  targetHeightIn: number,
): number | null {
  if (widthPx == null || heightPx == null || widthPx <= 0 || heightPx <= 0) {
    return null;
  }

  const naturalOrientationDpi = Math.min(widthPx / targetWidthIn, heightPx / targetHeightIn);
  const rotatedOrientationDpi = Math.min(widthPx / targetHeightIn, heightPx / targetWidthIn);
  return Math.max(naturalOrientationDpi, rotatedOrientationDpi);
}

function pdfMeetsTargetPrintSize(
  pageWidthIn: number | null | undefined,
  pageHeightIn: number | null | undefined,
  targetWidthIn: number,
  targetHeightIn: number,
): boolean | null {
  if (pageWidthIn == null || pageHeightIn == null || pageWidthIn <= 0 || pageHeightIn <= 0) {
    return null;
  }

  const naturalOrientationFits = pageWidthIn >= targetWidthIn && pageHeightIn >= targetHeightIn;
  const rotatedOrientationFits = pageWidthIn >= targetHeightIn && pageHeightIn >= targetWidthIn;
  return naturalOrientationFits || rotatedOrientationFits;
}

function mimeTypeFromFormat(format: string | undefined): string | null {
  if (!format) {
    return null;
  }

  switch (format.toLowerCase()) {
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "tiff":
      return "image/tiff";
    case "pdf":
      return "application/pdf";
    default:
      return null;
  }
}

async function extractFileMetadata(
  bytes: Buffer,
  mimeType: string,
  pdfDeepMode: boolean,
): Promise<ImageMetadata> {
  if (mimeType === "application/pdf" || isPdf(bytes)) {
    return pdfDeepMode ? parsePdfMetadataDeep(bytes) : parsePdfMetadataLight(bytes);
  }

  if (isTiff(bytes)) {
    return parseTiffMetadata(bytes);
  }

  if (isPng(bytes)) {
    return parsePngMetadata(bytes);
  }

  if (isJpeg(bytes)) {
    return parseJpegMetadata(bytes);
  }

  return {
    format: "unknown",
    widthPx: undefined,
    heightPx: undefined,
    dpiX: null,
    dpiY: null,
    colorSpace: null,
    hasIccProfile: false,
    bitDepth: null,
    hasAlpha: false,
    pageCount: undefined,
    pageWidthIn: null,
    pageHeightIn: null,
    pdfVersion: null,
    isEncrypted: null,
    hasAcroForm: false,
    hasJavaScript: false,
    fontObjectCount: 0,
    embeddedFontCount: 0,
    imageObjectCount: 0,
    hasMediaBox: false,
    hasTrimBox: false,
    hasBleedBox: false,
    hasCropBox: false,
  };
}

function parsePdfMetadataLight(bytes: Buffer): ImageMetadata {
  const text = bytes.toString("latin1");
  const versionMatch = text.match(/^%PDF-(\d+\.\d+)/m);
  const pageMatches = text.match(/\/Type\s*\/Page\b/g);
  const mediaBoxMatch = text.match(
    /\/MediaBox\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]/,
  );

  let pageWidthIn: number | null = null;
  let pageHeightIn: number | null = null;

  if (mediaBoxMatch) {
    const llx = Number(mediaBoxMatch[1]);
    const lly = Number(mediaBoxMatch[2]);
    const urx = Number(mediaBoxMatch[3]);
    const ury = Number(mediaBoxMatch[4]);
    if (Number.isFinite(llx) && Number.isFinite(lly) && Number.isFinite(urx) && Number.isFinite(ury)) {
      pageWidthIn = round2((urx - llx) / 72);
      pageHeightIn = round2((ury - lly) / 72);
    }
  }

  return {
    format: "pdf",
    widthPx: undefined,
    heightPx: undefined,
    dpiX: null,
    dpiY: null,
    orientation: null,
    colorSpace: null,
    hasIccProfile: false,
    bitDepth: null,
    hasAlpha: false,
    pageCount: pageMatches?.length ?? 0,
    pageWidthIn,
    pageHeightIn,
    pdfVersion: versionMatch?.[1] ?? null,
    isEncrypted: null,
    hasAcroForm: /\/AcroForm\b/.test(text),
    hasJavaScript: /\/JavaScript\b/.test(text),
    fontObjectCount: countRegex(text, /\/Type\s*\/Font\b/g),
    embeddedFontCount: countRegex(text, /\/FontFile(?:2|3)?\b/g),
    imageObjectCount: countRegex(text, /\/Subtype\s*\/Image\b/g),
    hasMediaBox: /\/MediaBox\b/.test(text),
    hasTrimBox: /\/TrimBox\b/.test(text),
    hasBleedBox: /\/BleedBox\b/.test(text),
    hasCropBox: /\/CropBox\b/.test(text),
  };
}

async function parsePdfMetadataDeep(bytes: Buffer): Promise<ImageMetadata> {
  const baseline = parsePdfMetadataLight(bytes);
  let isEncrypted = false;

  try {
    const pdfDoc = await PDFDocument.load(bytes, {
      updateMetadata: false,
    });
    const firstPage = pdfDoc.getPageCount() > 0 ? pdfDoc.getPage(0) : null;
    const firstPageSize = firstPage ? firstPage.getSize() : null;

    return {
      ...baseline,
      pageCount: pdfDoc.getPageCount(),
      pageWidthIn: firstPageSize ? round2(firstPageSize.width / 72) : baseline.pageWidthIn ?? null,
      pageHeightIn: firstPageSize ? round2(firstPageSize.height / 72) : baseline.pageHeightIn ?? null,
      isEncrypted,
      hasAcroForm: baseline.hasAcroForm ?? false,
      hasJavaScript: baseline.hasJavaScript ?? false,
    };
  } catch (error) {
    const message = (error as Error).message.toLowerCase();
    if (message.includes("encrypted")) {
      isEncrypted = true;
    }
    return {
      ...baseline,
      isEncrypted,
    };
  }
}

function parseTiffMetadata(bytes: Buffer): ImageMetadata {
  const littleEndian = bytes.toString("ascii", 0, 2) === "II";
  const bigEndian = bytes.toString("ascii", 0, 2) === "MM";
  if (!littleEndian && !bigEndian) {
    throw new Error("Invalid TIFF byte order marker");
  }

  const readU16 = (offset: number): number =>
    littleEndian ? bytes.readUInt16LE(offset) : bytes.readUInt16BE(offset);
  const readU32 = (offset: number): number =>
    littleEndian ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset);

  if (readU16(2) !== 42) {
    throw new Error("Invalid TIFF magic value");
  }

  const firstIfdOffset = readU32(4);
  if (firstIfdOffset + 2 > bytes.length) {
    throw new Error("Invalid TIFF IFD offset");
  }

  const entryCount = readU16(firstIfdOffset);
  const base = firstIfdOffset + 2;
  let widthPx: number | undefined;
  let heightPx: number | undefined;
  let orientation: number | null = null;
  let bitDepth: number | null = null;
  let colorSpace: string | null = null;
  let hasIccProfile = false;
  let hasAlpha = false;
  let xResolution: number | null = null;
  let yResolution: number | null = null;
  let resolutionUnit = 2;

  for (let i = 0; i < entryCount; i += 1) {
    const entryOffset = base + i * 12;
    if (entryOffset + 12 > bytes.length) {
      break;
    }

    const tag = readU16(entryOffset);
    const type = readU16(entryOffset + 2);
    const count = readU32(entryOffset + 4);
    const valueOffset = entryOffset + 8;

    const value = readTiffValue(bytes, littleEndian, type, count, valueOffset);
    if (value == null) {
      continue;
    }

    if (tag === 256) {
      widthPx = Number(value);
    }
    if (tag === 257) {
      heightPx = Number(value);
    }
    if (tag === 274) {
      orientation = Number(value);
    }
    if (tag === 258) {
      bitDepth = Number(value);
    }
    if (tag === 262) {
      const photometric = Number(value);
      if (photometric === 0 || photometric === 1) {
        colorSpace = "GRAY";
      }
      if (photometric === 2) {
        colorSpace = "RGB";
      }
      if (photometric === 5) {
        colorSpace = "CMYK";
      }
    }
    if (tag === 282) {
      xResolution = Number(value);
    }
    if (tag === 283) {
      yResolution = Number(value);
    }
    if (tag === 296) {
      resolutionUnit = Number(value);
    }
    if (tag === 338) {
      hasAlpha = Number(value) > 0;
    }
    if (tag === 34675) {
      hasIccProfile = true;
    }
  }

  const dpiX = normalizeTiffDpi(xResolution, resolutionUnit);
  const dpiY = normalizeTiffDpi(yResolution, resolutionUnit);

  return {
    format: "tiff",
    widthPx,
    heightPx,
    dpiX,
    dpiY,
    orientation,
    colorSpace,
    hasIccProfile,
    bitDepth,
    hasAlpha,
  };
}

function readTiffValue(
  bytes: Buffer,
  littleEndian: boolean,
  type: number,
  count: number,
  valueOffset: number,
): number | null {
  const readU16 = (offset: number): number =>
    littleEndian ? bytes.readUInt16LE(offset) : bytes.readUInt16BE(offset);
  const readU32 = (offset: number): number =>
    littleEndian ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset);

  if (count === 0) {
    return null;
  }

  if (type === 3 && count === 1) {
    return readU16(valueOffset);
  }

  if (type === 4 && count === 1) {
    return readU32(valueOffset);
  }

  const dataOffset = readU32(valueOffset);
  if (dataOffset >= bytes.length) {
    return null;
  }

  if (type === 3) {
    return readU16(dataOffset);
  }

  if (type === 4) {
    return readU32(dataOffset);
  }

  if (type === 5) {
    if (dataOffset + 8 > bytes.length) {
      return null;
    }
    const numerator = readU32(dataOffset);
    const denominator = readU32(dataOffset + 4);
    if (denominator === 0) {
      return null;
    }
    return numerator / denominator;
  }

  return null;
}

function normalizeTiffDpi(value: number | null, resolutionUnit: number): number | null {
  if (value == null || !Number.isFinite(value)) {
    return null;
  }
  if (resolutionUnit === 3) {
    return Math.round(value * 2.54);
  }
  if (resolutionUnit === 1) {
    return null;
  }
  return Math.round(value);
}

function parsePngMetadata(bytes: Buffer): ImageMetadata {
  let offset = 8;
  let widthPx: number | undefined;
  let heightPx: number | undefined;
  let bitDepth: number | null = null;
  let hasAlpha = false;
  let hasIccProfile = false;
  let dpiX: number | null = null;
  let dpiY: number | null = null;
  let colorSpace: string | null = null;

  while (offset + 8 <= bytes.length) {
    const chunkLength = bytes.readUInt32BE(offset);
    const chunkType = bytes.toString("ascii", offset + 4, offset + 8);
    const chunkDataStart = offset + 8;
    const chunkDataEnd = chunkDataStart + chunkLength;

    if (chunkDataEnd + 4 > bytes.length) {
      break;
    }

    if (chunkType === "IHDR" && chunkLength >= 13) {
      widthPx = bytes.readUInt32BE(chunkDataStart);
      heightPx = bytes.readUInt32BE(chunkDataStart + 4);
      bitDepth = bytes.readUInt8(chunkDataStart + 8);
      const colorType = bytes.readUInt8(chunkDataStart + 9);
      hasAlpha = colorType === 4 || colorType === 6;
      if (colorType === 0 || colorType === 4) {
        colorSpace = "GRAY";
      }
      if (colorType === 2 || colorType === 3 || colorType === 6) {
        colorSpace = "RGB";
      }
    }

    if (chunkType === "pHYs" && chunkLength >= 9) {
      const pixelsPerUnitX = bytes.readUInt32BE(chunkDataStart);
      const pixelsPerUnitY = bytes.readUInt32BE(chunkDataStart + 4);
      const unitSpecifier = bytes.readUInt8(chunkDataStart + 8);
      if (unitSpecifier === 1) {
        dpiX = Math.round(pixelsPerUnitX * 0.0254);
        dpiY = Math.round(pixelsPerUnitY * 0.0254);
      }
    }

    if (chunkType === "iCCP") {
      hasIccProfile = true;
    }

    if (chunkType === "sRGB") {
      colorSpace = "sRGB";
    }

    if (chunkType === "IEND") {
      break;
    }

    offset = chunkDataEnd + 4;
  }

  return {
    format: "png",
    widthPx,
    heightPx,
    dpiX,
    dpiY,
    colorSpace,
    hasIccProfile,
    bitDepth,
    hasAlpha,
  };
}

function parseJpegMetadata(bytes: Buffer): ImageMetadata {
  let offset = 2;
  let widthPx: number | undefined;
  let heightPx: number | undefined;
  let bitDepth: number | null = null;
  let dpiX: number | null = null;
  let dpiY: number | null = null;
  let hasIccProfile = false;
  let colorSpace: string | null = "RGB";

  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    while (offset < bytes.length && bytes[offset] === 0xff) {
      offset += 1;
    }

    if (offset >= bytes.length) {
      break;
    }

    const marker = bytes[offset];
    offset += 1;

    if (marker === 0xd9 || marker === 0xda) {
      break;
    }

    if (offset + 2 > bytes.length) {
      break;
    }

    const segmentLength = bytes.readUInt16BE(offset);
    const segmentStart = offset + 2;
    const segmentEnd = segmentStart + segmentLength - 2;
    if (segmentLength < 2 || segmentEnd > bytes.length) {
      break;
    }

    if (marker === 0xe0 && segmentLength >= 16) {
      const identifier = bytes.toString("ascii", segmentStart, segmentStart + 5);
      if (identifier === "JFIF\0") {
        const units = bytes.readUInt8(segmentStart + 7);
        const densityX = bytes.readUInt16BE(segmentStart + 8);
        const densityY = bytes.readUInt16BE(segmentStart + 10);

        if (units === 1) {
          dpiX = densityX;
          dpiY = densityY;
        }
        if (units === 2) {
          dpiX = Math.round(densityX * 2.54);
          dpiY = Math.round(densityY * 2.54);
        }
      }
    }

    if (marker === 0xe1 && (dpiX == null || dpiY == null)) {
      const exifDpi = parseJpegExifDpi(bytes.subarray(segmentStart, segmentEnd));
      if (exifDpi) {
        dpiX ??= exifDpi.dpiX;
        dpiY ??= exifDpi.dpiY;
      }
    }

    if (marker === 0xe2 && segmentLength >= 14) {
      const identifier = bytes.toString("ascii", segmentStart, segmentStart + 12);
      if (identifier.startsWith("ICC_PROFILE")) {
        hasIccProfile = true;
      }
    }

    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      bitDepth = bytes.readUInt8(segmentStart);
      heightPx = bytes.readUInt16BE(segmentStart + 1);
      widthPx = bytes.readUInt16BE(segmentStart + 3);
      const componentCount = bytes.readUInt8(segmentStart + 5);
      if (componentCount === 1) {
        colorSpace = "GRAY";
      }
      if (componentCount === 4) {
        colorSpace = "CMYK";
      }
    }

    offset = segmentEnd;
  }

  return {
    format: "jpeg",
    widthPx,
    heightPx,
    dpiX,
    dpiY,
    colorSpace,
    hasIccProfile,
    bitDepth,
    hasAlpha: false,
  };
}

function parseJpegExifDpi(
  segmentData: Buffer,
): { dpiX: number | null; dpiY: number | null } | null {
  if (segmentData.length < 14 || segmentData.toString("ascii", 0, 6) !== "Exif\0\0") {
    return null;
  }

  const tiffStart = 6;
  const byteOrderMarker = segmentData.toString("ascii", tiffStart, tiffStart + 2);
  const littleEndian = byteOrderMarker === "II";
  const bigEndian = byteOrderMarker === "MM";
  if (!littleEndian && !bigEndian) {
    return null;
  }

  const readU16 = (offset: number): number | null => {
    if (offset + 2 > segmentData.length) {
      return null;
    }
    return littleEndian ? segmentData.readUInt16LE(offset) : segmentData.readUInt16BE(offset);
  };

  const readU32 = (offset: number): number | null => {
    if (offset + 4 > segmentData.length) {
      return null;
    }
    return littleEndian ? segmentData.readUInt32LE(offset) : segmentData.readUInt32BE(offset);
  };

  const readRational = (offset: number): number | null => {
    const numerator = readU32(offset);
    const denominator = readU32(offset + 4);
    if (numerator == null || denominator == null || denominator === 0) {
      return null;
    }
    return numerator / denominator;
  };

  if (readU16(tiffStart + 2) !== 42) {
    return null;
  }

  const ifd0Offset = readU32(tiffStart + 4);
  if (ifd0Offset == null) {
    return null;
  }

  const ifdStart = tiffStart + ifd0Offset;
  const entryCount = readU16(ifdStart);
  if (entryCount == null) {
    return null;
  }

  let xResolution: number | null = null;
  let yResolution: number | null = null;
  let resolutionUnit = 2;

  for (let i = 0; i < entryCount; i += 1) {
    const entryOffset = ifdStart + 2 + i * 12;
    if (entryOffset + 12 > segmentData.length) {
      break;
    }

    const tag = readU16(entryOffset);
    const type = readU16(entryOffset + 2);
    const count = readU32(entryOffset + 4);
    const valueOffset = entryOffset + 8;
    if (tag == null || type == null || count == null) {
      continue;
    }

    if (tag === 0x0128 && type === 3 && count >= 1) {
      const unit = readU16(valueOffset);
      if (unit != null) {
        resolutionUnit = unit;
      }
      continue;
    }

    if ((tag === 0x011a || tag === 0x011b) && type === 5 && count >= 1) {
      const pointer = readU32(valueOffset);
      if (pointer == null) {
        continue;
      }

      const rationalOffset = tiffStart + pointer;
      const rationalValue = readRational(rationalOffset);
      if (rationalValue == null) {
        continue;
      }

      if (tag === 0x011a) {
        xResolution = rationalValue;
      }

      if (tag === 0x011b) {
        yResolution = rationalValue;
      }
    }
  }

  const dpiX = normalizeTiffDpi(xResolution, resolutionUnit);
  const dpiY = normalizeTiffDpi(yResolution, resolutionUnit);
  if (dpiX == null && dpiY == null) {
    return null;
  }

  return {
    dpiX,
    dpiY,
  };
}

function isPng(bytes: Buffer): boolean {
  const pngSignature = "89504e470d0a1a0a";
  return bytes.length >= 8 && bytes.subarray(0, 8).toString("hex") === pngSignature;
}

function isJpeg(bytes: Buffer): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function isTiff(bytes: Buffer): boolean {
  if (bytes.length < 4) {
    return false;
  }
  const header = bytes.toString("ascii", 0, 4);
  return header === "II*\0" || header === "MM\0*";
}

function isPdf(bytes: Buffer): boolean {
  return bytes.length >= 5 && bytes.toString("ascii", 0, 5) === "%PDF-";
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function countRegex(input: string, regex: RegExp): number {
  const flags = regex.flags.includes("g") ? regex.flags : `${regex.flags}g`;
  const scoped = new RegExp(regex.source, flags);
  return [...input.matchAll(scoped)].length;
}

async function bodyToBuffer(body: unknown): Promise<Buffer> {
  if (!body) {
    throw new Error("S3 object body is empty");
  }

  const sdkBody = body as { transformToByteArray?: () => Promise<Uint8Array> };
  if (typeof sdkBody.transformToByteArray === "function") {
    return Buffer.from(await sdkBody.transformToByteArray());
  }

  if (body instanceof Readable) {
    const chunks: Buffer[] = [];
    for await (const chunk of body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  throw new Error("Unsupported S3 body type");
}

async function markError(
  tableName: string,
  key: { PK: string; SK: string },
  message: string,
): Promise<void> {
  const now = new Date().toISOString();
  await ddb.send(
    new UpdateCommand({
      TableName: tableName,
      Key: key,
      UpdateExpression:
        "SET #status = :status, updatedAt = :updatedAt, errorMessage = :errorMessage, GSI1PK = :gsiPk, GSI1SK = :gsiSk",
      ExpressionAttributeNames: {
        "#status": "status",
      },
      ExpressionAttributeValues: {
        ":status": "ERROR",
        ":updatedAt": now,
        ":errorMessage": message,
        ":gsiPk": "STATUS#ERROR",
        ":gsiSk": `${now}#${key.PK}`,
      },
    }),
  );
}
