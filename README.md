# LINE-Discord連携ツール

LINEグループのメッセージをDiscordに転送するためのWebhookサーバーです。

## 機能

- LINEグループからのメッセージをDiscordに転送
- 送信者名、アイコン画像を表示
- テキスト、画像、スタンプに対応
- 簡単なセットアップと設定

## セットアップ

### 環境変数の設定

`.env`ファイルを作成し、以下の項目を設定してください：

```
# LINE Messaging API の設定
LINE_CHANNEL_ID=あなたのチャネルID
LINE_CHANNEL_SECRET=あなたのチャネルシークレット
LINE_CHANNEL_ACCESS_TOKEN=あなたのアクセストークン
LINE_WEBHOOK_URL=https://あなたのドメイン/webhook

# Discord Webhook の設定
DISCORD_WEBHOOK_URL=あなたのDiscord WebhookのURL

# サーバー設定
PORT=3000
BASE_URL=https://あなたのドメイン
```

### インストール

```bash
npm install
```

### 開発環境での実行

```bash
npm run dev:all
```

### 本番環境での実行

```bash
npm start
```

## デプロイ

Renderにデプロイすることをお勧めします。

1. このリポジトリをGitHubにフォークまたはクローンする
2. Renderでアカウントを作成し、新しいWebサービスを作成
3. GitHubリポジトリを連携
4. 環境変数を設定
5. デプロイ完了後、LINE DeveloperコンソールでWebhook URLを更新

## ライセンス

MIT 