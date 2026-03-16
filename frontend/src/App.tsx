import { useEffect, useMemo, useState } from "react";

type PresignResponse = {
  uploadUrl: string;
  objectKey: string;
  requiredHeaders?: Record<string, string>;
};

type CreateJobResponse = {
  jobId: string;
};

type JobResponse = {
  status: "PENDING" | "RUNNING" | "PASSED" | "FAILED" | "ERROR";
  checks?: Array<{ code: string; severity: string; passed: boolean; message: string }>;
  metadata?: Record<string, unknown>;
  errorMessage?: string;
};

type RuleSeverity = "FAIL" | "WARN";

type PreflightRules = {
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
};

type RulesResponse = {
  tenantId: string;
  productId: string | null;
  rules: PreflightRules;
  source?: string;
};

const DEFAULT_RULES: PreflightRules = {
  allowedMimeTypes: ["image/jpeg", "image/png", "image/tiff", "application/pdf"],
  minFileSizeBytes: 0,
  maxFileSizeBytes: 26214400,
  fileSizeSeverity: "FAIL",
  minWidthPx: 2000,
  maxWidthPx: null,
  widthSeverity: "FAIL",
  minHeightPx: 2000,
  maxHeightPx: null,
  heightSeverity: "FAIL",
  minDpi: 300,
  maxDpi: null,
  dpiSeverity: "WARN",
  minTargetPrintDpi: 300,
  maxTargetPrintDpi: null,
  targetPrintDpiSeverity: "FAIL",
  targetPrintWidthIn: 8.5,
  targetPrintHeightIn: 11,
  pdfPageSizeSeverity: "FAIL",
  mimeTypeSeverity: "FAIL",
  mimeMatchSeverity: "FAIL",
};

const BYTES_PER_MB = 1_048_576;

const MIME_TYPE_OPTIONS = [
  { value: "image/jpeg", label: "JPEG" },
  { value: "image/png", label: "PNG" },
  { value: "image/tiff", label: "TIFF" },
  { value: "image/gif", label: "GIF" },
  { value: "image/webp", label: "WebP" },
  { value: "image/bmp", label: "BMP" },
  { value: "image/svg+xml", label: "SVG" },
  { value: "application/pdf", label: "PDF" },
];

const TERMINAL_STATES = new Set(["PASSED", "FAILED", "ERROR"]);
const API_BASE_URL_STORAGE_KEY = "preflight.apiBaseUrl";
const API_KEY_STORAGE_KEY = "preflight.apiKey";
const VIEW_STORAGE_KEY = "preflight.activeView";
const TENANT_ID_STORAGE_KEY = "preflight.tenantId";
const PRODUCT_ID_STORAGE_KEY = "preflight.productId";

const RULE_FIELD_ROWS: Array<{
  label: string;
  minKey:
    | "minWidthPx"
    | "minHeightPx"
    | "minDpi"
    | "minTargetPrintDpi";
  maxKey:
    | "maxWidthPx"
    | "maxHeightPx"
    | "maxDpi"
    | "maxTargetPrintDpi";
  severityKey:
    | "widthSeverity"
    | "heightSeverity"
    | "dpiSeverity"
    | "targetPrintDpiSeverity";
  unit: string;
}> = [
  {
    label: "Image Width",
    minKey: "minWidthPx",
    maxKey: "maxWidthPx",
    severityKey: "widthSeverity",
    unit: "px",
  },
  {
    label: "Image Height",
    minKey: "minHeightPx",
    maxKey: "maxHeightPx",
    severityKey: "heightSeverity",
    unit: "px",
  },
  {
    label: "Metadata DPI",
    minKey: "minDpi",
    maxKey: "maxDpi",
    severityKey: "dpiSeverity",
    unit: "dpi",
  },
  {
    label: "Target Print DPI",
    minKey: "minTargetPrintDpi",
    maxKey: "maxTargetPrintDpi",
    severityKey: "targetPrintDpiSeverity",
    unit: "dpi",
  },
];

export function App(): JSX.Element {
  const [apiBaseUrl, setApiBaseUrl] = useState(() => {
    return window.localStorage.getItem(API_BASE_URL_STORAGE_KEY)?.trim()
      || import.meta.env.VITE_API_BASE_URL
      || "";
  });
  const [apiKey, setApiKey] = useState(() => {
    return window.localStorage.getItem(API_KEY_STORAGE_KEY)?.trim()
      || import.meta.env.VITE_API_KEY
      || "";
  });
  const [activeView, setActiveView] = useState<"upload" | "rules">(() => {
    const storedView = window.localStorage.getItem(VIEW_STORAGE_KEY);
    return storedView === "rules" ? "rules" : "upload";
  });
  const [tenantId, setTenantId] = useState(() => {
    return window.localStorage.getItem(TENANT_ID_STORAGE_KEY) ?? "";
  });
  const [productId, setProductId] = useState(() => {
    return window.localStorage.getItem(PRODUCT_ID_STORAGE_KEY) ?? "";
  });
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [result, setResult] = useState<JobResponse | null>(null);
  const [jobId, setJobId] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [rules, setRules] = useState<PreflightRules>(DEFAULT_RULES);
  const [rulesError, setRulesError] = useState("");
  const [isLoadingRules, setIsLoadingRules] = useState(false);
  const [isSavingRules, setIsSavingRules] = useState(false);
  const [rulesLoaded, setRulesLoaded] = useState(false);

  const ready = useMemo(
    () => Boolean(apiBaseUrl.trim() && apiKey.trim() && selectedFile),
    [apiBaseUrl, apiKey, selectedFile],
  );

  useEffect(() => {
    if (!apiBaseUrl.trim()) {
      window.localStorage.removeItem(API_BASE_URL_STORAGE_KEY);
    } else {
      window.localStorage.setItem(API_BASE_URL_STORAGE_KEY, apiBaseUrl);
    }
  }, [apiBaseUrl]);

  useEffect(() => {
    if (!apiKey.trim()) {
      window.localStorage.removeItem(API_KEY_STORAGE_KEY);
    } else {
      window.localStorage.setItem(API_KEY_STORAGE_KEY, apiKey);
    }
  }, [apiKey]);

  useEffect(() => {
    window.localStorage.setItem(VIEW_STORAGE_KEY, activeView);
  }, [activeView]);

  useEffect(() => {
    window.localStorage.setItem(TENANT_ID_STORAGE_KEY, tenantId);
  }, [tenantId]);

  useEffect(() => {
    window.localStorage.setItem(PRODUCT_ID_STORAGE_KEY, productId);
  }, [productId]);

  const headers = useMemo(() => ({
    "x-api-key": apiKey.trim(),
    "content-type": "application/json",
  }), [apiKey]);

  const baseUrl = useMemo(() => normalizeApiBaseUrl(apiBaseUrl), [apiBaseUrl]);

  const onSubmit = async (): Promise<void> => {
    if (!selectedFile) {
      return;
    }

    setIsSubmitting(true);
    setError("");
    setResult(null);
    setJobId("");

    try {
      const presign = await apiPost<PresignResponse>(baseUrl, "/uploads/presign", headers, {
        fileName: selectedFile.name,
        mimeType: selectedFile.type,
        bytes: selectedFile.size,
      });

      await fetch(presign.uploadUrl, {
        method: "PUT",
        headers: presign.requiredHeaders ?? { "Content-Type": selectedFile.type },
        body: selectedFile,
      });

      const createJobBody: Record<string, unknown> = {
        objectKey: presign.objectKey,
        originalFileName: selectedFile.name,
      };

      if (tenantId.trim()) {
        createJobBody.tenantId = tenantId.trim();
      }

      if (productId.trim()) {
        createJobBody.productId = productId.trim();
      }

      const createJob = await apiPost<CreateJobResponse>(
        baseUrl,
        "/preflight/jobs",
        headers,
        createJobBody,
      );

      setJobId(createJob.jobId);
      const finalJob = await pollJob(baseUrl, headers, createJob.jobId);
      setResult(finalJob);
    } catch (submitError) {
      setError((submitError as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const loadRules = async (): Promise<void> => {
    if (!tenantId.trim()) {
      setRulesError("Tenant ID is required");
      return;
    }

    setIsLoadingRules(true);
    setRulesError("");

    try {
      const rulesPath = productId.trim()
        ? `/preflight/rules/${encodeURIComponent(tenantId.trim())}/${encodeURIComponent(productId.trim())}`
        : `/preflight/rules/${encodeURIComponent(tenantId.trim())}`;
      const response = await apiGet<RulesResponse>(
        baseUrl,
        rulesPath,
        headers,
      );
      setRules(response.rules);
      setRulesLoaded(true);
    } catch (loadError) {
      setRulesError((loadError as Error).message);
    } finally {
      setIsLoadingRules(false);
    }
  };

  const saveRules = async (): Promise<void> => {
    if (!tenantId.trim()) {
      setRulesError("Tenant ID is required");
      return;
    }

    setIsSavingRules(true);
    setRulesError("");

    try {
      const rulesPath = productId.trim()
        ? `/preflight/rules/${encodeURIComponent(tenantId.trim())}/${encodeURIComponent(productId.trim())}`
        : `/preflight/rules/${encodeURIComponent(tenantId.trim())}`;
      const response = await apiPut<RulesResponse>(
        baseUrl,
        rulesPath,
        headers,
        { rules },
      );
      setRules(response.rules);
      setRulesLoaded(true);
    } catch (saveError) {
      setRulesError((saveError as Error).message);
    } finally {
      setIsSavingRules(false);
    }
  };

  const resetRules = (): void => {
    setRules(DEFAULT_RULES);
    setRulesLoaded(false);
  };

  const updateMinField = (
    key:
      | "minFileSizeBytes"
      | "minWidthPx"
      | "minHeightPx"
      | "minDpi"
      | "minTargetPrintDpi",
    value: string,
  ): void => {
    const parsed = parseRequiredNonNegative(value);
    if (parsed == null) {
      return;
    }

    setRules((currentRules) => ({ ...currentRules, [key]: parsed }));
  };

  const updateMaxField = (
    key: "maxFileSizeBytes" | "maxWidthPx" | "maxHeightPx" | "maxDpi" | "maxTargetPrintDpi",
    value: string,
  ): void => {
    const parsed = parseOptionalNonNegative(value);
    if (parsed === undefined) {
      return;
    }

    setRules((currentRules) => ({ ...currentRules, [key]: parsed }));
  };

  const updateSeverityField = (
    key:
      | "fileSizeSeverity"
      | "widthSeverity"
      | "heightSeverity"
      | "dpiSeverity"
      | "targetPrintDpiSeverity"
      | "mimeTypeSeverity"
      | "mimeMatchSeverity"
      | "pdfPageSizeSeverity",
    value: RuleSeverity,
  ): void => {
    setRules((currentRules) => ({ ...currentRules, [key]: value }));
  };

  const updateOptionalInchesField = (
    key: "targetPrintWidthIn" | "targetPrintHeightIn",
    value: string,
  ): void => {
    const parsed = parseOptionalPositive(value);
    if (parsed === undefined) {
      return;
    }

    setRules((currentRules) => ({ ...currentRules, [key]: parsed }));
  };

  return (
    <main className="layout">
      <section className="panel">
        <h1>Preflight App</h1>
        <p>Configure preflight thresholds and run upload checks.</p>

        <label>
          API Base URL
          <input value={apiBaseUrl} onChange={(event) => setApiBaseUrl(event.target.value)} />
        </label>

        <label>
          API Key
          <input
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="pfk-..."
          />
        </label>

        <label>
          Tenant ID
          <input
            value={tenantId}
            onChange={(event) => {
              setTenantId(event.target.value);
              setRulesLoaded(false);
            }}
            placeholder="e.g. client123"
          />
        </label>

        <label>
          Product ID (optional)
          <input
            value={productId}
            onChange={(event) => {
              setProductId(event.target.value);
              setRulesLoaded(false);
            }}
            placeholder="e.g. product-abc"
          />
        </label>

        <div>
          <button onClick={() => setActiveView("upload")} disabled={activeView === "upload"}>
            Upload
          </button>
          <button onClick={() => setActiveView("rules")} disabled={activeView === "rules"}>
            Rules
          </button>
        </div>
      </section>

      {activeView === "upload" && (
      <section className="panel">
        <h2>Preflight Uploader</h2>

        <label>
          Select file
          <input
            type="file"
            accept="image/jpeg,image/png,image/tiff,application/pdf"
            onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
          />
        </label>

        <button disabled={!ready || isSubmitting} onClick={onSubmit}>
          {isSubmitting ? "Running preflight..." : "Run preflight"}
        </button>

        {jobId && <p>Job: {jobId}</p>}
        {error && <p className="error">{error}</p>}
      </section>
      )}

      {activeView === "rules" && (
        <section className="panel">
          <h2>Rules</h2>
          <p>Manage preflight rules per tenant. Rules are stored as rules/&#123;tenantId&#125;.json.</p>

          <div>
            <button onClick={loadRules} disabled={isLoadingRules || !apiBaseUrl.trim() || !apiKey.trim() || !tenantId.trim()}>
              {isLoadingRules ? "Loading..." : "Load Rules"}
            </button>{" "}
            <button onClick={saveRules} disabled={isSavingRules || !apiBaseUrl.trim() || !apiKey.trim() || !tenantId.trim()}>
              {isSavingRules ? "Saving..." : "Save Rules"}
            </button>{" "}
            <button onClick={resetRules}>Reset to Defaults</button>
          </div>

          {rulesLoaded && <p>Loaded rules for tenant: <strong>{tenantId}</strong></p>}
          {rulesError && <p className="error">{rulesError}</p>}

          <div>
            <h3>Allowed MIME Types</h3>
            <label>
              <input
                type="checkbox"
                checked={MIME_TYPE_OPTIONS.every((opt) => rules.allowedMimeTypes.includes(opt.value))}
                onChange={(event) => {
                  setRules((currentRules) => ({
                    ...currentRules,
                    allowedMimeTypes: event.target.checked
                      ? MIME_TYPE_OPTIONS.map((opt) => opt.value)
                      : [],
                  }));
                }}
              />
              Select All
            </label>
            {MIME_TYPE_OPTIONS.map((opt) => (
              <label key={opt.value}>
                <input
                  type="checkbox"
                  checked={rules.allowedMimeTypes.includes(opt.value)}
                  onChange={(event) => {
                    setRules((currentRules) => ({
                      ...currentRules,
                      allowedMimeTypes: event.target.checked
                        ? [...currentRules.allowedMimeTypes, opt.value]
                        : currentRules.allowedMimeTypes.filter((m) => m !== opt.value),
                    }));
                  }}
                />
                {opt.label} ({opt.value})
              </label>
            ))}
          </div>

          <div>
            <h3>File Size</h3>
            <label>
              Min (MB)
              <input
                value={bytesToMbString(rules.minFileSizeBytes)}
                onChange={(event) => {
                  const mb = parseRequiredNonNegative(event.target.value);
                  if (mb == null) return;
                  setRules((currentRules) => ({ ...currentRules, minFileSizeBytes: Math.round(mb * BYTES_PER_MB) }));
                }}
              />
            </label>
            <label>
              Max (MB, blank for none)
              <input
                value={rules.maxFileSizeBytes == null ? "" : bytesToMbString(rules.maxFileSizeBytes)}
                onChange={(event) => {
                  const trimmed = event.target.value.trim();
                  if (!trimmed) {
                    setRules((currentRules) => ({ ...currentRules, maxFileSizeBytes: null }));
                    return;
                  }
                  const mb = parseRequiredNonNegative(trimmed);
                  if (mb == null) return;
                  setRules((currentRules) => ({ ...currentRules, maxFileSizeBytes: Math.round(mb * BYTES_PER_MB) }));
                }}
              />
            </label>
            <label>
              Severity
              <select
                value={rules.fileSizeSeverity}
                onChange={(event) =>
                  updateSeverityField("fileSizeSeverity", event.target.value as RuleSeverity)
                }
              >
                <option value="FAIL">FAIL</option>
                <option value="WARN">WARN</option>
              </select>
            </label>
          </div>

          {RULE_FIELD_ROWS.map((row) => (
            <div key={row.label}>
              <h3>{row.label}</h3>
              <label>
                Min ({row.unit})
                <input
                  value={String(rules[row.minKey])}
                  onChange={(event) => updateMinField(row.minKey, event.target.value)}
                />
              </label>
              <label>
                Max ({row.unit}, blank for none)
                <input
                  value={numberOrBlank(rules[row.maxKey])}
                  onChange={(event) => updateMaxField(row.maxKey, event.target.value)}
                />
              </label>
              <label>
                Severity
                <select
                  value={rules[row.severityKey]}
                  onChange={(event) =>
                    updateSeverityField(row.severityKey, event.target.value as RuleSeverity)
                  }
                >
                  <option value="FAIL">FAIL</option>
                  <option value="WARN">WARN</option>
                </select>
              </label>
            </div>
          ))}

          <div>
            <h3>Target Print Size</h3>
            <label>
              Width (in, blank disables target-print checks)
              <input
                value={numberOrBlank(rules.targetPrintWidthIn)}
                onChange={(event) => updateOptionalInchesField("targetPrintWidthIn", event.target.value)}
              />
            </label>
            <label>
              Height (in, blank disables target-print checks)
              <input
                value={numberOrBlank(rules.targetPrintHeightIn)}
                onChange={(event) => updateOptionalInchesField("targetPrintHeightIn", event.target.value)}
              />
            </label>
          </div>

          <div>
            <h3>Non-Range Check Severities</h3>
            <label>
              Allowed MIME Type
              <select
                value={rules.mimeTypeSeverity}
                onChange={(event) =>
                  updateSeverityField("mimeTypeSeverity", event.target.value as RuleSeverity)
                }
              >
                <option value="FAIL">FAIL</option>
                <option value="WARN">WARN</option>
              </select>
            </label>
            <label>
              Uploaded MIME Matches Content
              <select
                value={rules.mimeMatchSeverity}
                onChange={(event) =>
                  updateSeverityField("mimeMatchSeverity", event.target.value as RuleSeverity)
                }
              >
                <option value="FAIL">FAIL</option>
                <option value="WARN">WARN</option>
              </select>
            </label>
            <label>
              PDF Page Size Fits Target Print
              <select
                value={rules.pdfPageSizeSeverity}
                onChange={(event) =>
                  updateSeverityField("pdfPageSizeSeverity", event.target.value as RuleSeverity)
                }
              >
                <option value="FAIL">FAIL</option>
                <option value="WARN">WARN</option>
              </select>
            </label>
          </div>
        </section>
      )}

      <section className="panel">
        <h2>Result</h2>
        {!result && <p>No result yet.</p>}
        {result && (
          <>
            <p>
              Status: <strong>{result.status}</strong>
            </p>
            {result.errorMessage && <p className="error">{result.errorMessage}</p>}
            <pre>{JSON.stringify(result.metadata ?? {}, null, 2)}</pre>
            <pre>{JSON.stringify(result.checks ?? [], null, 2)}</pre>
          </>
        )}
      </section>
    </main>
  );
}

type ApiHeaders = Record<string, string>;

async function apiPost<T>(baseUrl: string, path: string, headers: ApiHeaders, body: unknown): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API request failed (${response.status}): ${text}`);
  }

  return (await response.json()) as T;
}

async function apiGet<T>(baseUrl: string, path: string, headers: ApiHeaders): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, { headers });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API request failed (${response.status}): ${text}`);
  }

  return (await response.json()) as T;
}

async function apiPut<T>(baseUrl: string, path: string, headers: ApiHeaders, body: unknown): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "PUT",
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API request failed (${response.status}): ${text}`);
  }

  return (await response.json()) as T;
}

async function pollJob(baseUrl: string, headers: ApiHeaders, jobId: string): Promise<JobResponse> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const response = await fetch(`${baseUrl}/preflight/jobs/${jobId}`, { headers });

    if (!response.ok) {
      throw new Error(`Job polling failed with status ${response.status}`);
    }

    const job = (await response.json()) as JobResponse;
    if (TERMINAL_STATES.has(job.status)) {
      return job;
    }

    await sleep(2000);
  }

  throw new Error("Timed out while waiting for preflight job");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeApiBaseUrl(apiBaseUrl: string): string {
  return apiBaseUrl.trim().replace(/\/+$/, "");
}

function parseRequiredNonNegative(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return 0;
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return parsed;
}

function parseOptionalNonNegative(value: string): number | null | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return undefined;
  }

  return parsed;
}

function parseOptionalPositive(value: string): number | null | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }

  return parsed;
}

function numberOrBlank(value: number | null): string {
  return value == null ? "" : String(value);
}

function bytesToMbString(bytes: number): string {
  const mb = bytes / BYTES_PER_MB;
  // Show up to 2 decimal places, trimming trailing zeros
  return parseFloat(mb.toFixed(2)).toString();
}
