# Preflight Web App

Tiny React app for upload + preflight testing against the deployed API.

## Run locally

1. `npm install`
2. Copy `.env.example` to `.env` and set `VITE_API_BASE_URL` to your deployed API URL.
3. `npm run dev`

## Cognito Token

The backend routes require a Cognito JWT. Paste an ID token into the app before uploading.

Quick way to fetch one with AWS CLI:

```bash
aws cognito-idp initiate-auth \
  --auth-flow USER_PASSWORD_AUTH \
  --client-id <COGNITO_USER_POOL_CLIENT_ID> \
  --auth-parameters USERNAME=<EMAIL>,PASSWORD=<PASSWORD>
```

Use `AuthenticationResult.IdToken` from the command response.
