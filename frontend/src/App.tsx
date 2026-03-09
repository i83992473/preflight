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
  rules: PreflightRules;
  updatedAt: string | null;
};

const TERMINAL_STATES = new Set(["PASSED", "FAILED", "ERROR"]);
const API_BASE_URL_STORAGE_KEY = "preflight.apiBaseUrl";
const VIEW_STORAGE_KEY = "preflight.activeView";

const RULE_FIELD_ROWS: Array<{
  label: string;
  minKey:
    | "minFileSizeBytes"
    | "minWidthPx"
    | "minHeightPx"
    | "minDpi"
    | "minTargetPrintDpi";
  maxKey:
    | "maxFileSizeBytes"
    | "maxWidthPx"
    | "maxHeightPx"
    | "maxDpi"
    | "maxTargetPrintDpi";
  severityKey:
    | "fileSizeSeverity"
    | "widthSeverity"
    | "heightSeverity"
    | "dpiSeverity"
    | "targetPrintDpiSeverity";
  unit: string;
}> = [
  {
    label: "File Size",
    minKey: "minFileSizeBytes",
    maxKey: "maxFileSizeBytes",
    severityKey: "fileSizeSeverity",
    unit: "bytes",
  },
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
    const savedApiBaseUrl = window.localStorage.getItem(API_BASE_URL_STORAGE_KEY);
    if (savedApiBaseUrl?.trim()) {
      return savedApiBaseUrl;
    }

    return import.meta.env.VITE_API_BASE_URL ?? "";
  });
  const [idToken, setIdToken] = useState("");
  const [activeView, setActiveView] = useState<"upload" | "rules">(() => {
    const storedView = window.localStorage.getItem(VIEW_STORAGE_KEY);
    return storedView === "rules" ? "rules" : "upload";
  });
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [result, setResult] = useState<JobResponse | null>(null);
  const [jobId, setJobId] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [rules, setRules] = useState<PreflightRules | null>(null);
  const [rulesUpdatedAt, setRulesUpdatedAt] = useState<string | null>(null);
  const [rulesError, setRulesError] = useState("");
  const [isLoadingRules, setIsLoadingRules] = useState(false);
  const [isSavingRules, setIsSavingRules] = useState(false);

  const ready = useMemo(
    () => Boolean(apiBaseUrl.trim() && idToken.trim() && selectedFile),
    [apiBaseUrl, idToken, selectedFile],
  );

  useEffect(() => {
    if (!apiBaseUrl.trim()) {
      window.localStorage.removeItem(API_BASE_URL_STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(API_BASE_URL_STORAGE_KEY, apiBaseUrl);
  }, [apiBaseUrl]);

  useEffect(() => {
    window.localStorage.setItem(VIEW_STORAGE_KEY, activeView);
  }, [activeView]);

  useEffect(() => {
    if (activeView !== "rules") {
      return;
    }

    if (!apiBaseUrl.trim() || !idToken.trim()) {
      return;
    }

    if (rules) {
      return;
    }

    void loadRules();
  }, [activeView, apiBaseUrl, idToken, rules]);

  const onSubmit = async (): Promise<void> => {
    if (!selectedFile) {
      return;
    }

    setIsSubmitting(true);
    setError("");
    setResult(null);
    setJobId("");

    try {
      const presign = await callApi<PresignResponse>(
        normalizeApiBaseUrl(apiBaseUrl),
        "/uploads/presign",
        idToken,
        {
          fileName: selectedFile.name,
          mimeType: selectedFile.type,
          bytes: selectedFile.size,
        },
      );

      await fetch(presign.uploadUrl, {
        method: "PUT",
        headers: presign.requiredHeaders ?? { "Content-Type": selectedFile.type },
        body: selectedFile,
      });

      const createJob = await callApi<CreateJobResponse>(
        normalizeApiBaseUrl(apiBaseUrl),
        "/preflight/jobs",
        idToken,
        {
          objectKey: presign.objectKey,
          originalFileName: selectedFile.name,
        },
      );

      setJobId(createJob.jobId);
      const finalJob = await pollJob(normalizeApiBaseUrl(apiBaseUrl), idToken, createJob.jobId);
      setResult(finalJob);
    } catch (submitError) {
      setError((submitError as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const loadRules = async (): Promise<void> => {
    setIsLoadingRules(true);
    setRulesError("");

    try {
      const response = await callApiWithMethod<RulesResponse>(
        normalizeApiBaseUrl(apiBaseUrl),
        "/preflight/rules",
        idToken,
        "GET",
      );
      setRules(response.rules);
      setRulesUpdatedAt(response.updatedAt);
    } catch (loadError) {
      setRulesError((loadError as Error).message);
    } finally {
      setIsLoadingRules(false);
    }
  };

  const saveRules = async (): Promise<void> => {
    if (!rules) {
      return;
    }

    setIsSavingRules(true);
    setRulesError("");

    try {
      const response = await callApiWithMethod<RulesResponse>(
        normalizeApiBaseUrl(apiBaseUrl),
        "/preflight/rules",
        idToken,
        "PUT",
        {
          rules,
        },
      );
      setRules(response.rules);
      setRulesUpdatedAt(response.updatedAt);
    } catch (saveError) {
      setRulesError((saveError as Error).message);
    } finally {
      setIsSavingRules(false);
    }
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

    setRules((currentRules) => (currentRules ? { ...currentRules, [key]: parsed } : currentRules));
  };

  const updateMaxField = (
    key: "maxFileSizeBytes" | "maxWidthPx" | "maxHeightPx" | "maxDpi" | "maxTargetPrintDpi",
    value: string,
  ): void => {
    const parsed = parseOptionalNonNegative(value);
    if (parsed === undefined) {
      return;
    }

    setRules((currentRules) => (currentRules ? { ...currentRules, [key]: parsed } : currentRules));
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
    setRules((currentRules) => (currentRules ? { ...currentRules, [key]: value } : currentRules));
  };

  const updateOptionalInchesField = (
    key: "targetPrintWidthIn" | "targetPrintHeightIn",
    value: string,
  ): void => {
    const parsed = parseOptionalPositive(value);
    if (parsed === undefined) {
      return;
    }

    setRules((currentRules) => (currentRules ? { ...currentRules, [key]: parsed } : currentRules));
  };

  return (
    <main className="layout">
      <section className="panel">
        <h1>Preflight App</h1>
        <p>Configure preflight thresholds and run upload checks.</p>
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
        <p>Upload a file, run backend preflight checks, and inspect metadata output.</p>

        <label>
          API Base URL
          <input value={apiBaseUrl} onChange={(event) => setApiBaseUrl(event.target.value)} />
        </label>

        <label>
          Cognito ID Token
          <textarea
            value={idToken}
            onChange={(event) => setIdToken(event.target.value)}
            rows={4}
            placeholder="Paste JWT ID token"
          />
        </label>

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
          <p>Set min/max thresholds. Leave max blank for no max. Set min to 0 when needed.</p>

          <button onClick={loadRules} disabled={isLoadingRules || !apiBaseUrl.trim() || !idToken.trim()}>
            {isLoadingRules ? "Loading rules..." : "Load Rules"}
          </button>

          {rulesUpdatedAt && <p>Last updated: {new Date(rulesUpdatedAt).toLocaleString()}</p>}
          {rulesError && <p className="error">{rulesError}</p>}

          {rules && (
            <>
              <label>
                Allowed MIME Types (comma-separated)
                <input
                  value={rules.allowedMimeTypes.join(",")}
                  onChange={(event) => {
                    const mimeTypes = event.target.value
                      .split(",")
                      .map((value) => value.trim())
                      .filter(Boolean);
                    setRules((currentRules) =>
                      currentRules
                        ? {
                            ...currentRules,
                            allowedMimeTypes: mimeTypes,
                          }
                        : currentRules,
                    );
                  }}
                />
              </label>

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

              <button onClick={saveRules} disabled={isSavingRules}>
                {isSavingRules ? "Saving rules..." : "Save Rules"}
              </button>
            </>
          )}
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

async function pollJob(apiBaseUrl: string, idToken: string, jobId: string): Promise<JobResponse> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const response = await fetch(`${apiBaseUrl}/preflight/jobs/${jobId}`, {
      headers: {
        Authorization: `Bearer ${idToken}`,
      },
    });

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

async function callApi<T>(
  apiBaseUrl: string,
  path: string,
  idToken: string,
  body: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(`${normalizeApiBaseUrl(apiBaseUrl)}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${idToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const responseBody = await response.text();
    throw new Error(`API request failed (${response.status}): ${responseBody}`);
  }

  return (await response.json()) as T;
}

async function callApiWithMethod<T>(
  apiBaseUrl: string,
  path: string,
  idToken: string,
  method: "GET" | "PUT",
  body?: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(`${normalizeApiBaseUrl(apiBaseUrl)}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${idToken}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!response.ok) {
    const responseBody = await response.text();
    throw new Error(`API request failed (${response.status}): ${responseBody}`);
  }

  return (await response.json()) as T;
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
