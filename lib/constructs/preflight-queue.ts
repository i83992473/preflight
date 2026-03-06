import { Duration } from "aws-cdk-lib";
import * as sqs from "aws-cdk-lib/aws-sqs";
import { Construct } from "constructs";

export class PreflightQueue extends Construct {
  public readonly jobsQueue: sqs.Queue;
  public readonly jobsDlq: sqs.Queue;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.jobsDlq = new sqs.Queue(this, "PreflightJobsDlq", {
      queueName: "preflight-jobs-dlq",
      retentionPeriod: Duration.days(14),
      enforceSSL: true,
    });

    this.jobsQueue = new sqs.Queue(this, "PreflightJobsQueue", {
      queueName: "preflight-jobs",
      visibilityTimeout: Duration.minutes(2),
      retentionPeriod: Duration.days(4),
      deadLetterQueue: {
        maxReceiveCount: 5,
        queue: this.jobsDlq,
      },
      enforceSSL: true,
    });
  }
}
