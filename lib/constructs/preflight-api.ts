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
  updateRulesFunction: IFunction;
}

export class PreflightApi extends Construct {
  public readonly httpApi: apigwv2.HttpApi;

  constructor(scope: Construct, id: string, props: PreflightApiProps) {
    super(scope, id);

    this.httpApi = new apigwv2.HttpApi(this, "PreflightHttpApi", {
      apiName: "preflight-api",
      corsPreflight: {
        allowHeaders: ["authorization", "content-type"],
        allowMethods: [apigwv2.CorsHttpMethod.GET, apigwv2.CorsHttpMethod.POST, apigwv2.CorsHttpMethod.PUT],
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
      path: "/preflight/rules",
      methods: [apigwv2.HttpMethod.GET],
      integration: new HttpLambdaIntegration("GetRulesIntegration", props.getRulesFunction),
      authorizer: props.authorizer,
    });

    this.httpApi.addRoutes({
      path: "/preflight/rules",
      methods: [apigwv2.HttpMethod.PUT],
      integration: new HttpLambdaIntegration("UpdateRulesIntegration", props.updateRulesFunction),
      authorizer: props.authorizer,
    });
  }
}
