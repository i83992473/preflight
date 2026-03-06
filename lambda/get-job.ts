import { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> => {
  const tableName = process.env.JOBS_TABLE_NAME;
  const jobId = event.pathParameters?.jobId;

  if (!tableName) {
    return json(500, { message: "JOBS_TABLE_NAME is not configured" });
  }

  if (!jobId) {
    return json(400, { message: "jobId path parameter is required" });
  }

  const response = await ddb.send(
    new GetCommand({
      TableName: tableName,
      Key: {
        PK: `JOB#${jobId}`,
        SK: "METADATA",
      },
    }),
  );

  if (!response.Item) {
    return json(404, { message: "job not found" });
  }

  return json(200, response.Item);
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
