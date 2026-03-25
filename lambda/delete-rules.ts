import { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";

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

  const s3Key = productId
    ? `rules/${tenantId}/${productId}.json`
    : `rules/${tenantId}/default.json`;

  await s3.send(
    new DeleteObjectCommand({
      Bucket: rulesBucket,
      Key: s3Key,
    }),
  );

  return json(200, { tenantId, productId: productId ?? null, deleted: true });
};

function json(statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}
