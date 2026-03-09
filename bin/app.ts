#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import type { PreflightRules } from "../lib/contracts";
import { PreflightApiStack } from "../lib/stacks/preflight-api-stack";
import { PreflightStorageStack } from "../lib/stacks/preflight-storage-stack";

const app = new cdk.App();
const environment = app.node.tryGetContext("environment") ?? "dev";
const frontendOriginsContext = app.node.tryGetContext("frontendOrigins");
const frontendOrigins =
  Array.isArray(frontendOriginsContext) && frontendOriginsContext.length > 0
    ? frontendOriginsContext
    : typeof frontendOriginsContext === "string" && frontendOriginsContext.trim().length > 0
      ? frontendOriginsContext
          .split(",")
          .map((value: string) => value.trim())
          .filter(Boolean)
      : ["http://localhost:5173"];
const preflightRules = parsePreflightRules(app.node.tryGetContext("preflightRules"));

const env: cdk.Environment = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? "us-east-1",
};

const storage = new PreflightStorageStack(app, `PreflightStorage-${environment}`, {
  env,
  environment,
  frontendOrigins,
});

new PreflightApiStack(app, `PreflightApi-${environment}`, {
  env,
  environment,
  frontendOrigins,
  preflightRules,
  uploadsTempBucket: storage.uploadsTempBucket,
  uploadsApprovedBucket: storage.uploadsApprovedBucket,
  uploadsQuarantineBucket: storage.uploadsQuarantineBucket,
  jobsTable: storage.jobsTable,
  rulesTable: storage.rulesTable,
  jobsQueue: storage.jobsQueue,
});

function parsePreflightRules(rawRules: unknown): Partial<PreflightRules> | undefined {
  if (rawRules == null) {
    return undefined;
  }

  if (typeof rawRules === "string") {
    if (!rawRules.trim()) {
      return undefined;
    }

    const parsedRules = parseRulesJson(rawRules);
    if (parsedRules == null || typeof parsedRules !== "object" || Array.isArray(parsedRules)) {
      throw new Error("CDK context 'preflightRules' must be a JSON object");
    }

    return parsedRules as Partial<PreflightRules>;
  }

  if (typeof rawRules === "object" && !Array.isArray(rawRules)) {
    return rawRules as Partial<PreflightRules>;
  }

  throw new Error("CDK context 'preflightRules' must be an object or JSON string");
}

function parseRulesJson(rawRules: string): unknown {
  try {
    return JSON.parse(rawRules) as unknown;
  } catch {
    try {
      // PowerShell users commonly pass escaped quotes like {\"minDpi\":150}.
      return JSON.parse(rawRules.replace(/\\"/g, '"')) as unknown;
    } catch {
      // CDK CLI can coerce context values into object-like strings with bare keys.
      const normalized = rawRules
        .replace(/([{,]\s*)([A-Za-z0-9_]+)\s*:/g, '$1"$2":')
        .replace(/'/g, '"');
      return JSON.parse(normalized) as unknown;
    }
  }
}
