import { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import type { PreflightRules } from "../lib/contracts";
import { normalizePreflightRules } from "../lib/preflight-rules";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: {
    removeUndefinedValues: true,
  },
});

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> => {
  const tableName = process.env.RULES_TABLE_NAME;
  if (!tableName) {
    return json(500, { message: "RULES_TABLE_NAME is not configured" });
  }

  const incomingBody = event.body ? (JSON.parse(event.body) as Record<string, unknown>) : {};
  const incomingRules = incomingBody.rules;
  if (incomingRules != null && (typeof incomingRules !== "object" || Array.isArray(incomingRules))) {
    return json(400, { message: "rules must be an object" });
  }

  const key = {
    PK: "RULES",
    SK: "ACTIVE",
  };
  const current = await ddb.send(
    new GetCommand({
      TableName: tableName,
      Key: key,
    }),
  );

  const mergedRules = normalizePreflightRules({
    ...(current.Item?.rules as PreflightRules | undefined),
    ...(incomingRules as Record<string, unknown> | undefined),
  });

  const updatedAt = new Date().toISOString();
  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        ...key,
        rules: mergedRules,
        updatedAt,
      },
    }),
  );

  return json(200, {
    rules: mergedRules,
    updatedAt,
  });
};

function json(statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  };
}
