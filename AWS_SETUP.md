# AWS セットアップガイド

## 🔐 AWS認証情報の設定

### 方法1: GitHub OIDC (推奨)

AWS IAMでGitHub ActionsからのOIDC認証を設定することで、長期的な認証情報を保存する必要がなくなります。

#### 1. OIDC プロバイダーの作成

```bash
# AWS CLIで実行
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1
```

#### 2. IAMロールの作成

以下の信頼ポリシーでIAMロールを作成:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::YOUR_ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:engineers-hub-ltd-in-house-project/ai-insights-bot:*"
        }
      }
    }
  ]
}
```

#### 3. 必要な権限ポリシーをアタッチ

```bash
# CDKデプロイに必要な権限
aws iam attach-role-policy \
  --role-name GitHubActionsDeployRole \
  --policy-arn arn:aws:iam::aws:policy/PowerUserAccess

# または、より制限的なカスタムポリシーを作成
```

#### 4. GitHub Secretsに設定

リポジトリの Settings > Secrets and variables > Actions で以下を追加:

- `AWS_ROLE_TO_ASSUME`: 作成したIAMロールのARN

### 方法2: アクセスキー（簡易版）

#### 1. IAMユーザーの作成

```bash
aws iam create-user --user-name ai-insights-bot-deploy
```

#### 2. 必要な権限をアタッチ

```bash
# 管理者権限（開発用）
aws iam attach-user-policy \
  --user-name ai-insights-bot-deploy \
  --policy-arn arn:aws:iam::aws:policy/PowerUserAccess
```

#### 3. アクセスキーの作成

```bash
aws iam create-access-key --user-name ai-insights-bot-deploy
```

#### 4. アクセスキーをGitHub Secretsに設定

リポジトリの Settings > Secrets and variables > Actions で以下を追加:

- `AWS_ACCESS_KEY_ID`: アクセスキーID
- `AWS_SECRET_ACCESS_KEY`: シークレットアクセスキー

## 📦 Systems Manager パラメータの設定

デプロイ後、以下のパラメータを設定する必要があります:

### 1. Slack Bot Token

```bash
aws ssm put-parameter \
  --name "/ai-insights-bot/slack-bot-token" \
  --value "xoxb-your-slack-bot-token" \
  --type SecureString \
  --description "Slack Bot Token for AI Insights Bot"
```

### 2. X (Twitter) API Bearer Token

```bash
aws ssm put-parameter \
  --name "/ai-insights-bot/twitter-bearer-token" \
  --value "your-twitter-bearer-token" \
  --type SecureString \
  --description "Twitter API Bearer Token"
```

### 3. Slack Channel

```bash
aws ssm put-parameter \
  --name "/ai-insights-bot/slack-channel" \
  --value "#ai-news" \
  --type String \
  --description "Slack channel for posting AI news"
```

## 🔑 必要な権限一覧

CDKデプロイに最低限必要な権限:

- CloudFormation: スタック操作
- Lambda: 関数の作成・更新
- DynamoDB: テーブル作成
- EventBridge: ルール作成
- API Gateway: API作成
- IAM: ロール・ポリシー作成
- CloudWatch: ログ・メトリクス作成
- SNS: トピック作成
- S3: CDKアセット保存
- SSM: パラメータ読み取り（Lambda実行時）

## 🛡️ セキュリティベストプラクティス

1. **最小権限の原則**
   - 必要最小限の権限のみを付与
   - 本番環境では PowerUserAccess ではなくカスタムポリシーを使用

2. **ローテーション**
   - アクセスキーを使用する場合は定期的にローテーション
   - OIDC使用時は自動的に短期認証情報が使用される

3. **監査**
   - CloudTrailでAPI呼び出しを記録
   - 異常なアクティビティの監視

4. **環境分離**
   - 本番/開発環境で異なるAWSアカウントを使用
   - 環境ごとに異なるIAMロール/ポリシー

## 🚀 デプロイ前チェックリスト

- [ ] AWS CLIが設定済み（`aws configure`）
- [ ] 適切なAWSリージョンが選択されている
- [ ] IAMロールまたはアクセスキーが作成済み
- [ ] GitHub Secretsが設定済み
- [ ] Systems Managerパラメータの値を準備済み

## 📚 参考リンク

- [GitHub OIDC Provider設定](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services)
- [AWS CDK権限リファレンス](https://docs.aws.amazon.com/cdk/v2/guide/security-iam.html)
- [Systems Manager Parameter Store](https://docs.aws.amazon.com/systems-manager/latest/userguide/systems-manager-parameter-store.html)
