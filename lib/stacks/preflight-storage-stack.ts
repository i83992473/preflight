import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as sqs from "aws-cdk-lib/aws-sqs";
import { Construct } from "constructs";
import { PreflightBuckets } from "../constructs/preflight-buckets";
import { PreflightData } from "../constructs/preflight-data";
import { PreflightQueue } from "../constructs/preflight-queue";

export interface PreflightStorageStackProps extends cdk.StackProps {
  environment: string;
  frontendOrigins: string[];
}

export class PreflightStorageStack extends cdk.Stack {
  public readonly uploadsTempBucket: s3.Bucket;
  public readonly uploadsApprovedBucket: s3.Bucket;
  public readonly uploadsQuarantineBucket: s3.Bucket;
  public readonly jobsTable: dynamodb.Table;
  public readonly rulesTable: dynamodb.Table;
  public readonly jobsQueue: sqs.Queue;

  constructor(scope: Construct, id: string, props: PreflightStorageStackProps) {
    super(scope, id, props);

    const buckets = new PreflightBuckets(this, "Buckets", {
      environment: props.environment,
      corsAllowedOrigins: props.frontendOrigins,
      tempRetentionDays: 14,
      quarantineRetentionDays: 30,
    });

    const data = new PreflightData(this, "Data");
    const queue = new PreflightQueue(this, "Queue");

    this.uploadsTempBucket = buckets.uploadsTempBucket;
    this.uploadsApprovedBucket = buckets.uploadsApprovedBucket;
    this.uploadsQuarantineBucket = buckets.uploadsQuarantineBucket;
    this.jobsTable = data.jobsTable;
    this.rulesTable = data.rulesTable;
    this.jobsQueue = queue.jobsQueue;

    new cdk.CfnOutput(this, "UploadsTempBucketName", {
      value: this.uploadsTempBucket.bucketName,
    });

    new cdk.CfnOutput(this, "UploadsApprovedBucketName", {
      value: this.uploadsApprovedBucket.bucketName,
    });

    new cdk.CfnOutput(this, "UploadsQuarantineBucketName", {
      value: this.uploadsQuarantineBucket.bucketName,
    });

    new cdk.CfnOutput(this, "JobsTableName", {
      value: this.jobsTable.tableName,
    });

    new cdk.CfnOutput(this, "RulesTableName", {
      value: this.rulesTable.tableName,
    });

    new cdk.CfnOutput(this, "JobsQueueName", {
      value: this.jobsQueue.queueName,
    });
  }
}
