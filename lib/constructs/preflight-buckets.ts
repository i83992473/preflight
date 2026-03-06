import { Duration, RemovalPolicy } from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

export interface PreflightBucketsProps {
  environment: string;
  corsAllowedOrigins: string[];
  tempRetentionDays?: number;
  quarantineRetentionDays?: number;
}

export class PreflightBuckets extends Construct {
  public readonly uploadsTempBucket: s3.Bucket;
  public readonly uploadsApprovedBucket: s3.Bucket;
  public readonly uploadsQuarantineBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: PreflightBucketsProps) {
    super(scope, id);

    const commonConfig: Partial<s3.BucketProps> = {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.RETAIN,
      versioned: true,
    };

    this.uploadsTempBucket = new s3.Bucket(this, "UploadsTempBucket", {
      ...commonConfig,
      bucketName: `preflight-uploads-temp-${props.environment}`,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.PUT],
          allowedOrigins: props.corsAllowedOrigins,
          allowedHeaders: ["*"],
          exposedHeaders: ["ETag"],
          maxAge: 3600,
        },
      ],
      lifecycleRules: [
        {
          expiration: Duration.days(props.tempRetentionDays ?? 14),
        },
      ],
    });

    this.uploadsApprovedBucket = new s3.Bucket(this, "UploadsApprovedBucket", {
      ...commonConfig,
      bucketName: `preflight-uploads-approved-${props.environment}`,
    });

    this.uploadsQuarantineBucket = new s3.Bucket(this, "UploadsQuarantineBucket", {
      ...commonConfig,
      bucketName: `preflight-uploads-quarantine-${props.environment}`,
      lifecycleRules: [
        {
          expiration: Duration.days(props.quarantineRetentionDays ?? 30),
        },
      ],
    });
  }
}
