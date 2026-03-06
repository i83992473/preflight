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

const TERMINAL_STATES = new Set(["PASSED", "FAILED", "ERROR"]);
const API_BASE_URL_STORAGE_KEY = "preflight.apiBaseUrl";

export function App(): JSX.Element {
  const [apiBaseUrl, setApiBaseUrl] = useState(() => {
    const savedApiBaseUrl = window.localStorage.getItem(API_BASE_URL_STORAGE_KEY);
    if (savedApiBaseUrl?.trim()) {
      return savedApiBaseUrl;
    }

    return import.meta.env.VITE_API_BASE_URL ?? "";
  });
  const [idToken, setIdToken] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [result, setResult] = useState<JobResponse | null>(null);
  const [jobId, setJobId] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

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
        apiBaseUrl,
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
        apiBaseUrl,
        "/preflight/jobs",
        idToken,
        {
          objectKey: presign.objectKey,
          originalFileName: selectedFile.name,
        },
      );

      setJobId(createJob.jobId);
      const finalJob = await pollJob(apiBaseUrl, idToken, createJob.jobId);
      setResult(finalJob);
    } catch (submitError) {
      setError((submitError as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="layout">
      <section className="panel">
        <h1>Preflight Uploader</h1>
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
  const response = await fetch(`${apiBaseUrl}${path}`, {
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
