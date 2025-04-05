# LINE-Discord連携ツールの作り方

## はじめに

LINEとDiscordは現代のコミュニケーションに欠かせないツールとなっています。友人とのやり取りにはLINE、ゲームコミュニティや特定の趣味のグループではDiscordを使うという方も多いでしょう。しかし、両方のプラットフォームを行き来するのは面倒なことがあります。そこで今回は、LINEのグループメッセージをDiscordで受信し、またDiscordからLINEグループにメッセージを送信できる連携ツールを開発しました。

本記事では、この連携ツールの作成方法を詳しく解説します。Node.jsとExpressを使用したシンプルなウェブサーバーでLINEとDiscordのAPIを連携させる方法を学びましょう。

## 完成イメージと機能概要

開発したツールには以下の機能があります：

- LINEグループのメッセージをDiscordに転送
- 送信者名とアイコン画像をDiscordで表示
- テキスト、画像、スタンプなど様々な種類のメッセージに対応
- メッセージの送信時間情報も表示
- 簡単な設定とデプロイが可能

## 前提条件

このプロジェクトを始める前に、以下の準備が必要です：

- Node.jsの基本的な知識
- ExpressやWebhookの概念の理解
- LINE Developers アカウント
- Discord アカウントとサーバー管理権限

## 開発環境のセットアップ

まずは開発環境をセットアップしましょう。新しいディレクトリを作成し、必要なパッケージをインストールします。

```bash
mkdir line2discord
cd line2discord
npm init -y
npm install express @line/bot-sdk discord.js dotenv node-fetch@2
npm install --save-dev nodemon concurrently
```

## プロジェクト構成

主なファイル構成は以下のとおりです：

```
line2discord/
├── .env                # 環境変数設定ファイル
├── line2discord.js     # メインサーバーファイル
├── package.json        # 依存関係と実行スクリプト
├── README.md           # 説明書
├── public/             # 静的ファイル用ディレクトリ
└── temp/               # 一時ファイル用ディレクトリ
```

## LINE Bot の設定

### LINE Developersでの設定

1. [LINE Developers](https://developers.line.biz/console/)にアクセスし、ログインします。
2. プロバイダーを作成または選択します。
3. 「新規チャネル作成」から「Messaging API」を選択します。
4. 必要事項を入力し、チャネルを作成します。
5. 作成後、以下の情報を取得します：
   - チャネルID
   - チャネルシークレット
   - チャネルアクセストークン（長期）

### Webhook URLの設定

LINE Messaging APIでは、メッセージを受信するためにWebhookを設定する必要があります。開発環境では、ngrokなどのツールを使用して一時的なパブリックURLを作成します。

```bash
npm install -g ngrok
ngrok http 3000
```

ngrokが提供するURLを使用して、LINE DevelopersコンソールのWebhook URLを設定します：
`https://あなたのngrokドメイン/webhook`

## Discord Bot の設定

### Discord Developer Portalでの設定

1. [Discord Developer Portal](https://discord.com/developers/applications)にアクセスします。
2. 「New Application」をクリックして新しいアプリケーションを作成します。
3. 「Bot」タブから新しいボットを作成します。
4. 「Reset Token」をクリックしてトークンを生成し、コピーします。
5. 以下の権限を有効にします：
   - MESSAGE CONTENT INTENTを有効化
   - BOT欄の「Administrator」権限を付与
6. OAuth2 > URL Generatorから、botスコープとadministrator権限を選択し、生成されたURLでボットをサーバーに招待します。

### Discord Webhook の設定

次に、LINEからのメッセージを転送するためのWebhookを設定します：

1. Discordサーバーの設定を開きます。
2. 「連携サービス」→「ウェブフック」を選択します。
3. 「新しいウェブフック」をクリックします。
4. 名前とアイコンを設定し、メッセージを送信するチャンネルを選択します。
5. 「ウェブフックURLをコピー」をクリックしてURLを保存します。

## 環境変数の設定

プロジェクトのルートディレクトリに`.env`ファイルを作成し、以下の情報を設定します：

```
# LINE Messaging API の設定
LINE_CHANNEL_ID=あなたのチャネルID
LINE_CHANNEL_SECRET=あなたのチャネルシークレット
LINE_CHANNEL_ACCESS_TOKEN=あなたのアクセストークン
LINE_WEBHOOK_URL=https://あなたのドメイン/webhook
LINE_BOT_NAME=L-Discord連携
LINE_BOT_ID=@あなたのボットID
LINE_GROUP_ID=あなたのLINEグループID

# Discord Bot の設定
DISCORD_APPLICATION_ID=あなたのアプリケーションID
DISCORD_PUBLIC_KEY=あなたのパブリックキー
DISCORD_BOT_TOKEN=あなたのボットトークン
DISCORD_SERVER_ID=あなたのサーバーID
DISCORD_CHANNEL_ID=あなたのチャンネルID
DISCORD_WEBHOOK_URL=あなたのWebhookURL

# サーバー設定
PORT=3000
BASE_URL=https://あなたのドメイン
```

## コードの実装

### メインサーバーファイル (line2discord.js)

メインのサーバーファイルを実装します。このファイルでは、ExpressサーバーのセットアップとLINEとDiscordの連携を行います。

```javascript
// LINE-Discord連携サーバー - 統合版
// 必要なモジュールをインポート
require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const fetch = require('node-fetch');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { finished } = require('stream/promises');

// 環境変数から設定を読み込む
const config = {
  port: process.env.PORT || 3000,
  line: {
    channelSecret: process.env.LINE_CHANNEL_SECRET,
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    webhookPath: process.env.WEBHOOK_PATH || '/webhook'
  },
  discord: {
    webhookUrl: process.env.DISCORD_WEBHOOK_URL
  }
};

// Expressアプリケーションの設定
const app = express();

// JSONボディパーサー（生のボディも保持）
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString();
  }
}));

// 静的ファイル配信設定
app.use('/public', express.static(path.join(__dirname, 'public')));

// 一時ファイル用ディレクトリの作成
const imageDir = path.join(__dirname, 'public', 'images');
const filesDir = path.join(__dirname, 'public', 'files');

if (!fs.existsSync(imageDir)) {
  fs.mkdirSync(imageDir, { recursive: true });
  console.log(`✅ 画像ディレクトリを作成しました: ${imageDir}`);
}

if (!fs.existsSync(filesDir)) {
  fs.mkdirSync(filesDir, { recursive: true });
  console.log(`✅ ファイルディレクトリを作成しました: ${filesDir}`);
}

// LINEのシグネチャを検証する関数
function validateLineSignature(rawBody, signature) {
  const hmac = crypto.createHmac('sha256', config.line.channelSecret);
  hmac.update(rawBody);
  const calculatedSignature = hmac.digest('base64');
  return calculatedSignature === signature;
}

// Discordにメッセージを送信する関数
async function sendToDiscord(data) {
  // Discordへのメッセージ送信処理
  // ...略...
}

// LINEにメッセージを送信する関数
async function sendLineMessage(to, messages) {
  // LINEへのメッセージ送信処理
  // ...略...
}

// LINEユーザーのプロファイル情報を取得する関数
async function getLINEUserProfile(userId, groupId = null) {
  // ユーザープロファイル取得処理
  // ...略...
}

// LINE Webhook エンドポイント
app.post(config.line.webhookPath, async (req, res) => {
  try {
    // シグネチャの検証
    const signature = req.headers['x-line-signature'];
    if (!validateLineSignature(req.rawBody, signature)) {
      console.warn('⚠️ 不正なシグネチャ:', signature);
      return res.status(401).send('Invalid signature');
    }
    
    const events = req.body.events;
    if (!events || events.length === 0) {
      return res.status(200).send('No events');
    }
    
    // イベントを処理
    for (const event of events) {
      console.log('📨 受信イベント:', JSON.stringify(event));
      
      // イベントのソース情報を取得
      const sourceType = event.source.type;
      const userId = event.source.userId;
      const groupId = sourceType === 'group' ? event.source.groupId : null;
      const roomId = sourceType === 'room' ? event.source.roomId : null;
      
      // ユーザープロファイルを取得
      let userProfile = await getLINEUserProfile(userId, groupId || roomId);
      
      // メッセージイベントを処理
      if (event.type === 'message') {
        switch (event.message.type) {
          case 'text':
            await handleTextMessage(event, sourceType, userId, groupId, roomId, userProfile);
            break;
          case 'image':
            await handleImageMessage(event, sourceType, userId, groupId, roomId, userProfile, req);
            break;
          case 'sticker':
            await handleStickerMessage(event, sourceType, userId, groupId, roomId, userProfile);
            break;
          // その他のメッセージタイプの処理...
        }
      }
      // その他のイベントタイプの処理...
    }
    
    res.status(200).send('OK');
  } catch (error) {
    console.error('❌ Webhook処理中にエラーが発生しました:', error);
    res.status(500).send('Internal Server Error');
  }
});

// サーバー起動
app.listen(config.port, async () => {
  console.log('🚀 LINE-Discord連携サーバーを起動しています...');
  console.log(`⚡ ポート${config.port}で起動しました\n`);
  // 起動時の初期設定処理...
});
```

### package.jsonの設定

実行スクリプトを設定します：

```json
{
  "name": "line2discord",
  "version": "1.0.0",
  "description": "LINEとDiscordの連携ツール",
  "main": "line2discord.js",
  "scripts": {
    "start": "node line2discord.js",
    "dev": "nodemon line2discord.js",
    "tunnel": "ngrok http 3000",
    "dev:all": "concurrently --kill-others \"npm run tunnel\" \"sleep 5 && npm run dev\"",
    "wait-tunnel": "sleep 5 && npm run dev"
  },
  "engines": {
    "node": "18.x"
  },
  "keywords": [
    "line",
    "discord",
    "webhook",
    "integration"
  ],
  "author": "",
  "license": "ISC",
  "type": "commonjs",
  "dependencies": {
    "@line/bot-sdk": "^9.7.3",
    "discord.js": "^14.18.0",
    "dotenv": "^16.4.7",
    "express": "^5.1.0",
    "node-fetch": "^2.7.0"
  },
  "devDependencies": {
    "concurrently": "^8.2.2",
    "nodemon": "^3.1.9"
  }
}
```

## 実装の詳細

### LINEからDiscordへのメッセージ転送

LINEからのメッセージをDiscordに転送する主要な処理は次のとおりです：

1. LINE Webhook エンドポイントでリクエストを受け取る
2. LINE Platform SDKを使ってメッセージを検証・解析
3. メッセージタイプに応じて適切な処理を行う
4. Discord Webhookを使用してメッセージを送信

テキストメッセージ処理の例：

```javascript
async function handleTextMessage(event, sourceType, userId, groupId, roomId, userProfile) {
  console.log(`💬 ${sourceType}からテキストメッセージを受信: ${event.message.text}`);
  
  // メッセージ共通設定（ユーザー名とアイコン）
  const messageConfig = {
    username: userProfile.displayName,
    avatar_url: userProfile.pictureUrl || 'https://cdn.discordapp.com/embed/avatars/0.png'
  };
  
  // Discordにテキストメッセージを送信
  await sendToDiscord({
    content: event.message.text,
    ...messageConfig
  });
}
```

画像メッセージの処理では、LINEからダウンロードした画像を一時保存し、Discord側でアクセス可能なURLを生成して転送します。スタンプの場合は、スタンプIDを元にLINE公式のスタンプURLを構築してDiscordに送信します。

### メディアファイルの処理

画像や動画などのメディアファイルは次のように処理します：

```javascript
async function handleImageMessage(event, sourceType, userId, groupId, roomId, userProfile, req) {
  try {
    console.log('🖼️ 画像メッセージを処理中...');
    const messageId = event.message.id;
    
    // タイムスタンプを使用した一意のファイル名を生成
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 1000000);
    const fileName = `image_${timestamp}_${random}.jpg`;
    
    // ファイルを保存するパス
    const filePath = path.join(imageDir, fileName);
    
    // ファイルをダウンロード
    const fileUrl = `https://api-data.line.me/v2/bot/message/${messageId}/content`;
    const downloaded = await downloadFile(fileUrl, filePath);
    
    if (!downloaded) {
      // ダウンロードに失敗した場合、テキストのみ送信
      return sendToDiscord({
        content: `${userProfile.displayName}さんが画像を送信しました（LINEアプリで確認してください）`,
        username: userProfile.displayName,
        avatar_url: userProfile.pictureUrl || 'https://cdn.discordapp.com/embed/avatars/0.png'
      });
    }
    
    // ダウンロードに成功した場合、ファイルURLを取得
    const publicUrl = getPublicUrl(req, `/public/images/${fileName}`);
    
    // Discordに送信
    return sendToDiscord({
      content: `${userProfile.displayName}さんが画像を送信しました:`,
      embeds: [{
        image: {
          url: publicUrl
        }
      }],
      username: userProfile.displayName,
      avatar_url: userProfile.pictureUrl || 'https://cdn.discordapp.com/embed/avatars/0.png'
    });
  } catch (error) {
    console.error('❌ 画像メッセージの処理中にエラーが発生しました:', error);
    return sendToDiscord({
      content: `${userProfile.displayName}さんが画像を送信しました（エラーが発生したためLINEアプリで確認してください）`,
      username: userProfile.displayName,
      avatar_url: userProfile.pictureUrl || 'https://cdn.discordapp.com/embed/avatars/0.png'
    });
  }
}
```

## デプロイ方法

このサービスをインターネット上で公開するために、Renderというクラウドサービスを使用します。

### Renderへのデプロイ手順

1. [Render](https://render.com/)にアクセスし、アカウントを作成またはログインします。
2. ダッシュボードから「Web Service」を選択します。
3. GitHubリポジトリと連携します（あらかじめGitHubにコードをプッシュしておく必要があります）。
4. 以下の設定を行います：
   - Name: line2discord（好きな名前）
   - Region: 東京（または近い地域）
   - Branch: main
   - Runtime: Node
   - Build Command: `npm install`
   - Start Command: `npm start`
5. 「Environment Variables」を追加します（.envファイルの内容を設定）。
6. 「Create Web Service」をクリックしてデプロイします。

### デプロイ後の設定

1. RenderがデプロイしたURLを取得します（例：https://line2discord.onrender.com）。
2. LINE DevelopersコンソールでWebhook URLを更新します：
   `https://line2discord.onrender.com/webhook`
3. Webhook URLが有効になっていることを確認します。

## テスト方法

### ローカル環境でのテスト

1. ターミナルで以下のコマンドを実行します：
   ```bash
   npm run dev:all
   ```
2. ngrokのパブリックURLをコピーします。
3. LINE DevelopersコンソールでWebhook URLを一時的に更新します。
4. LINEグループでメッセージを送信し、Discordに転送されることを確認します。

### 本番環境でのテスト

1. デプロイが完了したら、LINEグループでメッセージを送信します。
2. Discordのチャンネルにメッセージが転送されることを確認します。
3. 様々な種類のメッセージ（テキスト、画像、スタンプなど）をテストします。

## トラブルシューティング

よくある問題と解決方法です：

1. **Webhook検証エラー**
   - LINE Developers コンソールでWebhook URLが正しく設定されているか確認
   - チャネルシークレットが正確に.envファイルに入力されているか確認

2. **Discordにメッセージが届かない**
   - Discord Webhook URLが正しいか確認
   - ボットがDiscordサーバーに正しく招待されているか確認
   - ログを確認して、どの部分でエラーが発生しているか特定

3. **画像が表示されない**
   - 一時ファイルディレクトリのパーミッションを確認
   - パブリックURLの生成が正しく行われているか確認

## 拡張アイディア

このプロジェクトをさらに発展させるアイディアをいくつか紹介します：

1. **双方向の対応**：DiscordからLINEへのメッセージ送信機能の追加
2. **複数グループ対応**：複数のLINEグループとDiscordチャンネルの連携
3. **コマンド機能**：特定のコマンドで統計情報の取得や設定変更
4. **メッセージフィルタリング**：特定のキーワードを含むメッセージのみ転送
5. **リアクション連携**：DiscordのリアクションをLINEのスタンプに変換

## ステップバイステップの実装手順

ここでは、LINE-Discord連携ツールを一から作るための具体的な手順を紹介します。以下の手順に沿って実装していきましょう。

### STEP 1: 開発環境のセットアップ

1. まず、Node.jsとnpmがインストールされていることを確認します。
```bash
node -v
npm -v
```

2. プロジェクトディレクトリを作成し、初期化します。
```bash
mkdir line2discord
cd line2discord
npm init -y
```

3. 必要なパッケージをインストールします。
```bash
npm install express @line/bot-sdk discord.js dotenv node-fetch@2
npm install --save-dev nodemon concurrently
```

4. プロジェクト用のフォルダ構造を作成します。
```bash
mkdir -p public/images public/files
```

### STEP 2: 環境変数の設定

1. `.env`ファイルをプロジェクトのルートに作成します。
```bash
touch .env
```

2. エディタで`.env`ファイルを開き、以下の内容を書き込みます。
```
# LINE Messaging API の設定
LINE_CHANNEL_ID=あなたのチャネルID
LINE_CHANNEL_SECRET=あなたのチャネルシークレット
LINE_CHANNEL_ACCESS_TOKEN=あなたのアクセストークン
LINE_WEBHOOK_URL=https://あなたのドメイン/webhook
LINE_BOT_NAME=L-Discord連携
LINE_BOT_ID=@あなたのボットID
LINE_GROUP_ID=あなたのLINEグループID

# Discord Bot の設定
DISCORD_APPLICATION_ID=あなたのアプリケーションID
DISCORD_PUBLIC_KEY=あなたのパブリックキー
DISCORD_BOT_TOKEN=あなたのボットトークン
DISCORD_SERVER_ID=あなたのサーバーID
DISCORD_CHANNEL_ID=あなたのチャンネルID
DISCORD_WEBHOOK_URL=あなたのWebhookURL

# サーバー設定
PORT=3000
BASE_URL=https://あなたのドメイン
WEBHOOK_PATH=/webhook
```

### STEP 3: package.jsonの設定

1. package.jsonを編集して、以下のスクリプトを追加します。
```json
{
  "scripts": {
    "start": "node line2discord.js",
    "dev": "nodemon line2discord.js",
    "tunnel": "ngrok http 3000",
    "dev:all": "concurrently --kill-others \"npm run tunnel\" \"sleep 5 && npm run dev\"",
    "wait-tunnel": "sleep 5 && npm run dev"
  },
  "engines": {
    "node": "18.x"
  },
  "type": "commonjs"
}
```

### STEP 4: 基本的なExpressサーバーの実装

1. `line2discord.js`ファイルをプロジェクトのルートに作成し、基本的なExpressサーバーを実装します。

```javascript
// 基本的なExpressサーバーのセットアップ
require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

// 環境変数の読み込み
const config = {
  port: process.env.PORT || 3000,
  line: {
    channelSecret: process.env.LINE_CHANNEL_SECRET,
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    webhookPath: process.env.WEBHOOK_PATH || '/webhook'
  },
  discord: {
    webhookUrl: process.env.DISCORD_WEBHOOK_URL
  }
};

// Expressアプリの初期化
const app = express();

// JSONボディパーサー（生のボディも保持）
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString();
  }
}));

// 静的ファイル配信設定
app.use('/public', express.static(path.join(__dirname, 'public')));

// ルートエンドポイント
app.get('/', (req, res) => {
  res.send('LINE-Discord連携サーバーが稼働中です');
});

// サーバー起動
app.listen(config.port, () => {
  console.log(`サーバーがポート ${config.port} で起動しました`);
});
```

2. サーバーを起動して動作確認します。
```bash
npm run dev
```

### STEP 5: LINEのシグネチャ検証関数の実装

1. `line2discord.js`に以下の関数を追加します。

```javascript
// LINEのシグネチャを検証する関数
function validateLineSignature(rawBody, signature) {
  const hmac = crypto.createHmac('sha256', config.line.channelSecret);
  hmac.update(rawBody);
  const calculatedSignature = hmac.digest('base64');
  return calculatedSignature === signature;
}
```

### STEP 6: Webhook受信エンドポイントの実装

1. `line2discord.js`にLINE Webhook受信エンドポイントを追加します。

```javascript
// LINE Webhook エンドポイント
app.post(config.line.webhookPath, async (req, res) => {
  try {
    // シグネチャの検証
    const signature = req.headers['x-line-signature'];
    if (!validateLineSignature(req.rawBody, signature)) {
      console.warn('⚠️ 不正なシグネチャ:', signature);
      return res.status(401).send('Invalid signature');
    }
    
    const events = req.body.events;
    if (!events || events.length === 0) {
      return res.status(200).send('No events');
    }
    
    // イベントを処理
    for (const event of events) {
      console.log('📨 受信イベント:', JSON.stringify(event));
      
      // ここに後ほどイベント処理のコードを追加します
    }
    
    res.status(200).send('OK');
  } catch (error) {
    console.error('❌ Webhook処理中にエラーが発生しました:', error);
    res.status(500).send('Internal Server Error');
  }
});
```

### STEP 7: LINEプロファイル取得関数の実装

1. 以下の関数を`line2discord.js`に追加します。

```javascript
// LINEユーザーのプロファイル情報を取得する関数
async function getLINEUserProfile(userId, groupId = null) {
  if (!userId) {
    return null;
  }
  
  try {
    const fetch = require('node-fetch');
    let url;
    
    if (groupId) {
      // グループメンバーのプロファイル
      url = `https://api.line.me/v2/bot/group/${groupId}/member/${userId}`;
    } else {
      // 個人のプロファイル
      url = `https://api.line.me/v2/bot/profile/${userId}`;
    }
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${config.line.channelAccessToken}`
      }
    });
    
    if (response.ok) {
      return await response.json();
    } else {
      console.warn(`⚠️ プロファイル取得エラー: ${response.status} ${response.statusText}`);
      return null;
    }
  } catch (error) {
    console.error('❌ プロファイル取得中にエラー:', error);
    return null;
  }
}
```

### STEP 8: Discordへのメッセージ送信関数の実装

1. 以下の関数を`line2discord.js`に追加します。

```javascript
// Discordにメッセージを送信する関数
async function sendToDiscord(data) {
  if (!config.discord.webhookUrl) {
    console.error('❌ Discord Webhook URLが設定されていません');
    return false;
  }

  try {
    const fetch = require('node-fetch');
    
    // タイムスタンプを変換
    const timestamp = data.timestamp ? new Date(parseInt(data.timestamp)).toISOString() : new Date().toISOString();
    
    // Webhook用ペイロードを作成
    const payload = {
      username: data.username || '不明なユーザー',
      avatar_url: data.avatar_url || 'https://cdn.discordapp.com/embed/avatars/0.png',
      content: data.content || ''
    };
    
    // 埋め込み設定
    if (data.embeds) {
      payload.embeds = data.embeds;
    } else if (data.text) {
      payload.embeds = [{
        title: data.groupName || 'LINE',
        color: 5301186, // LINE緑色
        description: data.text,
        timestamp: timestamp,
        footer: {
          text: 'LINE経由',
          icon_url: 'https://storage.googleapis.com/gweb-uniblog-publish-prod/images/logo_line_blogheader.max-1300x1300.png'
        }
      }];
    }
    
    // Webhookにリクエスト送信
    const response = await fetch(config.discord.webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Discord API エラー: ${response.status} ${response.statusText}`);
    }

    console.log('✅ Discordにメッセージを送信しました');
    return true;
  } catch (error) {
    console.error('❌ Discordへの送信に失敗しました:', error);
    return false;
  }
}
```

### STEP 9: メッセージハンドラーの実装

1. テキストメッセージ処理関数を追加します。

```javascript
// テキストメッセージを処理
async function handleTextMessage(event, sourceType, userId, groupId, roomId, userProfile) {
  console.log(`💬 ${sourceType}からテキストメッセージを受信: ${event.message.text}`);
  
  // メッセージ共通設定（ユーザー名とアイコン）
  const messageConfig = {
    username: userProfile.displayName,
    avatar_url: userProfile.pictureUrl || 'https://cdn.discordapp.com/embed/avatars/0.png'
  };
  
  // Discordにテキストメッセージを送信
  await sendToDiscord({
    content: event.message.text,
    ...messageConfig
  });
}
```

2. 画像処理関数を追加します。

```javascript
// ファイルダウンロード用のヘルパー関数
async function downloadFile(url, filePath) {
  try {
    const fetch = require('node-fetch');
    const fs = require('fs');
    const { finished } = require('stream/promises');
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${config.line.channelAccessToken}`
      }
    });
    
    if (!response.ok) {
      throw new Error(`ダウンロードエラー: ${response.status} ${response.statusText}`);
    }
    
    const fileStream = fs.createWriteStream(filePath);
    await finished(response.body.pipe(fileStream));
    
    return true;
  } catch (error) {
    console.error('❌ ファイルダウンロード中にエラー:', error);
    return false;
  }
}

// URL生成関数
function getPublicUrl(req, path) {
  const baseUrl = process.env.BASE_URL || `http://${req.headers.host}`;
  return `${baseUrl}${path}`;
}

// 画像メッセージ処理関数
async function handleImageMessage(event, sourceType, userId, groupId, roomId, userProfile, req) {
  try {
    console.log('🖼️ 画像メッセージを処理中...');
    const messageId = event.message.id;
    
    // タイムスタンプを使用した一意のファイル名を生成
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 1000000);
    const fileName = `image_${timestamp}_${random}.jpg`;
    
    // ファイルを保存するパス
    const imageDir = path.join(__dirname, 'public', 'images');
    const filePath = path.join(imageDir, fileName);
    
    // ファイルをダウンロード
    const fileUrl = `https://api-data.line.me/v2/bot/message/${messageId}/content`;
    const downloaded = await downloadFile(fileUrl, filePath);
    
    if (!downloaded) {
      // ダウンロードに失敗した場合、テキストのみ送信
      return sendToDiscord({
        content: `${userProfile.displayName}さんが画像を送信しました（LINEアプリで確認してください）`,
        username: userProfile.displayName,
        avatar_url: userProfile.pictureUrl || 'https://cdn.discordapp.com/embed/avatars/0.png'
      });
    }
    
    // ダウンロードに成功した場合、ファイルURLを取得
    const publicUrl = getPublicUrl(req, `/public/images/${fileName}`);
    
    // Discordに送信
    return sendToDiscord({
      content: `${userProfile.displayName}さんが画像を送信しました:`,
      embeds: [{
        image: {
          url: publicUrl
        }
      }],
      username: userProfile.displayName,
      avatar_url: userProfile.pictureUrl || 'https://cdn.discordapp.com/embed/avatars/0.png'
    });
  } catch (error) {
    console.error('❌ 画像メッセージの処理中にエラーが発生しました:', error);
    return sendToDiscord({
      content: `${userProfile.displayName}さんが画像を送信しました（エラーが発生したためLINEアプリで確認してください）`,
      username: userProfile.displayName,
      avatar_url: userProfile.pictureUrl || 'https://cdn.discordapp.com/embed/avatars/0.png'
    });
  }
}
```

### STEP 10: Webhookエンドポイントの完成

1. 先に実装したWebhookエンドポイントを更新して、メッセージタイプに応じた処理を行うようにします。

```javascript
// LINE Webhook エンドポイント
app.post(config.line.webhookPath, async (req, res) => {
  try {
    // シグネチャの検証
    const signature = req.headers['x-line-signature'];
    if (!validateLineSignature(req.rawBody, signature)) {
      console.warn('⚠️ 不正なシグネチャ:', signature);
      return res.status(401).send('Invalid signature');
    }
    
    const events = req.body.events;
    if (!events || events.length === 0) {
      return res.status(200).send('No events');
    }
    
    // イベントを処理
    for (const event of events) {
      console.log('📨 受信イベント:', JSON.stringify(event));
      
      // イベントのソース情報を取得
      const sourceType = event.source.type;
      const userId = event.source.userId;
      const groupId = sourceType === 'group' ? event.source.groupId : null;
      const roomId = sourceType === 'room' ? event.source.roomId : null;
      
      // ユーザープロファイルを取得
      let userProfile = await getLINEUserProfile(userId, groupId || roomId);
      
      // プロファイル取得に失敗した場合のデフォルト値
      if (!userProfile) {
        userProfile = {
          displayName: userId ? `LINEユーザー ${userId.substr(-4)}` : 'LINEユーザー',
          pictureUrl: 'https://cdn.discordapp.com/embed/avatars/0.png'
        };
        console.log('⚠️ ユーザープロファイル取得に失敗したため、デフォルト値を使用します');
      }
      
      // メッセージイベントを処理
      if (event.type === 'message') {
        switch (event.message.type) {
          case 'text':
            await handleTextMessage(event, sourceType, userId, groupId, roomId, userProfile);
            break;
          case 'image':
            await handleImageMessage(event, sourceType, userId, groupId, roomId, userProfile, req);
            break;
          // その他のメッセージタイプの処理...
          default:
            console.log(`⏭️ 未対応のメッセージタイプ: ${event.message.type}`);
            await sendToDiscord({
              content: `${userProfile.displayName}さんが${event.message.type}を送信しました（未対応の形式です）`,
              username: userProfile.displayName,
              avatar_url: userProfile.pictureUrl || 'https://cdn.discordapp.com/embed/avatars/0.png'
            });
            break;
        }
      } else if (event.type === 'follow') {
        // 友達追加イベント
        console.log('👋 友達追加イベント', event);
        await sendToDiscord({
          content: `${userProfile.displayName}さんがLINE Botを友達追加しました！`,
          username: "LINE通知",
          avatar_url: userProfile.pictureUrl || 'https://cdn.discordapp.com/embed/avatars/0.png'
        });
      } else if (event.type === 'join') {
        // グループ参加イベント
        console.log('🎉 グループ参加イベント', event);
        await sendToDiscord({
          content: "LINE Botがグループに参加しました！このグループのメッセージがDiscordに転送されます。",
          username: "LINE通知",
          avatar_url: "https://cdn.discordapp.com/embed/avatars/0.png"
        });
      } else {
        console.log(`⏭️ メッセージ以外のイベント: ${event.type}`);
      }
    }
    
    res.status(200).send('OK');
  } catch (error) {
    console.error('❌ Webhook処理中にエラーが発生しました:', error);
    res.status(500).send('Internal Server Error');
  }
});
```

### STEP 11: ngrokを使ったローカルテスト

1. ngrokをインストールしていない場合は、まずインストールします。
```bash
npm install -g ngrok
```

2. 開発サーバーとngrokを同時に起動します。
```bash
npm run dev:all
```

3. コンソールに表示されるngrokのURLをコピーします。
例: `https://xxxx-xxx-xxx-xxx.ngrok-free.app`

4. LINE Developers コンソールにアクセスし、Webhook URLを更新します。
`https://xxxx-xxx-xxx-xxx.ngrok-free.app/webhook`

5. Webhookの検証ボタンを押して、成功することを確認します。

6. LINEアプリからボットにメッセージを送信して、Discordに転送されることを確認します。

### STEP 12: Renderへのデプロイ

1. GitHubリポジトリを作成し、コードをプッシュします。
```bash
git init
echo "node_modules/\n.env\npublic/images/\npublic/files/\n.DS_Store" > .gitignore
git add .
git commit -m "Initial commit"
git remote add origin あなたのGitHubリポジトリURL
git push -u origin main
```

2. Renderにアクセスし、ダッシュボードから「Web Service」を選択します。

3. GitHubリポジトリと連携し、以下の設定を行います：
   - Name: line2discord（好きな名前）
   - Region: 東京（または近い地域）
   - Branch: main
   - Runtime: Node
   - Build Command: `npm install`
   - Start Command: `npm start`

4. 「Environment Variables」を追加します（.envファイルの内容を設定）。秘密情報は入力フォームから直接追加してください。

5. 「Create Web Service」をクリックしてデプロイします。

6. デプロイが完了したら、RenderがデプロイしたURLを取得します。
例: `https://line2discord.onrender.com`

7. LINE DevelopersコンソールでWebhook URLを更新します：
`https://line2discord.onrender.com/webhook`

8. Webhookが有効になっていることを確認します。

これでLINE-Discord連携ツールの実装とデプロイが完了しました。LINEグループから送信されたメッセージがDiscordに転送されることを確認してください。

## まとめ

LINEとDiscordを連携させるサーバーを構築することで、コミュニケーションプラットフォーム間のギャップを埋めることができます。このプロジェクトでは、Node.jsとExpressを使って簡単な連携サーバーを作成し、LINE Botの機能とDiscord Webhookでリアルタイムなメッセージのやりとりを実現しました。

このようなツールを作ることで、異なるプラットフォームを使っている友人やグループとのコミュニケーションがスムーズになります。また、WebhookやAPIを活用したアプリケーション開発の基礎も学ぶことができました。

ぜひこの記事を参考に、自分だけの連携ツールを作ってみてください！ 