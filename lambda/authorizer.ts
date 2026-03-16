import {
  APIGatewayRequestSimpleAuthorizerHandlerV2WithContext,
  APIGatewaySimpleAuthorizerWithContextResult,
} from "aws-lambda";
import { CognitoJwtVerifier } from "aws-jwt-verify";

interface AuthContext {
  authMethod: string;
  sub?: string;
}

const API_KEY_HEADER = "x-api-key";

let jwtVerifier: ReturnType<typeof CognitoJwtVerifier.create> | null = null;

function getJwtVerifier() {
  if (!jwtVerifier) {
    jwtVerifier = CognitoJwtVerifier.create({
      userPoolId: process.env.COGNITO_USER_POOL_ID!,
      clientId: process.env.COGNITO_CLIENT_ID!,
      tokenUse: "id",
    });
  }
  return jwtVerifier;
}

export const handler: APIGatewayRequestSimpleAuthorizerHandlerV2WithContext<AuthContext> = async (
  event,
): Promise<APIGatewaySimpleAuthorizerWithContextResult<AuthContext>> => {
  const apiKey = event.headers?.[API_KEY_HEADER];
  const authHeader = event.headers?.authorization;

  // Try API key first
  if (apiKey) {
    const expectedKey = process.env.API_KEY;
    if (!expectedKey) {
      console.error("API_KEY environment variable not set");
      return { isAuthorized: false, context: { authMethod: "api-key" } };
    }

    if (apiKey === expectedKey) {
      return { isAuthorized: true, context: { authMethod: "api-key" } };
    }

    return { isAuthorized: false, context: { authMethod: "api-key" } };
  }

  // Fall back to Cognito JWT
  if (authHeader) {
    const token = authHeader.replace(/^Bearer\s+/i, "");
    try {
      const payload = await getJwtVerifier().verify(token);
      return {
        isAuthorized: true,
        context: { authMethod: "cognito", sub: payload.sub },
      };
    } catch (err) {
      console.error("JWT verification failed:", err);
      return { isAuthorized: false, context: { authMethod: "cognito" } };
    }
  }

  return { isAuthorized: false, context: { authMethod: "none" } };
};
