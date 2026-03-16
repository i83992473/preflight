import { Duration } from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as sqs from "aws-cdk-lib/aws-sqs";
import { Construct } from "constructs";
import * as path from "path";
import type { PreflightRules } from "../contracts";
import { DEFAULT_PREFLIGHT_RULES, normalizePreflightRules } from "../preflight-rules";

export interface PreflightLambdasProps {
  uploadsTempBucket: s3.IBucket;
  uploadsApprovedBucket: s3.IBucket;
  uploadsQuarantineBucket: s3.IBucket;
  rulesBucket: s3.IBucket;
  jobsTable: dynamodb.ITable;
  jobsQueue: sqs.IQueue;
  preflightRules?: Partial<PreflightRules>;
}

export class PreflightLambdas extends Construct {
  public readonly presignFunction: NodejsFunction;
  public readonly createJobFunction: NodejsFunction;
  public readonly getJobFunction: NodejsFunction;
  public readonly getRulesFunction: NodejsFunction;
  public readonly saveRulesFunction: NodejsFunction;
  public readonly workerFunction: NodejsFunction;

  constructor(scope: Construct, id: string, props: PreflightLambdasProps) {
    super(scope, id);

    const configuredPreflightRules: PreflightRules = normalizePreflightRules({
      ...DEFAULT_PREFLIGHT_RULES,
      ...(props.preflightRules ?? {}),
    });

    const commonFunctionProps = {
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(30),
      memorySize: 512,
      bundling: {
        minify: true,
        sourceMap: true,
      },
    };

    this.presignFunction = new NodejsFunction(this, "PresignFunction", {
      ...commonFunctionProps,
      entry: path.join(__dirname, "../../lambda/presign.ts"),
      handler: "handler",
      environment: {
        UPLOADS_TEMP_BUCKET: props.uploadsTempBucket.bucketName,
        PRESIGN_EXPIRES_SECONDS: "900",
        ALLOWED_MIME_TYPES: configuredPreflightRules.allowedMimeTypes.join(","),
        MIN_FILE_SIZE_BYTES: String(configuredPreflightRules.minFileSizeBytes),
        MAX_FILE_SIZE_BYTES:
          configuredPreflightRules.maxFileSizeBytes == null
            ? ""
            : String(configuredPreflightRules.maxFileSizeBytes),
      },
    });

    this.createJobFunction = new NodejsFunction(this, "CreateJobFunction", {
      ...commonFunctionProps,
      entry: path.join(__dirname, "../../lambda/create-job.ts"),
      handler: "handler",
      environment: {
        JOBS_TABLE_NAME: props.jobsTable.tableName,
        JOBS_QUEUE_URL: props.jobsQueue.queueUrl,
      },
    });

    this.getJobFunction = new NodejsFunction(this, "GetJobFunction", {
      ...commonFunctionProps,
      entry: path.join(__dirname, "../../lambda/get-job.ts"),
      handler: "handler",
      environment: {
        JOBS_TABLE_NAME: props.jobsTable.tableName,
      },
    });

    this.getRulesFunction = new NodejsFunction(this, "GetRulesFunction", {
      ...commonFunctionProps,
      entry: path.join(__dirname, "../../lambda/get-rules.ts"),
      handler: "handler",
      environment: {
        RULES_BUCKET: props.rulesBucket.bucketName,
      },
    });

    this.saveRulesFunction = new NodejsFunction(this, "SaveRulesFunction", {
      ...commonFunctionProps,
      entry: path.join(__dirname, "../../lambda/save-rules.ts"),
      handler: "handler",
      environment: {
        RULES_BUCKET: props.rulesBucket.bucketName,
      },
    });

    this.workerFunction = new NodejsFunction(this, "WorkerFunction", {
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.minutes(2),
      memorySize: 1024,
      entry: path.join(__dirname, "../../lambda/worker.ts"),
      handler: "handler",
      bundling: {
        minify: true,
        sourceMap: true,
      },
      environment: {
        JOBS_TABLE_NAME: props.jobsTable.tableName,
        UPLOADS_TEMP_BUCKET: props.uploadsTempBucket.bucketName,
        UPLOADS_APPROVED_BUCKET: props.uploadsApprovedBucket.bucketName,
        UPLOADS_QUARANTINE_BUCKET: props.uploadsQuarantineBucket.bucketName,
        RULES_BUCKET: props.rulesBucket.bucketName,
        PREFLIGHT_RULES_JSON: JSON.stringify(configuredPreflightRules),
        PDF_DEEP_MODE: "true",
      },
    });

    this.workerFunction.addEventSource(
      new SqsEventSource(props.jobsQueue, {
        batchSize: 5,
        maxBatchingWindow: Duration.seconds(10),
      }),
    );

    props.uploadsTempBucket.grantPut(this.presignFunction);

    props.jobsTable.grantReadWriteData(this.createJobFunction);
    props.jobsQueue.grantSendMessages(this.createJobFunction);

    props.jobsTable.grantReadData(this.getJobFunction);

    props.rulesBucket.grantRead(this.getRulesFunction);
    props.rulesBucket.grantReadWrite(this.saveRulesFunction);

    props.jobsQueue.grantConsumeMessages(this.workerFunction);
    props.jobsTable.grantReadWriteData(this.workerFunction);
    props.rulesBucket.grantRead(this.workerFunction);
    props.uploadsTempBucket.grantRead(this.workerFunction);
    props.uploadsTempBucket.grantDelete(this.workerFunction);
    props.uploadsApprovedBucket.grantWrite(this.workerFunction);
    props.uploadsQuarantineBucket.grantWrite(this.workerFunction);
  }
}
