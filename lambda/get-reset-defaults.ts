import { APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { RESET_PREFLIGHT_RULES } from "../lib/preflight-rules";

export const handler = async (): Promise<APIGatewayProxyStructuredResultV2> => {
  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rules: RESET_PREFLIGHT_RULES, source: "reset-defaults" }),
  };
};
