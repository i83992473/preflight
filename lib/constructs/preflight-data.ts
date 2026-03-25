import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import { Construct } from "constructs";

export class PreflightData extends Construct {
  public readonly jobsTable: dynamodb.Table;
  // Retained temporarily so CloudFormation keeps the cross-stack export
  // until PreflightApi-dev stops importing it. Remove after next deploy cycle.
  public readonly rulesTable: dynamodb.Table;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.rulesTable = new dynamodb.Table(this, "PreflightRulesTable", {
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      deletionProtection: true,
    });

    this.jobsTable = new dynamodb.Table(this, "PreflightJobsTable", {
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
      timeToLiveAttribute: "ttl",
      deletionProtection: true,
    });

    this.jobsTable.addGlobalSecondaryIndex({
      indexName: "GSI1",
      partitionKey: { name: "GSI1PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "GSI1SK", type: dynamodb.AttributeType.STRING },
    });
  }
}
