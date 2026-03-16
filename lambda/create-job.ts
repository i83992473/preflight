import { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { v4 as uuidv4 } from "uuid";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: {
    removeUndefinedValues: true,
  },
});
const sqs = new SQSClient({});

type CreatePreflightJobRequest = {
  objectKey?: string;
  originalFileName?: string;
  tenantId?: string;
  productId?: string;
};

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> => {
  const tableName = process.env.JOBS_TABLE_NAME;
  const queueUrl = process.env.JOBS_QUEUE_URL;

  if (!tableName || !queueUrl) {
    return json(500, { message: "Lambda environment is not configured" });
  }

  const body: CreatePreflightJobRequest = event.body ? JSON.parse(event.body) : {};
  if (!body.objectKey || !body.originalFileName) {
    return json(400, { message: "objectKey and originalFileName are required" });
  }

  if (body.tenantId && !/^[a-zA-Z0-9_-]+$/.test(body.tenantId)) {
    return json(400, { message: "tenantId must be alphanumeric (with dashes/underscores)" });
  }

  if (body.productId && !/^[a-zA-Z0-9_-]+$/.test(body.productId)) {
    return json(400, { message: "productId must be alphanumeric (with dashes/underscores)" });
  }

  const now = new Date().toISOString();
  const jobId = uuidv4();

  const item: Record<string, unknown> = {
    PK: `JOB#${jobId}`,
    SK: "METADATA",
    jobId,
    status: "PENDING",
    objectKey: body.objectKey,
    originalFileName: body.originalFileName,
    tenantId: body.tenantId ?? null,
    productId: body.productId ?? null,
    createdAt: now,
    updatedAt: now,
    GSI1PK: "STATUS#PENDING",
    GSI1SK: `${now}#${jobId}`,
  };

  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: item,
      ConditionExpression: "attribute_not_exists(PK)",
    }),
  );

  await sqs.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify({ jobId }),
    }),
  );

  return json(202, {
    jobId,
    status: "PENDING",
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
