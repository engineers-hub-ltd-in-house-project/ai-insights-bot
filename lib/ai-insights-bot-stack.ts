import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import { Construct } from 'constructs';

export class AiInsightsBotStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // =============================================================================
    // DynamoDB テーブル
    // =============================================================================

    const postHistoryTable = new dynamodb.Table(this, 'PostHistoryTable', {
      tableName: 'ai-insights-bot-post-history',
      partitionKey: { name: 'source_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.NUMBER },
      timeToLiveAttribute: 'ttl',
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // 開発環境用
    });

    // グローバルセカンダリインデックス
    postHistoryTable.addGlobalSecondaryIndex({
      indexName: 'source-timestamp-index',
      partitionKey: { name: 'source_type', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.NUMBER },
    });

    // =============================================================================
    // IAM ロール
    // =============================================================================

    const lambdaExecutionRole = new iam.Role(this, 'LambdaExecutionRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // Systems Manager Parameter Store アクセス権限
    lambdaExecutionRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['ssm:GetParameter', 'ssm:GetParameters', 'ssm:GetParametersByPath'],
        resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/ai-insights-bot/*`],
      })
    );

    // DynamoDB アクセス権限
    postHistoryTable.grantReadWriteData(lambdaExecutionRole);

    // CloudWatch Logs 権限
    lambdaExecutionRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
        resources: ['*'],
      })
    );

    // =============================================================================
    // Lambda 関数の共通設定
    // =============================================================================

    const commonLambdaProps = {
      runtime: lambda.Runtime.NODEJS_18_X,
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      role: lambdaExecutionRole,
      environment: {
        POST_HISTORY_TABLE: postHistoryTable.tableName,
        NODE_ENV: 'production',
        TZ: 'Asia/Tokyo',
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'es2020',
        externalModules: ['aws-sdk'],
      },
    };

    // =============================================================================
    // Lambda 関数: AI情報収集
    // =============================================================================

    const collectAINewsFunction = new nodejs.NodejsFunction(this, 'CollectAINewsFunction', {
      ...commonLambdaProps,
      functionName: 'ai-insights-bot-collect-ai-news',
      entry: 'lambda/collect-ai-news/index.ts',
      handler: 'handler',
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      reservedConcurrentExecutions: 3, // API制限を考慮
    });

    // =============================================================================
    // Lambda 関数: Slack投稿処理
    // =============================================================================

    const processAndPostFunction = new nodejs.NodejsFunction(this, 'ProcessAndPostFunction', {
      ...commonLambdaProps,
      functionName: 'ai-insights-bot-process-post',
      entry: 'lambda/process-and-post/index.ts',
      handler: 'handler',
      timeout: cdk.Duration.minutes(2),
      memorySize: 256,
    });

    // =============================================================================
    // EventBridge スケジューラー
    // =============================================================================

    // 平日朝の定期実行 (JST 9:00 = UTC 0:00)
    const morningSchedule = new events.Rule(this, 'MorningScheduleRule', {
      ruleName: 'ai-insights-bot-morning-schedule',
      description: 'AI情報収集 - 平日朝9時',
      schedule: events.Schedule.cron({
        minute: '0',
        hour: '0', // UTC 0:00 = JST 9:00
        weekDay: 'MON-FRI',
      }),
      enabled: true,
    });

    morningSchedule.addTarget(
      new targets.LambdaFunction(collectAINewsFunction, {
        event: events.RuleTargetInput.fromObject({
          source: 'eventbridge',
          schedule: 'morning',
          timestamp: events.Schedule.rate(cdk.Duration.days(1)),
        }),
      })
    );

    // 平日夕方の定期実行 (JST 18:00 = UTC 9:00)
    const eveningSchedule = new events.Rule(this, 'EveningScheduleRule', {
      ruleName: 'ai-insights-bot-evening-schedule',
      description: 'AI情報収集 - 平日夕方6時',
      schedule: events.Schedule.cron({
        minute: '0',
        hour: '9', // UTC 9:00 = JST 18:00
        weekDay: 'MON-FRI',
      }),
      enabled: true,
    });

    eveningSchedule.addTarget(new targets.LambdaFunction(collectAINewsFunction));

    // 土曜日の定期実行 (JST 10:00 = UTC 1:00)
    const weekendSchedule = new events.Rule(this, 'WeekendScheduleRule', {
      ruleName: 'ai-insights-bot-weekend-schedule',
      description: 'AI情報収集 - 土曜日朝10時',
      schedule: events.Schedule.cron({
        minute: '0',
        hour: '1', // UTC 1:00 = JST 10:00
        weekDay: 'SAT',
      }),
      enabled: true,
    });

    weekendSchedule.addTarget(new targets.LambdaFunction(collectAINewsFunction));

    // 週次サマリー実行 (毎週日曜日 JST 19:00 = UTC 10:00)
    const weeklySummarySchedule = new events.Rule(this, 'WeeklySummaryScheduleRule', {
      ruleName: 'ai-insights-bot-weekly-summary',
      description: 'AI情報週次サマリー - 日曜日夜7時',
      schedule: events.Schedule.cron({
        minute: '0',
        hour: '10', // UTC 10:00 = JST 19:00
        weekDay: 'SUN',
      }),
      enabled: true,
    });

    weeklySummarySchedule.addTarget(
      new targets.LambdaFunction(processAndPostFunction, {
        event: events.RuleTargetInput.fromObject({
          source: 'eventbridge',
          type: 'weekly-summary',
          timestamp: new Date().toISOString(),
        }),
      })
    );

    // =============================================================================
    // API Gateway: 手動実行エンドポイント
    // =============================================================================

    const api = new apigateway.RestApi(this, 'AiInsightsBotAPI', {
      restApiName: 'ai-insights-bot-api',
      description: 'AI Insights Bot 手動実行API',
      deployOptions: {
        stageName: 'prod',
        throttlingRateLimit: 10,
        throttlingBurstLimit: 20,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    });

    // Lambda統合設定
    const collectIntegration = new apigateway.LambdaIntegration(collectAINewsFunction, {
      requestTemplates: {
        'application/json': JSON.stringify({
          source: 'api-gateway',
          body: '$input.body',
          headers: '$input.params().header',
        }),
      },
      integrationResponses: [
        {
          statusCode: '200',
        },
      ],
    });

    // エンドポイント設定
    const collectResource = api.root.addResource('collect');
    collectResource.addMethod('POST', collectIntegration, {
      methodResponses: [
        {
          statusCode: '200',
        },
      ],
    });

    // 週次サマリーエンドポイント
    const summaryIntegration = new apigateway.LambdaIntegration(processAndPostFunction, {
      requestTemplates: {
        'application/json': JSON.stringify({
          source: 'api-gateway',
          type: 'manual-summary',
          body: '$input.body',
        }),
      },
    });

    const summaryResource = api.root.addResource('summary');
    summaryResource.addMethod('POST', summaryIntegration, {
      methodResponses: [
        {
          statusCode: '200',
        },
      ],
    });

    // ヘルスチェックエンドポイント
    const healthResource = api.root.addResource('health');
    healthResource.addMethod(
      'GET',
      new apigateway.MockIntegration({
        integrationResponses: [
          {
            statusCode: '200',
            responseTemplates: {
              'application/json': JSON.stringify({
                status: 'OK',
                timestamp: '$context.requestTime',
              }),
            },
          },
        ],
      }),
      {
        methodResponses: [
          {
            statusCode: '200',
          },
        ],
      }
    );

    // =============================================================================
    // CloudWatch アラーム
    // =============================================================================

    // SNSトピック（アラート通知用）
    const alertTopic = new sns.Topic(this, 'AlertTopic', {
      topicName: 'ai-insights-bot-alerts',
      displayName: 'AI Insights Bot Alerts',
    });

    // Lambda関数エラー率アラーム
    const lambdaErrorAlarm = new cloudwatch.Alarm(this, 'LambdaErrorAlarm', {
      alarmName: 'ai-insights-bot-lambda-errors',
      alarmDescription: 'Lambda関数のエラー率が高い',
      metric: collectAINewsFunction.metricErrors({
        period: cdk.Duration.minutes(5),
      }),
      threshold: 3,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    });

    lambdaErrorAlarm.addAlarmAction(new cloudwatchActions.SnsAction(alertTopic));

    // DynamoDB スロットリングアラーム
    const dynamoThrottleAlarm = new cloudwatch.Alarm(this, 'DynamoThrottleAlarm', {
      alarmName: 'ai-insights-bot-dynamo-throttle',
      alarmDescription: 'DynamoDB スロットリング発生',
      metric: postHistoryTable.metricThrottledRequests({
        period: cdk.Duration.minutes(5),
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    });

    dynamoThrottleAlarm.addAlarmAction(new cloudwatchActions.SnsAction(alertTopic));

    // API Gateway 4xx/5xx エラーアラーム
    const apiErrorAlarm = new cloudwatch.Alarm(this, 'APIErrorAlarm', {
      alarmName: 'ai-insights-bot-api-errors',
      alarmDescription: 'API Gateway エラー率が高い',
      metric: api.metricClientError({
        period: cdk.Duration.minutes(5),
      }),
      threshold: 5,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    });

    apiErrorAlarm.addAlarmAction(new cloudwatchActions.SnsAction(alertTopic));

    // =============================================================================
    // CloudWatch ダッシュボード
    // =============================================================================

    const dashboard = new cloudwatch.Dashboard(this, 'AiInsightsBotDashboard', {
      dashboardName: 'ai-insights-bot-monitoring',
    });

    // Lambda関数メトリクス
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Lambda実行回数',
        left: [collectAINewsFunction.metricInvocations()],
        period: cdk.Duration.hours(1),
        width: 12,
        height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'Lambda実行時間',
        left: [collectAINewsFunction.metricDuration()],
        period: cdk.Duration.hours(1),
        width: 12,
        height: 6,
      })
    );

    // DynamoDB メトリクス
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'DynamoDB 読み書き',
        left: [
          postHistoryTable.metricConsumedReadCapacityUnits(),
          postHistoryTable.metricConsumedWriteCapacityUnits(),
        ],
        period: cdk.Duration.hours(1),
        width: 12,
        height: 6,
      })
    );

    // =============================================================================
    // Outputs
    // =============================================================================

    new cdk.CfnOutput(this, 'APIEndpoint', {
      value: api.url,
      description: 'API Gateway エンドポイント',
    });

    new cdk.CfnOutput(this, 'DynamoDBTableName', {
      value: postHistoryTable.tableName,
      description: 'DynamoDB テーブル名',
    });

    new cdk.CfnOutput(this, 'CollectFunctionName', {
      value: collectAINewsFunction.functionName,
      description: 'AI情報収集Lambda関数名',
    });

    new cdk.CfnOutput(this, 'AlertTopicArn', {
      value: alertTopic.topicArn,
      description: 'アラート通知SNSトピック',
    });

    // 設定確認用の出力
    new cdk.CfnOutput(this, 'ScheduleInfo', {
      value: JSON.stringify({
        morning: 'Weekdays 9:00 JST',
        evening: 'Weekdays 18:00 JST',
        weekend: 'Saturday 10:00 JST',
      }),
      description: '実行スケジュール情報',
    });
  }
}
