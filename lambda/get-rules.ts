import { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { normalizePreflightRules } from "../lib/preflight-rules";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export const handler = async (
  _event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> => {
  const tableName = process.env.RULES_TABLE_NAME;
  if (!tableName) {
    return json(500, { message: "RULES_TABLE_NAME is not configured" });
  }

  const key = {
    PK: "RULES",
    SK: "ACTIVE",
  };

  const response = await ddb.send(
    new GetCommand({
      TableName: tableName,
      Key: key,
    }),
  );

  const rules = normalizePreflightRules(response.Item?.rules);
  return json(200, {
    rules,
    updatedAt: response.Item?.updatedAt ?? null,
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
