# Deployment Guide

## 1. Prerequisites

1. Install Node.js 20+ and AWS CLI.
2. Configure AWS credentials: `aws configure`.
3. Ensure your IAM principal can deploy CloudFormation, API Gateway, Lambda, S3, DynamoDB, SQS, Cognito, and IAM roles.

## 2. Deploy backend infrastructure

1. Install dependencies in repo root: `npm install`.
2. Bootstrap CDK once per account/region: `npx aws-cdk bootstrap`.
3. Deploy: `npm run deploy`.
4. Capture CloudFormation outputs:
1. `PreflightApiUrl`
2. `CognitoUserPoolId`
3. `CognitoUserPoolClientId`
4. `AwsRegion`

## 3. Create a Cognito test user

1. Create user in Cognito user pool:

```bash
aws cognito-idp admin-create-user \
  --user-pool-id <COGNITO_USER_POOL_ID> \
  --username <EMAIL> \
  --user-attributes Name=email,Value=<EMAIL> Name=email_verified,Value=true \
  --temporary-password '<TempPassword123!>'
```

2. Set permanent password:

```bash
aws cognito-idp admin-set-user-password \
  --user-pool-id <COGNITO_USER_POOL_ID> \
  --username <EMAIL> \
  --password '<StrongPassword123!>' \
  --permanent
```

3. Get an ID token:

```bash
aws cognito-idp initiate-auth \
  --auth-flow USER_PASSWORD_AUTH \
  --client-id <COGNITO_USER_POOL_CLIENT_ID> \
  --auth-parameters USERNAME=<EMAIL>,PASSWORD=<StrongPassword123!>
```

Use `AuthenticationResult.IdToken`.

## 4. Run the React uploader locally

1. `cd frontend`
2. `npm install`
3. Copy `.env.example` to `.env` and set `VITE_API_BASE_URL=<PreflightApiUrl>`
4. `npm run dev`
5. Paste the ID token and upload a file.

## 5. Frontend hosting options

1. Amplify Hosting (recommended easiest path): connect repo, set build command `npm run build`, publish `dist`.
2. S3 + CloudFront: build with `npm run build`, upload `dist`, serve via CloudFront.

## 6. Keep CORS aligned

If frontend URL changes, redeploy CDK with updated origins:

```bash
npx aws-cdk deploy -c frontendOrigins=https://your-frontend-domain.com
```

## 7. View and set preflight pass/fail thresholds

Current thresholds are passed to the worker Lambda as `PREFLIGHT_RULES_JSON`.

Supported rule keys include:

1. `minFileSizeBytes`, `maxFileSizeBytes`, `fileSizeSeverity`
2. `minWidthPx`, `maxWidthPx`, `widthSeverity`
3. `minHeightPx`, `maxHeightPx`, `heightSeverity`
4. `minDpi`, `maxDpi`, `dpiSeverity`
5. `minTargetPrintDpi`, `maxTargetPrintDpi`, `targetPrintDpiSeverity`
6. `targetPrintWidthIn`, `targetPrintHeightIn`
7. `pdfPageSizeSeverity`, `mimeTypeSeverity`, `mimeMatchSeverity`
8. `allowedMimeTypes`

1. View active thresholds on a deployed stack:

```bash
aws lambda get-function-configuration \
  --function-name <WORKER_LAMBDA_NAME> \
  --query 'Environment.Variables.PREFLIGHT_RULES_JSON'
```

2. Override thresholds at deploy-time (without code changes):

```bash
npx aws-cdk deploy \
  -c preflightRules='{"allowedMimeTypes":["image/jpeg","image/png","image/tiff","application/pdf"],"minFileSizeBytes":0,"maxFileSizeBytes":26214400,"fileSizeSeverity":"FAIL","minWidthPx":1200,"maxWidthPx":null,"widthSeverity":"FAIL","minHeightPx":1200,"maxHeightPx":null,"heightSeverity":"FAIL","minDpi":150,"maxDpi":null,"dpiSeverity":"WARN","minTargetPrintDpi":150,"maxTargetPrintDpi":null,"targetPrintDpiSeverity":"FAIL","targetPrintWidthIn":8.5,"targetPrintHeightIn":11,"pdfPageSizeSeverity":"FAIL","mimeTypeSeverity":"FAIL","mimeMatchSeverity":"FAIL"}'
```

PowerShell example:

```powershell
npx aws-cdk deploy -c preflightRules="{\"minWidthPx\":1200,\"minHeightPx\":1200,\"minDpi\":150,\"minTargetPrintDpi\":150,\"targetPrintWidthIn\":8.5,\"targetPrintHeightIn\":11,\"dpiSeverity\":\"WARN\"}"
```

3. Example: include frontend origin + rule override in one deploy command:

```bash
npx aws-cdk deploy \
  -c frontendOrigins=https://your-frontend-domain.com \
  -c preflightRules='{"minWidthPx":1200,"minHeightPx":1200,"minDpi":150,"minTargetPrintDpi":150,"targetPrintWidthIn":8.5,"targetPrintHeightIn":11}'
```
