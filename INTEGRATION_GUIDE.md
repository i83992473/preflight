# Preflight API Integration Guide

This document describes how to integrate the Preflight file-validation service into a React customer portal application. The Preflight API validates uploaded files (images and PDFs) against configurable rules for file type, dimensions, DPI, color space, file size, and print-readiness.

---

## API Base URL & Authentication

- **Base URL**: `https://gqeiznlqyb.execute-api.us-east-1.amazonaws.com`
- **Authentication**: All requests require an `x-api-key` header.

```typescript
const API_BASE_URL = "https://gqeiznlqyb.execute-api.us-east-1.amazonaws.com";
const headers = {
  "x-api-key": "<your-api-key>",
  "content-type": "application/json",
};
```

---

## Core Concepts

### Tenant & Product Rules Hierarchy

Rules are scoped per tenant, with optional product-level overrides:

1. **Product rules** (`rules/{tenantId}/{productId}.json`) — highest priority
2. **Tenant default rules** (`rules/{tenantId}/default.json`) — fallback
3. **System defaults** — used when no tenant/product rules exist

Both `tenantId` and `productId` must be alphanumeric (with dashes/underscores): `/^[a-zA-Z0-9_-]+$/`

### Rule Severities

Each rule category has a severity level:
- `"FAIL"` — causes the file to fail preflight (moved to quarantine)
- `"WARN"` — included in results but does not cause failure (file still approved)

### Skip Preflight

When `skipPreflight: true` in the rules, all checks are bypassed and the file is auto-approved. The integration can detect this client-side and skip the upload entirely (see Optimized Upload Flow below).

---

## TypeScript Types

```typescript
type RuleSeverity = "FAIL" | "WARN";

type PreflightRules = {
  skipPreflight: boolean;
  allowedMimeTypes: string[];        // e.g. ["image/jpeg", "image/png", "image/tiff", "application/pdf"]
  minFileSizeBytes: number;
  maxFileSizeBytes: number | null;    // null = no max
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
  targetPrintWidthIn: number | null;  // null disables target-print checks
  targetPrintHeightIn: number | null;
  pdfPageSizeSeverity: RuleSeverity;
  mimeTypeSeverity: RuleSeverity;
  mimeMatchSeverity: RuleSeverity;
  allowedColorSpaces: string[];       // e.g. ["RGB", "sRGB", "CMYK", "GRAY"]
  colorSpaceSeverity: RuleSeverity;
};

type PreflightCheck = {
  code: string;
  severity: "FAIL" | "WARN" | "INFO";
  passed: boolean;
  message: string;
  actual?: string | number | boolean | null;
  expected?: string | number | boolean | null;
};

type JobStatus = "PENDING" | "RUNNING" | "PASSED" | "FAILED" | "ERROR";

type JobResponse = {
  status: JobStatus;
  checks?: PreflightCheck[];
  metadata?: Record<string, unknown>;
  errorMessage?: string;
};
```

---

## API Endpoints

### Rules Management

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/preflight/rules/defaults` | Returns the system reset/default rules |
| `GET` | `/preflight/rules/{tenantId}` | Get tenant default rules (falls back to system defaults) |
| `GET` | `/preflight/rules/{tenantId}/{productId}` | Get product rules (falls back to tenant default, then system defaults) |
| `PUT` | `/preflight/rules/{tenantId}` | Save tenant default rules |
| `PUT` | `/preflight/rules/{tenantId}/{productId}` | Save product-level rules |
| `DELETE` | `/preflight/rules/{tenantId}` | Delete tenant default rules |
| `DELETE` | `/preflight/rules/{tenantId}/{productId}` | Delete product-level rules |

**GET response:**
```json
{
  "tenantId": "client123",
  "productId": null,
  "rules": { ... },
  "source": "rules/client123/default.json"
}
```

**PUT request body:**
```json
{
  "rules": {
    "skipPreflight": false,
    "allowedMimeTypes": ["image/jpeg", "image/png"],
    "minFileSizeBytes": 1024,
    ...
  }
}
```

**PUT response:** Same shape as GET (returns the normalized/saved rules).

**DELETE response:**
```json
{
  "tenantId": "client123",
  "productId": null,
  "deleted": true
}
```

### File Upload & Preflight

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/uploads/presign` | Get a presigned S3 upload URL |
| `POST` | `/preflight/jobs` | Create a preflight job after upload |
| `GET` | `/preflight/jobs/{jobId}` | Poll for job status and results |

**Presign request:**
```json
{
  "fileName": "photo.jpg",
  "mimeType": "image/jpeg",
  "bytes": 2048576
}
```

**Presign response:**
```json
{
  "uploadUrl": "https://s3.amazonaws.com/...",
  "objectKey": "incoming/2026-03-24/uuid.jpg",
  "expiresInSeconds": 900,
  "requiredHeaders": { "Content-Type": "image/jpeg" }
}
```

**Create job request:**
```json
{
  "objectKey": "incoming/2026-03-24/uuid.jpg",
  "originalFileName": "photo.jpg",
  "tenantId": "client123",
  "productId": "product-abc"
}
```

**Create job response (HTTP 202):**
```json
{
  "jobId": "uuid",
  "status": "PENDING"
}
```

**Job poll response (when complete):**
```json
{
  "status": "PASSED",
  "checks": [
    { "code": "ALLOWED_MIME_TYPE", "severity": "WARN", "passed": true, "message": "..." },
    { "code": "FILE_SIZE_RANGE", "severity": "WARN", "passed": true, "message": "..." },
    ...
  ],
  "metadata": {
    "format": "jpeg",
    "widthPx": 3000,
    "heightPx": 2000,
    "dpiX": 300,
    "dpiY": 300,
    "colorSpace": "sRGB",
    ...
  }
}
```

---

## Preflight Check Codes

The worker runs these checks against the uploaded file:

| Code | Description | Severity Source |
|------|-------------|----------------|
| `PREFLIGHT_SKIPPED` | Preflight was skipped (skipPreflight=true) | INFO |
| `ALLOWED_MIME_TYPE` | File type is in the allowed MIME types list | `mimeTypeSeverity` |
| `DECLARED_MIME_MATCHES_CONTENT` | Uploaded MIME type matches detected content | `mimeMatchSeverity` |
| `ALLOWED_COLOR_SPACE` | Image color space is in the allowed list | `colorSpaceSeverity` |
| `FILE_SIZE_RANGE` | File size is within min/max bounds | `fileSizeSeverity` |
| `WIDTH_RANGE` | Image width is within min/max bounds | `widthSeverity` |
| `HEIGHT_RANGE` | Image height is within min/max bounds | `heightSeverity` |
| `DPI_METADATA_RANGE` | Embedded DPI metadata is within bounds | `dpiSeverity` |
| `TARGET_PRINT_DPI_RANGE` | Effective print DPI meets requirements | `targetPrintDpiSeverity` |
| `PDF_PAGE_SIZE_FOR_TARGET_PRINT` | PDF page size fits target print dimensions | `pdfPageSizeSeverity` |
| `PDF_PAGE_INFO` | PDF page count and dimensions (informational) | INFO |
| `PDF_ENCRYPTION` | Whether the PDF is encrypted | INFO |
| `PDF_FORMS_PRESENT` | Whether the PDF contains form fields | INFO |
| `PDF_IMAGES_DETECTED` | Count of embedded image objects in PDF | INFO |
| `PDF_FONTS_DETECTED` | Count of font and embedded font objects in PDF | INFO |

---

## Optimized Upload Flow (Recommended)

This flow avoids unnecessary S3 uploads by checking rules client-side first:

```typescript
async function runPreflight(
  file: File,
  tenantId: string,
  productId?: string,
): Promise<JobResponse> {
  // Step 1: Fetch tenant/product rules
  const rulesPath = productId
    ? `/preflight/rules/${encodeURIComponent(tenantId)}/${encodeURIComponent(productId)}`
    : `/preflight/rules/${encodeURIComponent(tenantId)}`;

  const rulesResponse = await fetch(`${API_BASE_URL}${rulesPath}`, { headers });
  const { rules } = (await rulesResponse.json()) as { rules: PreflightRules };

  // Step 2: If skipPreflight is on, return immediately — no upload needed
  if (rules.skipPreflight) {
    return {
      status: "PASSED",
      checks: [{
        code: "PREFLIGHT_SKIPPED",
        severity: "INFO",
        passed: true,
        message: "Preflight checks were skipped per rules configuration",
      }],
    };
  }

  // Step 3: Check MIME type client-side before uploading
  if (
    rules.allowedMimeTypes.length > 0 &&
    !rules.allowedMimeTypes.includes(file.type)
  ) {
    throw new Error(
      `File type "${file.type}" is not allowed. Allowed: ${rules.allowedMimeTypes.join(", ")}`,
    );
  }

  // Step 4: Get presigned upload URL
  const presignResponse = await fetch(`${API_BASE_URL}/uploads/presign`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      fileName: file.name,
      mimeType: file.type,
      bytes: file.size,
    }),
  });
  const presign = await presignResponse.json();

  // Step 5: Upload file directly to S3
  await fetch(presign.uploadUrl, {
    method: "PUT",
    headers: presign.requiredHeaders ?? { "Content-Type": file.type },
    body: file,
  });

  // Step 6: Create preflight job
  const jobBody: Record<string, unknown> = {
    objectKey: presign.objectKey,
    originalFileName: file.name,
    tenantId,
  };
  if (productId) {
    jobBody.productId = productId;
  }

  const createResponse = await fetch(`${API_BASE_URL}/preflight/jobs`, {
    method: "POST",
    headers,
    body: JSON.stringify(jobBody),
  });
  const { jobId } = await createResponse.json();

  // Step 7: Poll for results
  for (let i = 0; i < 60; i++) {
    const pollResponse = await fetch(`${API_BASE_URL}/preflight/jobs/${jobId}`, { headers });
    const job = (await pollResponse.json()) as JobResponse;

    if (["PASSED", "FAILED", "ERROR"].includes(job.status)) {
      return job;
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  throw new Error("Preflight job timed out");
}
```

### Flow Diagram

```
User selects file
       │
       ▼
Fetch tenant/product rules ──► skipPreflight=true? ──► Return PASSED immediately
       │                                                (no upload, no job)
       │ no
       ▼
Check MIME type client-side ──► Not allowed? ──► Show error immediately
       │                                         (no upload, no job)
       │ allowed
       ▼
POST /uploads/presign ──► PUT file to S3 ──► POST /preflight/jobs ──► Poll GET /preflight/jobs/{jobId}
                                                                              │
                                                                              ▼
                                                                    PASSED / FAILED / ERROR
```

---

## Rules Management UI Integration

To build a rules management interface:

```typescript
// Load rules for a tenant (or tenant+product)
async function loadRules(tenantId: string, productId?: string): Promise<PreflightRules> {
  const path = productId
    ? `/preflight/rules/${encodeURIComponent(tenantId)}/${encodeURIComponent(productId)}`
    : `/preflight/rules/${encodeURIComponent(tenantId)}`;
  const response = await fetch(`${API_BASE_URL}${path}`, { headers });
  const data = await response.json();
  return data.rules;
}

// Save rules
async function saveRules(tenantId: string, rules: PreflightRules, productId?: string): Promise<PreflightRules> {
  const path = productId
    ? `/preflight/rules/${encodeURIComponent(tenantId)}/${encodeURIComponent(productId)}`
    : `/preflight/rules/${encodeURIComponent(tenantId)}`;
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ rules }),
  });
  const data = await response.json();
  return data.rules;
}

// Delete rules (reverts tenant/product to the next level in the fallback chain)
async function deleteRules(tenantId: string, productId?: string): Promise<void> {
  const path = productId
    ? `/preflight/rules/${encodeURIComponent(tenantId)}/${encodeURIComponent(productId)}`
    : `/preflight/rules/${encodeURIComponent(tenantId)}`;
  await fetch(`${API_BASE_URL}${path}`, {
    method: "DELETE",
    headers,
  });
}

// Load system defaults (for a "Reset to Defaults" button)
async function loadDefaults(): Promise<PreflightRules> {
  const response = await fetch(`${API_BASE_URL}/preflight/rules/defaults`, { headers });
  const data = await response.json();
  return data.rules;
}
```

---

## System Default Rules

When no tenant or product rules are saved, the system defaults are used:

| Field | Value |
|-------|-------|
| skipPreflight | `true` (auto-approve) |
| allowedMimeTypes | JPEG, PNG, TIFF, PDF |
| minFileSizeBytes | 1,024 (1 KB) |
| maxFileSizeBytes | 104,857,600 (100 MB) |
| fileSizeSeverity | WARN |
| minWidthPx / maxWidthPx | 20 / null |
| widthSeverity | WARN |
| minHeightPx / maxHeightPx | 20 / null |
| heightSeverity | WARN |
| minDpi / maxDpi | 72 / null |
| dpiSeverity | WARN |
| minTargetPrintDpi / maxTargetPrintDpi | 72 / null |
| targetPrintDpiSeverity | WARN |
| targetPrintWidthIn / targetPrintHeightIn | 4.13 / 5.83 |
| pdfPageSizeSeverity | WARN |
| mimeTypeSeverity | WARN |
| mimeMatchSeverity | WARN |
| allowedColorSpaces | RGB, sRGB, CMYK, GRAY |
| colorSpaceSeverity | WARN |

The "Reset" defaults are identical except `skipPreflight: false`.

---

## Error Handling

All API errors return JSON with a `message` field:

```json
{ "message": "tenantId must be alphanumeric (with dashes/underscores)" }
```

Common HTTP status codes:
- `400` — Bad request (invalid input, missing fields, disallowed MIME type)
- `403` — Authentication failed (invalid or missing API key)
- `500` — Server configuration error

---

## File Metadata Returned

After preflight completes, the job response includes extracted metadata:

**Images (JPEG, PNG, TIFF):**
- `format`, `widthPx`, `heightPx`, `dpiX`, `dpiY`
- `colorSpace`, `hasIccProfile`, `bitDepth`, `hasAlpha`, `orientation`

**PDFs:**
- `format`, `pageCount`, `pageWidthIn`, `pageHeightIn`
- `pdfVersion`, `isEncrypted`, `hasAcroForm`, `hasJavaScript`
- `fontObjectCount`, `embeddedFontCount`, `imageObjectCount`
- `hasMediaBox`, `hasTrimBox`, `hasBleedBox`, `hasCropBox`
