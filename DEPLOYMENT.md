# デプロイメントガイド

## 🚀 クイックスタート

### 前提条件

- AWS アカウント
- AWS CLI 設定済み
- Node.js 18+
- Slack Bot Token
- X (Twitter) API Bearer Token

### 1. ローカルデプロイ

```bash
# 依存関係インストール
npm install

# AWS CDK CLI インストール
npm install -g aws-cdk

# AWS環境の確認
aws sts get-caller-identity

# CDKブートストラップ（初回のみ）
cdk bootstrap

# デプロイ実行
cdk deploy
```

### 2. GitHub Actions経由のデプロイ

1. GitHubリポジトリの Settings > Secrets and variables > Actions で認証情報を設定
2. mainブランチにプッシュすると自動デプロイ
3. または Actions タブから手動実行

## 📋 デプロイフロー

```mermaid
graph LR
    A[コード変更] --> B[Git Push]
    B --> C{ブランチ}
    C -->|main| D[GitHub Actions]
    C -->|feature| E[PR作成]
    E --> F[CI実行]
    F --> G[レビュー]
    G --> H[マージ]
    H --> D
    D --> I[テスト]
    I --> J[ビルド]
    J --> K[CDK Deploy]
    K --> L[AWS環境]
```

## 🔧 環境別設定

### 開発環境

```bash
# 環境変数設定
export CDK_DEPLOY_ACCOUNT=123456789012
export CDK_DEPLOY_REGION=ap-northeast-1
export ENVIRONMENT=development

# スタック名にサフィックスを付けてデプロイ
cdk deploy -c environment=dev
```

### 本番環境

```bash
# 本番用の設定
export ENVIRONMENT=production

# 変更確認
cdk diff

# 承認付きデプロイ
cdk deploy --require-approval broadening
```

## 📊 デプロイ後の確認

### 1. スタック出力の確認

```bash
# CloudFormationスタックの出力取得
aws cloudformation describe-stacks \
  --stack-name AiInsightsBotStack \
  --query 'Stacks[0].Outputs'
```

### 2. Lambda関数のテスト

```bash
# API Gateway経由でテスト実行
curl -X POST https://your-api-gateway-url/prod/collect

# Lambda関数の直接実行
aws lambda invoke \
  --function-name ai-insights-bot-collect-ai-news \
  --payload '{}' \
  response.json
```

### 3. ログの確認

```bash
# Lambda関数のログ表示
aws logs tail /aws/lambda/ai-insights-bot-collect-ai-news --follow

# 最新のログを取得
aws logs filter-log-events \
  --log-group-name /aws/lambda/ai-insights-bot-collect-ai-news \
  --start-time $(date -u -d '5 minutes ago' +%s)000
```

### 4. DynamoDBテーブル確認

```bash
# テーブル情報
aws dynamodb describe-table \
  --table-name ai-insights-bot-post-history

# アイテム数確認
aws dynamodb scan \
  --table-name ai-insights-bot-post-history \
  --select COUNT
```

## 🔐 Systems Manager パラメータ設定

デプロイ後、必ず以下のパラメータを設定してください：

```bash
# 1. Slack Bot Token
aws ssm put-parameter \
  --name "/ai-insights-bot/slack-bot-token" \
  --value "xoxb-your-token-here" \
  --type SecureString \
  --overwrite

# 2. Twitter Bearer Token
aws ssm put-parameter \
  --name "/ai-insights-bot/twitter-bearer-token" \
  --value "your-bearer-token" \
  --type SecureString \
  --overwrite

# 3. Slack Channel
aws ssm put-parameter \
  --name "/ai-insights-bot/slack-channel" \
  --value "#ai-news" \
  --type String \
  --overwrite

# パラメータ確認
aws ssm get-parameters \
  --names "/ai-insights-bot/slack-bot-token" \
          "/ai-insights-bot/twitter-bearer-token" \
          "/ai-insights-bot/slack-channel" \
  --with-decryption
```

## 🔄 更新デプロイ

### コード変更時

```bash
# 変更内容確認
cdk diff

# デプロイ
cdk deploy

# 特定のLambda関数のみ更新
aws lambda update-function-code \
  --function-name ai-insights-bot-collect-ai-news \
  --zip-file fileb://function.zip
```

### スケジュール変更

EventBridgeルールの更新:

```bash
# 既存ルールの無効化
aws events disable-rule --name ai-insights-bot-morning-schedule

# スケジュール変更（例: 毎時実行）
aws events put-rule \
  --name ai-insights-bot-hourly \
  --schedule-expression "rate(1 hour)"
```

## 🛠️ トラブルシューティング

### デプロイエラー

1. **CDK Bootstrap エラー**

   ```bash
   # 既存のブートストラップを削除
   aws cloudformation delete-stack --stack-name CDKToolkit
   # 再実行
   cdk bootstrap
   ```

2. **権限エラー**

   ```bash
   # 現在の権限確認
   aws iam get-user
   aws iam list-attached-user-policies --user-name your-user
   ```

3. **リソース制限**

   ```bash
   # Service Quotas確認
   aws service-quotas get-service-quota \
     --service-code lambda \
     --quota-code L-B99A9384
   ```

### Lambda関数のエラー

1. **タイムアウト**
   - メモリサイズを増やす: 512MB → 1024MB
   - タイムアウト時間を延長: 5分 → 10分

2. **メモリ不足**

   ```bash
   # メモリ使用状況確認
   aws logs filter-log-events \
     --log-group-name /aws/lambda/ai-insights-bot-collect-ai-news \
     --filter-pattern "[REPORT]"
   ```

3. **API制限**
   - Lambda同時実行数を調整
   - APIコール間隔を調整

## 📈 監視設定

### CloudWatch ダッシュボード

デプロイ後、自動的に作成されるダッシュボード:

- https://console.aws.amazon.com/cloudwatch/home#dashboards:name=ai-insights-bot-monitoring

### アラーム通知設定

```bash
# SNSトピックにメール購読追加
aws sns subscribe \
  --topic-arn $(aws sns list-topics --query 'Topics[?contains(TopicArn, `ai-insights-bot-alerts`)].TopicArn' --output text) \
  --protocol email \
  --notification-endpoint your-email@example.com
```

## 🔄 ロールバック

問題が発生した場合:

```bash
# 前のバージョンにロールバック
cdk deploy --rollback

# または CloudFormationから
aws cloudformation cancel-update-stack \
  --stack-name AiInsightsBotStack
```

## 📝 デプロイチェックリスト

### デプロイ前

- [ ] AWS認証情報設定済み
- [ ] 必要な権限がある
- [ ] テストが全てパス
- [ ] 環境変数の確認

### デプロイ後

- [ ] Systems Managerパラメータ設定
- [ ] API Gatewayエンドポイント動作確認
- [ ] EventBridgeスケジュール確認
- [ ] CloudWatchログ出力確認
- [ ] Slackチャンネルへの投稿テスト

### 本番デプロイ前

- [ ] ステージング環境でテスト済み
- [ ] ロールバック手順の確認
- [ ] 監視アラーム設定
- [ ] 関係者への通知
