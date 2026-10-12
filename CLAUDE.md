# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI Insights Bot は AWS CDK と TypeScript で構築されたサーバーレスアプリケーションです。AI関連の情報を Twitter/X、RSS フィード、GitHub から自動収集し、Slack チャンネルに投稿します。

## Essential Commands

```bash
# Development
npm run build          # TypeScript をコンパイル
npm run watch         # ファイル変更を監視して自動コンパイル
npm run test          # Jest テストを実行
npm run lint          # ESLint でコードをチェック
npm run lint:fix      # ESLint エラーを自動修正
npm run format        # Prettier でフォーマットをチェック
npm run format:fix    # Prettier でフォーマットを自動修正
npm run check         # 全てのチェック（lint, format, test, build）を実行
npm run fix           # 全ての自動修正可能な問題を修正

# AWS CDK
cdk synth             # CloudFormation テンプレートを生成
cdk diff              # デプロイされる変更を確認
cdk deploy            # AWS にデプロイ
cdk destroy           # スタックを削除

# Testing specific files
npm test -- lambda/collect-ai-news/index.test.ts  # 特定のテストファイルを実行
npm test -- --coverage                             # カバレッジレポート付きでテスト実行
```

## Architecture Overview

### Infrastructure Stack (`lib/ai-insights-bot-stack.ts`)

CDK スタックは以下のリソースを定義：

- **DynamoDB テーブル**: 投稿履歴を保存（重複防止用）、TTL 30日
- **Lambda 関数**:
  - `CollectAINewsFunction`: AI情報収集（512MB、5分タイムアウト）
  - `ProcessAndPostFunction`: 週次サマリー生成（256MB、2分タイムアウト）
- **EventBridge ルール**: 定期実行スケジュール（平日朝夕、土曜朝、日曜夜）
- **API Gateway**: 手動実行用エンドポイント（`/collect`, `/summary`, `/health`）
- **CloudWatch**: ダッシュボード、アラーム、ログ
- **SNS**: アラート通知

### Lambda Functions Structure

```text
lambda/
├── collect-ai-news/index.ts    # メイン収集ロジック
│   ├── TwitterClient          # Twitter API v2 統合
│   ├── RSSClient             # RSS フィード解析
│   ├── GitHubTrending        # GitHub トレンドリポジトリ
│   ├── DeduplicationService  # DynamoDB での重複チェック
│   └── SlackClient           # Slack 投稿
└── process-and-post/index.ts   # 週次サマリー機能
```

### Key Design Patterns

1. **環境変数と設定管理**
   - AWS Systems Manager Parameter Store を使用
   - `/ai-insights-bot/slack-bot-token` (SecureString)
   - `/ai-insights-bot/twitter-bearer-token` (SecureString)
   - `/ai-insights-bot/slack-channel` (String)

2. **エラーハンドリング**
   - 各外部 API コールは個別の try-catch
   - 一部の API 失敗は全体の処理を止めない
   - CloudWatch Logs に構造化ログを出力

3. **レート制限対策**
   - Lambda の同時実行数を 3 に制限
   - API コール間に sleep を挿入
   - Twitter API は重要アカウント5件、キーワード2件まで

4. **型安全性**
   - TypeScript strict モード有効
   - Slack API の Block 型を使用
   - 外部 API レスポンスに interface を定義

## Development Workflow

### Git Hooks (Lefthook)

コミット前に自動実行：

- TypeScript 型チェック
- ESLint（自動修正付き）
- Prettier フォーマット
- Markdownlint

プッシュ前に自動実行：

- テスト実行
- ビルド確認
- CDK synth

### CI/CD (GitHub Actions)

1. **CI ワークフロー** (`/.github/workflows/ci.yml`)
   - Lint と Test
   - CDK Synthesis
   - Security Check (Trivy)

2. **Deploy ワークフロー** (`/.github/workflows/deploy.yml`)
   - AWS 認証（OIDC または Access Key）
   - テスト実行
   - CDK Deploy
   - デプロイメントサマリー

### Code Quality Rules

- ESLint: TypeScript recommended + カスタムルール
- Prettier: 100文字制限、シングルクォート、末尾カンマ
- コミットメッセージ: Conventional Commits 形式
- 非 null アサーション (`!`) の使用を避ける
- `any` 型の使用を避ける

## Testing Strategy

```typescript
// Lambda 関数のテスト例
describe('CollectAINewsFunction', () => {
  it('should collect tweets from AI accounts', async () => {
    // AWS SDK クライアントをモック
    // 外部 API をモック
    // ハンドラーを実行
    // 結果を検証
  });
});
```

CDK スタックのテストは snapshot testing を使用。

## Deployment Process

1. **初回セットアップ**

   ```bash
   npm install
   aws configure  # AWS 認証設定
   cdk bootstrap  # CDK 初期化（アカウントごとに1回）
   ```

2. **パラメータ設定**

   ```bash
   aws ssm put-parameter --name "/ai-insights-bot/slack-bot-token" --value "xoxb-..." --type SecureString
   aws ssm put-parameter --name "/ai-insights-bot/twitter-bearer-token" --value "..." --type SecureString
   aws ssm put-parameter --name "/ai-insights-bot/slack-channel" --value "#ai-news" --type String
   ```

3. **デプロイ**

   ```bash
   cdk diff    # 変更確認
   cdk deploy  # デプロイ実行
   ```

## Common Issues and Solutions

1. **TypeScript ビルドエラー**: `npm run build` でエラー詳細を確認
2. **CDK synth エラー**: 環境変数 `AWS_REGION` が設定されているか確認
3. **Lambda タイムアウト**: CloudWatch Logs でメモリ使用量を確認、必要に応じて増量
4. **API レート制限**: Lambda の予約同時実行数を調整、API コール間隔を増やす

## Important Files

- `lib/ai-insights-bot-stack.ts`: インフラ定義の中心
- `lambda/collect-ai-news/index.ts`: メインビジネスロジック
- `cdk.json`: CDK 設定とコンテキスト
- `lefthook.yml`: Git フック設定
- `.github/workflows/`: CI/CD パイプライン定義
