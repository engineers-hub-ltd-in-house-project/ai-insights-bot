# 開発ガイドライン

## 🛠️ 開発環境セットアップ

### 1. lefthook（Git hooks）のセットアップ

```bash
# 初期化（プロジェクトクローン後に実行）
npx lefthook install
```

### 2. 自動フォーマット・Lint

```bash
# すべてのファイルをフォーマット・修正
npm run fix

# 個別に実行
npm run lint:fix    # ESLint自動修正
npm run format:fix  # Prettier自動フォーマット
```

### 3. コードチェック

```bash
# すべてのチェックを実行
npm run check

# 個別に実行
npm run lint    # ESLintチェック
npm run format  # Prettierチェック
npm run build   # TypeScriptビルド
```

## 🪝 Git Hooks（lefthook）

### pre-commit フック

コミット前に自動実行：

- TypeScript型チェック
- ESLintチェック
- Prettierフォーマットチェック

### pre-push フック

プッシュ前に自動実行：

- テスト実行
- ビルド確認
- CDK合成確認

### commit-msg フック

コミットメッセージ形式の検証

### 手動実行コマンド

```bash
# pre-commitフックを手動実行
npx lefthook run pre-commit

# pre-pushフックを手動実行
npx lefthook run pre-push

# 自動修正を実行
npx lefthook run fix

# 特定のコマンドのみ実行
npx lefthook run pre-commit --commands eslint
```

### フックをスキップしたい場合

```bash
# すべてのフックをスキップ
LEFTHOOK=0 git commit -m "feat: 新機能追加"

# 特定のフックのみスキップ
LEFTHOOK_EXCLUDE=eslint,prettier git commit -m "fix: バグ修正"
```

## 📝 コミットメッセージ規約

### フォーマット

```text
<type>(<scope>): <subject>
```

### タイプ一覧

- `feat`: 新機能
- `fix`: バグ修正
- `docs`: ドキュメントのみの変更
- `style`: コードの意味に影響しない変更（空白、フォーマット等）
- `refactor`: バグ修正や機能追加を伴わないコード変更
- `perf`: パフォーマンス改善
- `test`: テストの追加・修正
- `build`: ビルドシステムや外部依存関係の変更
- `ci`: CI設定ファイルやスクリプトの変更
- `chore`: その他の変更

### 例

```bash
git commit -m "feat(lambda): Twitter API統合を追加"
git commit -m "fix(dynamodb): TTL設定のバグを修正"
git commit -m "docs: READMEにセットアップ手順を追加"
```

## 🏗️ プロジェクト構造

```text
ai-insights-bot/
├── lib/                    # CDKスタック定義
├── lambda/                 # Lambda関数
│   ├── collect-ai-news/   # AI情報収集
│   ├── process-and-post/  # Slack投稿処理
│   └── shared/            # 共通コード
├── test/                  # テストファイル
├── .vscode/               # VSCode設定
├── lefthook.yml           # Git hooks設定
├── .eslintrc.json         # ESLint設定
└── .prettierrc.json       # Prettier設定
```

## 🧪 テスト

```bash
# テスト実行
npm test

# ウォッチモード
npm test -- --watch

# カバレッジ付き
npm test -- --coverage
```

## 🚀 デプロイ

```bash
# 差分確認
cdk diff

# デプロイ
cdk deploy

# 特定のスタックのみデプロイ
cdk deploy AiInsightsBotStack
```

## 🔍 トラブルシューティング

### lefthookが動作しない

```bash
# 再インストール
npx lefthook uninstall
npx lefthook install
```

### ESLintエラーが解決できない

```bash
# キャッシュクリア
npx eslint --cache-location node_modules/.cache/eslint/ --cache
```

### ビルドエラー

```bash
# node_modules再インストール
rm -rf node_modules package-lock.json
npm install
```
