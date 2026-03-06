import { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { v4 as uuidv4 } from "uuid";

const s3Client = new S3Client({});

type PresignUploadRequest = {
  fileName?: string;
  mimeType?: string;
  bytes?: number;
};

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> => {
  const body: PresignUploadRequest = event.body ? JSON.parse(event.body) : {};
  const bucketName = process.env.UPLOADS_TEMP_BUCKET;

  if (!bucketName) {
    return json(500, { message: "UPLOADS_TEMP_BUCKET is not configured" });
  }

  const fileName = body.fileName?.trim();
  const mimeType = body.mimeType?.trim();
  const bytes = body.bytes ?? 0;

  if (!fileName || !mimeType) {
    return json(400, { message: "fileName and mimeType are required" });
  }

  const allowedMimeTypes = (process.env.ALLOWED_MIME_TYPES ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!allowedMimeTypes.includes(mimeType)) {
    return json(400, { message: `mimeType ${mimeType} is not allowed` });
  }

  const maxFileSizeBytes = Number(process.env.MAX_FILE_SIZE_BYTES ?? "26214400");
  if (bytes > maxFileSizeBytes) {
    return json(400, { message: `file size exceeds ${maxFileSizeBytes} bytes` });
  }

  const ext = fileName.includes(".") ? fileName.split(".").pop()?.toLowerCase() : "bin";
  const objectKey = `incoming/${new Date().toISOString().slice(0, 10)}/${uuidv4()}.${ext}`;
  const expiresInSeconds = Number(process.env.PRESIGN_EXPIRES_SECONDS ?? "900");

  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: objectKey,
    ContentType: mimeType,
  });

  const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: expiresInSeconds });
  return json(200, {
    uploadUrl,
    objectKey,
    expiresInSeconds,
    requiredHeaders: {
      "Content-Type": mimeType,
    },
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
