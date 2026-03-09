import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as cognito from "aws-cdk-lib/aws-cognito";
import { HttpUserPoolAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as sqs from "aws-cdk-lib/aws-sqs";
import { Construct } from "constructs";
import { PreflightApi } from "../constructs/preflight-api";
import { PreflightLambdas } from "../constructs/preflight-lambdas";
import type { PreflightRules } from "../contracts";

export interface PreflightApiStackProps extends cdk.StackProps {
  environment: string;
  frontendOrigins: string[];
  uploadsTempBucket: s3.IBucket;
  uploadsApprovedBucket: s3.IBucket;
  uploadsQuarantineBucket: s3.IBucket;
  jobsTable: dynamodb.ITable;
  rulesTable: dynamodb.ITable;
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
    });

    const authorizer = new HttpUserPoolAuthorizer("PreflightApiAuthorizer", userPool, {
      userPoolClients: [userPoolClient],
    });

    const lambdas = new PreflightLambdas(this, "Lambdas", {
      uploadsTempBucket: props.uploadsTempBucket,
      uploadsApprovedBucket: props.uploadsApprovedBucket,
      uploadsQuarantineBucket: props.uploadsQuarantineBucket,
      jobsTable: props.jobsTable,
      rulesTable: props.rulesTable,
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
      updateRulesFunction: lambdas.updateRulesFunction,
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
  }
}
