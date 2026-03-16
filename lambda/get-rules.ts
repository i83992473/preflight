import { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { DEFAULT_PREFLIGHT_RULES, normalizePreflightRules } from "../lib/preflight-rules";

const s3 = new S3Client({});

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> => {
  const rulesBucket = process.env.RULES_BUCKET;
  if (!rulesBucket) {
    return json(500, { message: "RULES_BUCKET is not configured" });
  }

  const tenantId = event.pathParameters?.tenantId;
  if (!tenantId || !/^[a-zA-Z0-9_-]+$/.test(tenantId)) {
    return json(400, { message: "tenantId must be alphanumeric (with dashes/underscores)" });
  }

  const productId = event.pathParameters?.productId;
  if (productId && !/^[a-zA-Z0-9_-]+$/.test(productId)) {
    return json(400, { message: "productId must be alphanumeric (with dashes/underscores)" });
  }

  // Resolution order:
  // 1. rules/{tenantId}/{productId}.json  (if productId provided)
  // 2. rules/{tenantId}/default.json      (tenant default)
  // 3. system DEFAULT_PREFLIGHT_RULES

  const keysToTry: string[] = [];
  if (productId) {
    keysToTry.push(`rules/${tenantId}/${productId}.json`);
  }
  keysToTry.push(`rules/${tenantId}/default.json`);

  for (const key of keysToTry) {
    try {
      const result = await s3.send(
        new GetObjectCommand({
          Bucket: rulesBucket,
          Key: key,
        }),
      );

      const body = await result.Body?.transformToString();
      if (body) {
        const rules = normalizePreflightRules(JSON.parse(body));
        return json(200, { tenantId, productId: productId ?? null, rules, source: key });
      }
    } catch (error) {
      if ((error as { name?: string }).name !== "NoSuchKey") {
        throw error;
      }
    }
  }

  return json(200, { tenantId, productId: productId ?? null, rules: DEFAULT_PREFLIGHT_RULES, source: "default" });
};

function json(statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}
