import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as ssm from "aws-cdk-lib/aws-ssm";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as sqs from "aws-cdk-lib/aws-sqs";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { HttpLambdaAuthorizer, HttpLambdaResponseType } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import { Construct } from "constructs";
import { PreflightApi } from "../constructs/preflight-api";
import { PreflightLambdas } from "../constructs/preflight-lambdas";
import type { PreflightRules } from "../contracts";
import * as path from "path";

export interface PreflightApiStackProps extends cdk.StackProps {
  environment: string;
  frontendOrigins: string[];
  uploadsTempBucket: s3.IBucket;
  uploadsApprovedBucket: s3.IBucket;
  uploadsQuarantineBucket: s3.IBucket;
  rulesBucket: s3.IBucket;
  jobsTable: dynamodb.ITable;
  jobsQueue: sqs.IQueue;
  preflightRules?: Partial<PreflightRules>;
}

export class PreflightApiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: PreflightApiStackProps) {
    super(scope, id, props);

    const userPool = new cognito.UserPool(this, "PreflightUserPool", {
      userPoolName: `preflight-users-${props.environment}`,
      selfSignUpEnabled: false,
      signInAliases: {
        email: true,
      },
      passwordPolicy: {
        minLength: 12,
        requireDigits: true,
        requireLowercase: true,
        requireUppercase: true,
        requireSymbols: true,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const userPoolClient = userPool.addClient("PreflightWebClient", {
      userPoolClientName: `preflight-web-client-${props.environment}`,
      generateSecret: false,
      authFlows: {
        userSrp: true,
        userPassword: true,
      },
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(3650),
    });

    // API key stored in SSM Parameter Store (SecureString)
    const apiKeyParam = new ssm.StringParameter(this, "PreflightApiKey", {
      parameterName: `/preflight/${props.environment}/api-key`,
      description: "API key for backend-to-backend calls to the Preflight API",
      stringValue: cdk.Lazy.string({
        produce: () =>
          this.node.tryGetContext("apiKey") || `pfk-${cdk.Names.uniqueId(this)}`,
      }),
      tier: ssm.ParameterTier.STANDARD,
    });

    // Lambda authorizer that supports both Cognito JWT and API key
    const authorizerFunction = new NodejsFunction(this, "AuthorizerFunction", {
      runtime: Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      entry: path.join(__dirname, "../../lambda/authorizer.ts"),
      handler: "handler",
      bundling: {
        minify: true,
        sourceMap: true,
      },
      environment: {
        COGNITO_USER_POOL_ID: userPool.userPoolId,
        COGNITO_CLIENT_ID: userPoolClient.userPoolClientId,
        API_KEY: apiKeyParam.stringValue,
      },
    });

    const authorizer = new HttpLambdaAuthorizer("PreflightApiAuthorizer", authorizerFunction, {
      responseTypes: [HttpLambdaResponseType.SIMPLE],
      identitySource: [],
      resultsCacheTtl: cdk.Duration.seconds(0),
    });

    const lambdas = new PreflightLambdas(this, "Lambdas", {
      uploadsTempBucket: props.uploadsTempBucket,
      uploadsApprovedBucket: props.uploadsApprovedBucket,
      uploadsQuarantineBucket: props.uploadsQuarantineBucket,
      rulesBucket: props.rulesBucket,
      jobsTable: props.jobsTable,
      jobsQueue: props.jobsQueue,
      preflightRules: props.preflightRules,
    });

    const api = new PreflightApi(this, "Api", {
      corsAllowOrigins: props.frontendOrigins,
      authorizer,
      presignFunction: lambdas.presignFunction,
      createJobFunction: lambdas.createJobFunction,
      getJobFunction: lambdas.getJobFunction,
      getRulesFunction: lambdas.getRulesFunction,
      saveRulesFunction: lambdas.saveRulesFunction,
      deleteRulesFunction: lambdas.deleteRulesFunction,
      getResetDefaultsFunction: lambdas.getResetDefaultsFunction,
    });

    new cdk.CfnOutput(this, "PreflightApiUrl", {
      value: api.httpApi.apiEndpoint,
    });

    new cdk.CfnOutput(this, "CognitoUserPoolId", {
      value: userPool.userPoolId,
    });

    new cdk.CfnOutput(this, "CognitoUserPoolClientId", {
      value: userPoolClient.userPoolClientId,
    });

    new cdk.CfnOutput(this, "AwsRegion", {
      value: cdk.Stack.of(this).region,
    });

    new cdk.CfnOutput(this, "ApiKeyParameterName", {
      value: apiKeyParam.parameterName,
      description: "SSM parameter name containing the API key for backend-to-backend calls",
    });
  }
}
