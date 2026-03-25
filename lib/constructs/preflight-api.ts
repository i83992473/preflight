import * as cdk from "aws-cdk-lib";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { IFunction } from "aws-cdk-lib/aws-lambda";
import { Construct } from "constructs";

export interface PreflightApiProps {
  corsAllowOrigins: string[];
  authorizer: apigwv2.IHttpRouteAuthorizer;
  presignFunction: IFunction;
  createJobFunction: IFunction;
  getJobFunction: IFunction;
  getRulesFunction: IFunction;
  saveRulesFunction: IFunction;
  deleteRulesFunction: IFunction;
  getResetDefaultsFunction: IFunction;
}

export class PreflightApi extends Construct {
  public readonly httpApi: apigwv2.HttpApi;

  constructor(scope: Construct, id: string, props: PreflightApiProps) {
    super(scope, id);

    this.httpApi = new apigwv2.HttpApi(this, "PreflightHttpApi", {
      apiName: "preflight-api",
      corsPreflight: {
        allowHeaders: ["authorization", "content-type", "x-api-key"],
        allowMethods: [apigwv2.CorsHttpMethod.GET, apigwv2.CorsHttpMethod.POST, apigwv2.CorsHttpMethod.PUT, apigwv2.CorsHttpMethod.DELETE],
        allowOrigins: props.corsAllowOrigins,
        maxAge: cdk.Duration.hours(1),
      },
    });

    this.httpApi.addRoutes({
      path: "/uploads/presign",
      methods: [apigwv2.HttpMethod.POST],
      integration: new HttpLambdaIntegration("PresignIntegration", props.presignFunction),
      authorizer: props.authorizer,
    });

    this.httpApi.addRoutes({
      path: "/preflight/jobs",
      methods: [apigwv2.HttpMethod.POST],
      integration: new HttpLambdaIntegration("CreateJobIntegration", props.createJobFunction),
      authorizer: props.authorizer,
    });

    this.httpApi.addRoutes({
      path: "/preflight/jobs/{jobId}",
      methods: [apigwv2.HttpMethod.GET],
      integration: new HttpLambdaIntegration("GetJobIntegration", props.getJobFunction),
      authorizer: props.authorizer,
    });

    this.httpApi.addRoutes({
      path: "/preflight/rules/defaults",
      methods: [apigwv2.HttpMethod.GET],
      integration: new HttpLambdaIntegration("GetResetDefaultsIntegration", props.getResetDefaultsFunction),
      authorizer: props.authorizer,
    });

    this.httpApi.addRoutes({
      path: "/preflight/rules/{tenantId}",
      methods: [apigwv2.HttpMethod.GET],
      integration: new HttpLambdaIntegration("GetRulesIntegration", props.getRulesFunction),
      authorizer: props.authorizer,
    });

    this.httpApi.addRoutes({
      path: "/preflight/rules/{tenantId}/{productId}",
      methods: [apigwv2.HttpMethod.GET],
      integration: new HttpLambdaIntegration("GetRulesProductIntegration", props.getRulesFunction),
      authorizer: props.authorizer,
    });

    this.httpApi.addRoutes({
      path: "/preflight/rules/{tenantId}",
      methods: [apigwv2.HttpMethod.PUT],
      integration: new HttpLambdaIntegration("SaveRulesIntegration", props.saveRulesFunction),
      authorizer: props.authorizer,
    });

    this.httpApi.addRoutes({
      path: "/preflight/rules/{tenantId}/{productId}",
      methods: [apigwv2.HttpMethod.PUT],
      integration: new HttpLambdaIntegration("SaveRulesProductIntegration", props.saveRulesFunction),
      authorizer: props.authorizer,
    });

    this.httpApi.addRoutes({
      path: "/preflight/rules/{tenantId}",
      methods: [apigwv2.HttpMethod.DELETE],
      integration: new HttpLambdaIntegration("DeleteRulesIntegration", props.deleteRulesFunction),
      authorizer: props.authorizer,
    });

    this.httpApi.addRoutes({
      path: "/preflight/rules/{tenantId}/{productId}",
      methods: [apigwv2.HttpMethod.DELETE],
      integration: new HttpLambdaIntegration("DeleteRulesProductIntegration", props.deleteRulesFunction),
      authorizer: props.authorizer,
    });
  }
}
