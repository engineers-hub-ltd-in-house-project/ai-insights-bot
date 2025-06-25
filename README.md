# AI Insights Bot

AWS CDK + TypeScript で構築した、AI関連情報を自動収集してSlackに投稿するサーバーレスアプリケーションです。

## 🚀 機能

- **自動情報収集**: X (Twitter)、RSS、GitHubから最新のAI関連情報を収集
- **定期実行**: EventBridgeによる定期的な情報収集（平日朝夕、土曜朝）
- **重複防止**: DynamoDBを使用した投稿履歴管理
- **Slack連携**: 収集した情報を整形してSlackチャンネルに投稿
- **手動実行**: API Gateway経由での手動実行サポート
- **監視**: CloudWatchアラームとダッシュボードによる運用監視

## 📋 前提条件

- Node.js 18 以上
- AWS CLI 設定済み
- AWS アカウント
- Slack Bot Token
- X (Twitter) API Bearer Token

## 🛠️ セットアップ

### 1. 依存関係インストール

```bash
npm install
```

### 2. AWS Systems Manager パラメータ設定

以下のパラメータをAWS Systems Manager Parameter Storeに設定してください：

```bash
# Slack Bot Token
aws ssm put-parameter \
  --name "/ai-insights-bot/slack-bot-token" \
  --value "xoxb-your-slack-bot-token" \
  --type SecureString

# X API Bearer Token
aws ssm put-parameter \
  --name "/ai-insights-bot/twitter-bearer-token" \
  --value "your-twitter-bearer-token" \
  --type SecureString

# Slack投稿先チャンネル
aws ssm put-parameter \
  --name "/ai-insights-bot/slack-channel" \
  --value "#ai-news" \
  --type String
```

### 3. CDKブートストラップ（初回のみ）

```bash
cdk bootstrap
```

### 4. デプロイ

```bash
# 差分確認
cdk diff

# デプロイ実行
cdk deploy
```

## 📂 プロジェクト構造

```
ai-insights-bot/
├── lib/
│   └── ai-insights-bot-stack.ts    # CDKスタック定義
├── lambda/
│   ├── collect-ai-news/            # AI情報収集Lambda
│   │   └── index.ts
│   ├── process-and-post/           # Slack投稿Lambda
│   │   └── index.ts
│   └── shared/                     # 共通コード
├── test/                           # テストファイル
├── cdk.json                        # CDK設定
├── package.json                    # プロジェクト設定
└── tsconfig.json                   # TypeScript設定
```

## 🏗️ アーキテクチャ

### コンポーネント

1. **Lambda Functions**
   - `CollectAINewsFunction`: AI情報収集メイン処理
   - `ProcessAndPostFunction`: データ処理・Slack投稿（将来的な拡張用）

2. **DynamoDB**
   - 投稿履歴の管理と重複防止
   - TTL設定により30日で自動削除

3. **EventBridge**
   - 定期実行スケジュール管理
   - 平日朝9時、夕方6時、土曜日10時（JST）

4. **API Gateway**
   - 手動実行用RESTエンドポイント
   - ヘルスチェックエンドポイント

5. **CloudWatch**
   - ログ収集と監視
   - アラーム設定とダッシュボード

## 📊 監視・運用

### CloudWatch アラーム

- Lambda関数エラー率監視
- DynamoDBスロットリング監視
- API Gatewayエラー率監視

### ログ確認

```bash
# Lambda関数のログを確認
aws logs tail /aws/lambda/ai-insights-bot-collect-ai-news --follow
```

### 手動実行

```bash
# API Gateway経由で手動実行
curl -X POST https://your-api-gateway-url/prod/collect
```

## 💰 コスト見積もり

月額（1日3回実行の場合）:

- Lambda: 約 $0.50
- DynamoDB: 約 $1.00
- EventBridge: 約 $0.10
- CloudWatch: 約 $0.50
- **合計**: 約 $2.10/月

## 🔧 カスタマイズ

### 情報収集ソースの追加

`lambda/collect-ai-news/index.ts` で新しいソースを追加：

```typescript
// 新しいソースクラスを作成
class NewSourceClient {
  async getLatestContent(): Promise<AIContent[]> {
    // 実装
  }
}
```

### スケジュールの変更

`lib/ai-insights-bot-stack.ts` でEventBridgeルールを編集：

```typescript
const customSchedule = new events.Rule(this, 'CustomSchedule', {
  schedule: events.Schedule.cron({
    minute: '0',
    hour: '12',
    weekDay: 'MON-FRI',
  }),
});
```

## 🚨 トラブルシューティング

### Lambda関数がタイムアウトする

- メモリサイズを増やす（現在: 512MB）
- タイムアウト時間を延長（現在: 5分）

### Slack投稿が失敗する

- Slack Bot Tokenの権限を確認
- チャンネルへの投稿権限があるか確認

### API制限エラー

- Lambda関数の同時実行数を調整（現在: 3）
- API呼び出し間隔を調整

## 📝 ライセンス

このプロジェクトはMITライセンスの下で公開されています。

## 🤝 貢献

プルリクエストを歓迎します。大きな変更の場合は、まずissueを作成して変更内容を説明してください。
