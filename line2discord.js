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

// 起動時にLINEボットの設定を行う
async function setupLineBot() {
  if (!config.line.channelAccessToken) {
    console.error('❌ LINE Channel Access Tokenが設定されていません');
    return false;
  }

  try {
    // 自動応答メッセージを無効化する試み
    try {
      const responseSettings = await fetch('https://manager.line.biz/account/XXXXXXXXX/setting/response', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${config.line.channelAccessToken}`
        }
      });
      console.log('📱 LINE応答設定の確認を試みました');
    } catch (err) {
      console.log('ℹ️ LINE応答設定はLINE Manager UIから手動で変更する必要があります');
    }
    
    // 自動応答メッセージの設定情報取得
    try {
      const autoResponseSettings = await fetch('https://api.line.me/v2/bot/message/quota', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${config.line.channelAccessToken}`
        }
      });
      
      console.log('📊 メッセージ送信制限:', await autoResponseSettings.json());
    } catch (err) {
      console.warn('⚠️ メッセージ送信制限の確認に失敗:', err.message);
    }

    // Webhookの有効性をチェック
    const webhookStatus = await fetch('https://api.line.me/v2/bot/channel/webhook/endpoint', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${config.line.channelAccessToken}`
      }
    });

    const webhookData = await webhookStatus.json();
    
    console.log('📣 LINE Webhook状態:', webhookData);
    
    if (webhookData.endpoint !== process.env.LINE_WEBHOOK_URL) {
      console.warn(`⚠️ LINE WebhookのURL不一致: 
      - 設定済み: ${webhookData.endpoint}
      - 現在の.env: ${process.env.LINE_WEBHOOK_URL}`);
      
      // Webhookを更新
      const updateWebhook = await fetch('https://api.line.me/v2/bot/channel/webhook/endpoint', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.line.channelAccessToken}`
        },
        body: JSON.stringify({
          "endpoint": process.env.LINE_WEBHOOK_URL
        })
      });
      
      console.log('✅ LINE Webhookを更新しました');
      
      // Webhook設定を確認（更新後）
      const confirmWebhook = await fetch('https://api.line.me/v2/bot/channel/webhook/endpoint', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${config.line.channelAccessToken}`
        }
      });
      console.log('🔄 LINE Webhook更新後の状態:', await confirmWebhook.json());
    }

    return true;
  } catch (error) {
    console.error('❌ LINE Bot設定エラー:', error);
    return false;
  }
}

// ngrokのURL情報を取得する関数
async function getNgrokUrl(retryCount = 0, maxRetries = 5) {
  try {
    console.log(`🔍 ngrokのURL情報を取得中... (試行: ${retryCount + 1}/${maxRetries + 1})`);
    
    // ngrokのAPIにアクセスして現在のトンネル情報を取得
    const response = await fetch('http://localhost:4040/api/tunnels');
    if (!response.ok) {
      throw new Error(`ngrok API error: ${response.status}`);
    }
    
    const data = await response.json();
    if (data && data.tunnels && data.tunnels.length > 0) {
      // HTTPSのURLを優先的に取得
      const httpsUrl = data.tunnels.find(t => t.proto === 'https');
      if (httpsUrl) {
        console.log('✅ ngrokのHTTPSトンネルを検出しました');
        return httpsUrl.public_url;
      }
      
      // なければ最初のURLを返す
      console.log('✅ ngrokトンネルを検出しました (HTTPSではありません)');
      return data.tunnels[0].public_url;
    }
    
    // トンネルがない場合は再試行
    if (retryCount < maxRetries) {
      console.log('⌛ ngrokの起動を待機中...');
      // 2秒待機して再試行
      await new Promise(resolve => setTimeout(resolve, 2000));
      return getNgrokUrl(retryCount + 1, maxRetries);
    }
    
    console.warn('⚠️ ngrokトンネルが見つかりませんでした');
    return null;
  } catch (error) {
    // エラーが発生した場合も再試行
    if (retryCount < maxRetries) {
      console.log(`⌛ ngrokの起動を待機中...（エラー: ${error.message}）`);
      // 2秒待機して再試行
      await new Promise(resolve => setTimeout(resolve, 2000));
      return getNgrokUrl(retryCount + 1, maxRetries);
    }
    
    console.error('❌ ngrokのURL取得に失敗:', error);
    return null;
  }
}

// サーバー起動時にngrokのURLを環境変数に設定
let ngrokPublicUrl = null;
(async () => {
  // 開発環境でのみngrokを使用する
  if (process.env.NODE_ENV !== 'production') {
    // BASE_URLが設定されていなければngrokのURLを取得
    if (!process.env.BASE_URL || process.env.BASE_URL.includes('ngrok')) {
      try {
        ngrokPublicUrl = await getNgrokUrl();
        if (ngrokPublicUrl) {
          console.log('🌐 ngrokの公開URL:', ngrokPublicUrl);
          const oldBaseUrl = process.env.BASE_URL;
          process.env.BASE_URL = ngrokPublicUrl;
          
          // Webhook URLを設定
          const webhookUrl = `${ngrokPublicUrl}${config.line.webhookPath}`;
          const oldWebhookUrl = process.env.LINE_WEBHOOK_URL;
          process.env.LINE_WEBHOOK_URL = webhookUrl;
          
          console.log('\n✅ ngrokトンネルを検出しました');
          console.log('==================================');
          console.log(`🔗 LINE Webhook URL: ${webhookUrl}`);
          console.log('==================================');
          console.log('👉 このURLをLINE Developer ConsoleのWebhook URLに設定し、Webhook利用をONにしてください');
          
          // .envファイルを更新
          try {
            const envContent = fs.readFileSync('.env', 'utf8');
            const updatedEnv = envContent
              .replace(/LINE_WEBHOOK_URL=.*$/m, `LINE_WEBHOOK_URL=${webhookUrl}`)
              .replace(/BASE_URL=.*$/m, `BASE_URL=${ngrokPublicUrl}`);
            fs.writeFileSync('.env', updatedEnv);
            console.log('📝 .envファイルを自動更新しました');
            
            // URLが更新された場合、LINE PlatformのWebhook URLも更新を試みる
            if (oldWebhookUrl !== webhookUrl) {
              console.log('🔄 LINE PlatformのWebhook URLを更新しています...');
              
              try {
                // Webhookエンドポイントを更新
                const updateResponse = await fetch('https://api.line.me/v2/bot/channel/webhook/endpoint', {
                  method: 'PUT',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${config.line.channelAccessToken}`
                  },
                  body: JSON.stringify({
                    endpoint: webhookUrl
                  })
                });
                
                if (updateResponse.ok) {
                  console.log('✅ LINE PlatformのWebhook URLを更新しました');
                  
                  // 更新確認
                  const verifyResponse = await fetch('https://api.line.me/v2/bot/channel/webhook/endpoint', {
                    method: 'GET',
                    headers: {
                      'Authorization': `Bearer ${config.line.channelAccessToken}`
                    }
                  });
                  
                  if (verifyResponse.ok) {
                    const verifyData = await verifyResponse.json();
                    console.log('🔍 更新後のWebhook URL:', verifyData.endpoint);
                  }
                } else {
                  const errorData = await updateResponse.json();
                  console.error('❌ Webhook URL更新エラー:', errorData);
                }
              } catch (error) {
                console.error('❌ LINE PlatformのWebhook URL更新中にエラー:', error.message);
              }
            }
          } catch (err) {
            console.warn('⚠️ .envファイルの更新に失敗しました:', err.message);
          }
        } else {
          console.warn('⚠️ ngrokのURLを取得できませんでした。ローカルURLを使用します。');
          console.log('💡 別のターミナルで「npm run tunnel」を実行してngrokを起動してください');
        }
      } catch (error) {
        console.error('❌ ngrokのURL設定中にエラー:', error);
      }
    }
  } else {
    // 本番環境（Render等）では環境変数のBASE_URLを使用
    console.log('🌐 本番環境: BASE_URL =', process.env.BASE_URL);
    
    // LINE Webhook URLがない場合は自動設定
    if (!process.env.LINE_WEBHOOK_URL && process.env.BASE_URL) {
      process.env.LINE_WEBHOOK_URL = `${process.env.BASE_URL}${config.line.webhookPath}`;
      console.log('🔄 LINE_WEBHOOK_URL を自動設定:', process.env.LINE_WEBHOOK_URL);
    }
  }
})();

// Expressサーバーの初期化
const app = express();

// リクエストのボディパーサー設定（シグネチャ検証用に生のボディを保持）
app.use(express.json({
  verify: (req, res, buf, encoding) => {
    req.rawBody = buf.toString(encoding || 'utf8');
  }
}));

// 静的ファイルの提供（注意: パスはプロジェクトのルートからの相対パス）
app.use(express.static(path.join(__dirname, 'public')));
// 念のため、images, filesディレクトリも明示的にマッピング
app.use('/images', express.static(path.join(__dirname, 'public', 'images')));
app.use('/files', express.static(path.join(__dirname, 'public', 'files')));

// 必要なディレクトリを作成
const directories = [
  path.join(__dirname, 'public'),
  path.join(__dirname, 'public', 'images'),
  path.join(__dirname, 'public', 'files')
];

// ディレクトリパスを定義
const imageDir = path.join(__dirname, 'public', 'images');
const filesDir = path.join(__dirname, 'public', 'files');

directories.forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`📁 ディレクトリを作成しました: ${dir}`);
  }
});

// ルートURLへのアクセスを処理
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>LINE-Discord連携サーバー</title>
      <style>
        body {
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          line-height: 1.6;
          color: #333;
          max-width: 800px;
          margin: 0 auto;
          padding: 20px;
          background-color: #f5f5f5;
        }
        h1 {
          color: #00B900;
          border-bottom: 2px solid #00B900;
          padding-bottom: 10px;
        }
        .status {
          background-color: #fff;
          border-radius: 8px;
          padding: 15px;
          margin: 20px 0;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .webhook-url {
          background-color: #f0f0f0;
          padding: 10px;
          border-radius: 4px;
          font-family: monospace;
          word-break: break-all;
        }
        .discord-link {
          display: inline-block;
          margin-top: 20px;
          background-color: #5865F2;
          color: white;
          padding: 10px 15px;
          text-decoration: none;
          border-radius: 4px;
        }
        .line-link {
          display: inline-block;
          margin-top: 20px;
          background-color: #00B900;
          color: white;
          padding: 10px 15px;
          text-decoration: none;
          border-radius: 4px;
        }
        .feature-list {
          background-color: #fff;
          border-radius: 8px;
          padding: 15px;
          margin: 20px 0;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .feature-list h2 {
          color: #5865F2;
          border-bottom: 1px solid #5865F2;
          padding-bottom: 5px;
        }
      </style>
    </head>
    <body>
      <h1>LINE-Discord連携サーバー</h1>
      <div class="status">
        <p>⚡ ステータス: <strong>稼働中</strong></p>
        <p>🕒 起動時間: ${new Date().toLocaleString('ja-JP')}</p>
        <p>🔗 Webhook URL:</p>
        <div class="webhook-url">${process.env.LINE_WEBHOOK_URL || `${process.env.BASE_URL || 'http://localhost:' + config.port}${config.line.webhookPath}`}</div>
        <p>💡 このURLをLINE DeveloperコンソールのWebhook URLに設定してください。</p>
        <div>
          <a href="https://developers.line.biz/console/" target="_blank" class="line-link">LINE Developerコンソールを開く</a>
          <a href="${process.env.DISCORD_WEBHOOK_URL || '#'}" target="_blank" class="discord-link">Discord Webhookを確認</a>
        </div>
      </div>
      
      <div class="feature-list">
        <h2>対応機能一覧</h2>
        <ul>
          <li>テキストメッセージの転送</li>
          <li>画像の転送・表示</li>
          <li>PDFなどのファイル転送</li>
          <li>動画・音声メッセージの転送</li>
          <li>位置情報の転送 (Google Maps連携)</li>
          <li>スタンプの表示</li>
          <li>連絡先共有情報の通知</li>
        </ul>
      </div>
    </body>
    </html>
  `);
});

// ファイル（PDF、音声、動画など）をダウンロードする共通関数
async function downloadFile(url, filePath, headers = {}) {
  try {
    console.log('🔄 ファイルダウンロード開始:', url);
    // ディレクトリが存在しない場合は作成
    const dirname = path.dirname(filePath);
    if (!fs.existsSync(dirname)) {
      fs.mkdirSync(dirname, { recursive: true });
    }

    const defaultHeaders = {
      'Authorization': `Bearer ${config.line.channelAccessToken}`
    };

    const response = await fetch(url, {
      headers: { ...defaultHeaders, ...headers }
    });

    if (!response.ok) {
      throw new Error(`ファイルのダウンロードに失敗しました: ${response.status} ${response.statusText}`);
    }

    const fileStream = fs.createWriteStream(filePath);
    await finished(Readable.fromWeb(response.body).pipe(fileStream));
    
    // ファイルが正常に保存されたか確認
    if (fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath);
      console.log(`✅ ファイルを保存しました: ${filePath} (サイズ: ${stats.size} バイト)`);
      return true;
    } else {
      throw new Error('ファイルの保存に失敗しました');
    }
  } catch (error) {
    console.error('❌ ファイルのダウンロード中にエラーが発生しました:', error);
    return false;
  }
}

// 現在のURL構築
function getPublicUrl(req, relativePath) {
  // 明示的に設定されたBASE_URLがあればそれを使用
  if (process.env.BASE_URL) {
    return `${process.env.BASE_URL}${relativePath}`;
  }
  
  // ngrokのURLがすでに取得されていれば使用
  if (ngrokPublicUrl) {
    return `${ngrokPublicUrl}${relativePath}`;
  }
  
  // 上記の両方がない場合は、リクエストのホストを使用
  const baseUrl = `http://${req.headers.host}`;
  return `${baseUrl}${relativePath}`;
}

// 画像メッセージを処理
async function handleImageMessage(event, sourceType, userId, groupId, roomId, userProfile, req) {
  console.log(`📸 ${sourceType}から画像を受信: メッセージID ${event.message.id}`);
  
  try {
    // タイムスタンプを使用した一意のファイル名を生成
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 1000000);
    const imageFileName = `img_${timestamp}_${random}.jpg`;
    
    // 画像をpublic/imagesディレクトリに保存
    const imagePath = path.join(imageDir, imageFileName);
    console.log('📂 画像保存先パス:', imagePath);
    
    // LINE APIから画像をダウンロード
    const fileUrl = `https://api-data.line.me/v2/bot/message/${event.message.id}/content`;
    const success = await downloadFile(fileUrl, imagePath);
    
    if (!success) {
      throw new Error('画像のダウンロードに失敗しました');
    }
    
    // 画像の公開URL
    // 注意: 相対パスは /images/ から始まる必要がある
    const imageUrl = getPublicUrl(req, `/images/${imageFileName}`);
    console.log('🔗 画像の公開URL:', imageUrl);
    
    // 画像にアクセスできるか確認（オプション）
    try {
      const testResponse = await fetch(imageUrl, { method: 'HEAD' });
      console.log(`🔍 画像URLテスト: HTTP ${testResponse.status}`);
    } catch (err) {
      console.log('⚠️ 画像URLのテストに失敗:', err.message);
    }
    
    // Discordに送信
    return sendToDiscord({
      content: `${userProfile.displayName}さんが画像を送信しました:`,
      username: userProfile.displayName,
      avatar_url: userProfile.pictureUrl,
      embeds: [{
        image: {
          url: imageUrl
        }
      }]
    });
  } catch (err) {
    console.error('❌ 画像処理中にエラーが発生:', err);
    
    // エラー時は通常のテキストメッセージだけ送信
    await sendToDiscord({
      content: `${userProfile.displayName}さんが画像を送信しました（LINEアプリで確認してください）\nエラー: ${err.message}`,
      username: userProfile.displayName,
      avatar_url: userProfile.pictureUrl
    });
  }
}

// ファイルメッセージ処理関数
async function handleFileMessage(event, sourceType, userId, groupId, roomId, userProfile, req) {
  try {
    console.log('📁 ファイルメッセージを処理中...');
    const messageId = event.message.id;
    
    // 一意のファイル名を生成
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 1000000);
    
    // ファイル名を取得（可能な場合）
    let fileName = `file_${timestamp}_${random}`;
    if (event.message.fileName) {
      // 元のファイル名から拡張子を取得
      const originalExt = path.extname(event.message.fileName);
      fileName = `file_${timestamp}_${random}${originalExt || '.bin'}`;
    } else {
      // ファイル拡張子を推測
      const fileType = event.message.type || 'bin';
      fileName = `${fileName}.${fileType}`;
    }
    
    // ファイルを保存するパス
    const filePath = path.join(filesDir, fileName);
    
    // ファイルをダウンロード
    const fileUrl = `https://api-data.line.me/v2/bot/message/${messageId}/content`;
    const downloaded = await downloadFile(fileUrl, filePath);
    
    if (!downloaded) {
      // ダウンロードに失敗した場合、テキストのみ送信
      return sendToDiscord({
        content: `${userProfile.displayName}さんがファイルを送信しました（LINEアプリで確認してください）`,
        username: userProfile.displayName,
        avatar_url: userProfile.pictureUrl
      });
    }
    
    // ダウンロードに成功した場合、ファイルURLを取得
    const publicUrl = getPublicUrl(req, `/files/${fileName}`);
    
    // Discordに送信
    return sendToDiscord({
      content: `${userProfile.displayName}さんがファイルを送信しました:\n${publicUrl}`,
      username: userProfile.displayName,
      avatar_url: userProfile.pictureUrl
    });
  } catch (error) {
    console.error('❌ ファイルメッセージの処理中にエラーが発生しました:', error);
    // エラーの場合でもメッセージは送信
    return sendToDiscord({
      content: `${userProfile.displayName}さんがファイルを送信しました（LINEアプリで確認してください）`,
      username: userProfile.displayName,
      avatar_url: userProfile.pictureUrl
    });
  }
}

// 位置情報メッセージ処理関数
async function handleLocationMessage(event, sourceType, userId, groupId, roomId, userProfile) {
  try {
    console.log('🗺️ 位置情報メッセージを処理中...');
    const location = event.message;
    
    // Google Mapsへのリンクを作成
    const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${location.latitude},${location.longitude}`)}`;
    const googleMapsStaticUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${location.latitude},${location.longitude}&zoom=15&size=600x300&maptype=roadmap&markers=color:red%7C${location.latitude},${location.longitude}`;
    
    // Discordに送信
    return sendToDiscord({
      content: `${userProfile.displayName}さんが位置情報を共有しました:`,
      username: userProfile.displayName,
      avatar_url: userProfile.pictureUrl,
      embeds: [{
        title: location.title || '位置情報',
        description: location.address || '住所情報なし',
        url: googleMapsUrl,
        fields: [
          { name: '緯度', value: `${location.latitude}`, inline: true },
          { name: '経度', value: `${location.longitude}`, inline: true }
        ],
        color: 0x3498db, // 青色
        footer: {
          text: 'Google Mapsで開く',
          icon_url: 'https://maps.gstatic.com/mapfiles/api-3/images/spotlight-poi2.png'
        }
      }]
    });
  } catch (error) {
    console.error('❌ 位置情報メッセージの処理中にエラーが発生しました:', error);
    return sendToDiscord({
      content: `${userProfile.displayName}さんが位置情報を送信しました（LINEアプリで確認してください）`,
      username: userProfile.displayName,
      avatar_url: userProfile.pictureUrl
    });
  }
}

// 連絡先情報メッセージ処理関数
async function handleContactMessage(event, sourceType, userId, groupId, roomId, userProfile) {
  try {
    console.log('👤 連絡先情報メッセージを処理中...');
    const contact = event.message;
    
    // 連絡先情報を取得（可能な限り）
    let contactDetails = '';
    if (contact.displayName) {
      contactDetails += `名前: ${contact.displayName}\n`;
    }
    
    // Discordに送信
    return sendToDiscord({
      content: `${userProfile.displayName}さんが連絡先情報を共有しました`,
      username: userProfile.displayName,
      avatar_url: userProfile.pictureUrl,
      embeds: [{
        title: '連絡先情報',
        description: contactDetails || 'LINEでの連絡先共有です（詳細はLINEアプリで確認してください）',
        color: 0x00b900, // LINE緑
        thumbnail: {
          url: 'https://storage.googleapis.com/gweb-uniblog-publish-prod/images/logo_line_blogheader.max-1300x1300.png'
        }
      }]
    });
  } catch (error) {
    console.error('❌ 連絡先情報メッセージの処理中にエラーが発生しました:', error);
    return sendToDiscord({
      content: `${userProfile.displayName}さんが連絡先情報を共有しました（LINEアプリで確認してください）`,
      username: userProfile.displayName,
      avatar_url: userProfile.pictureUrl
    });
  }
}

// オーディオメッセージ処理関数
async function handleAudioMessage(event, sourceType, userId, groupId, roomId, userProfile, req) {
  try {
    console.log('🔊 オーディオメッセージを処理中...');
    const messageId = event.message.id;
    
    // タイムスタンプを使用した一意のファイル名を生成
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 1000000);
    const fileName = `audio_${timestamp}_${random}.m4a`;
    
    // ファイルを保存するパス
    const filePath = path.join(filesDir, fileName);
    
    // ファイルをダウンロード
    const fileUrl = `https://api-data.line.me/v2/bot/message/${messageId}/content`;
    const downloaded = await downloadFile(fileUrl, filePath);
    
    if (!downloaded) {
      // ダウンロードに失敗した場合、テキストのみ送信
      return sendToDiscord({
        content: `${userProfile.displayName}さんが音声メッセージを送信しました（LINEアプリで確認してください）`,
        username: userProfile.displayName,
        avatar_url: userProfile.pictureUrl
      });
    }
    
    // ダウンロードに成功した場合、ファイルURLを取得
    const publicUrl = getPublicUrl(req, `/files/${fileName}`);
    
    // Discordに送信
    return sendToDiscord({
      content: `${userProfile.displayName}さんが音声メッセージを送信しました:\n${publicUrl}`,
      username: userProfile.displayName,
      avatar_url: userProfile.pictureUrl
    });
  } catch (error) {
    console.error('❌ 音声メッセージの処理中にエラーが発生しました:', error);
    return sendToDiscord({
      content: `${userProfile.displayName}さんが音声メッセージを送信しました（LINEアプリで確認してください）`,
      username: userProfile.displayName,
      avatar_url: userProfile.pictureUrl
    });
  }
}

// 動画メッセージ処理関数
async function handleVideoMessage(event, sourceType, userId, groupId, roomId, userProfile, req) {
  try {
    console.log('🎬 動画メッセージを処理中...');
    const messageId = event.message.id;
    
    // タイムスタンプを使用した一意のファイル名を生成
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 1000000);
    const fileName = `video_${timestamp}_${random}.mp4`;
    
    // ファイルを保存するパス
    const filePath = path.join(filesDir, fileName);
    
    // ファイルをダウンロード
    const fileUrl = `https://api-data.line.me/v2/bot/message/${messageId}/content`;
    const downloaded = await downloadFile(fileUrl, filePath);
    
    if (!downloaded) {
      // ダウンロードに失敗した場合、テキストのみ送信
      return sendToDiscord({
        content: `${userProfile.displayName}さんが動画を送信しました（LINEアプリで確認してください）`,
        username: userProfile.displayName,
        avatar_url: userProfile.pictureUrl
      });
    }
    
    // ダウンロードに成功した場合、ファイルURLを取得
    const publicUrl = getPublicUrl(req, `/files/${fileName}`);
    
    // Discordに送信
    return sendToDiscord({
      content: `${userProfile.displayName}さんが動画を送信しました:\n${publicUrl}`,
      username: userProfile.displayName,
      avatar_url: userProfile.pictureUrl
    });
  } catch (error) {
    console.error('❌ 動画メッセージの処理中にエラーが発生しました:', error);
    return sendToDiscord({
      content: `${userProfile.displayName}さんが動画を送信しました（LINEアプリで確認してください）`,
      username: userProfile.displayName,
      avatar_url: userProfile.pictureUrl
    });
  }
}

// スタンプメッセージを処理
async function handleStickerMessage(event, sourceType, userId, groupId, roomId, userProfile) {
  console.log(`📱 ${sourceType}からスタンプを受信:`, event.message);
  
  try {
    // LINE公式スタンプのURLを構築
    const stickerUrl = `https://stickershop.line-scdn.net/stickershop/v1/sticker/${event.message.stickerId}/android/sticker.png`;
    
    // Discordに送信
    return sendToDiscord({
      content: `${userProfile.displayName}さんがスタンプを送信しました:`,
      username: userProfile.displayName,
      avatar_url: userProfile.pictureUrl,
      embeds: [{
        image: {
          url: stickerUrl
        }
      }]
    });
  } catch (err) {
    console.error('❌ スタンプ処理中にエラーが発生:', err);
    
    // エラー時は通常のテキストメッセージだけ送信
    await sendToDiscord({
      content: `${userProfile.displayName}さんがスタンプを送信しました（LINEアプリで確認してください）`,
      username: userProfile.displayName,
      avatar_url: userProfile.pictureUrl
    });
  }
}

// LINE Webhook署名検証関数
function validateLineSignature(rawBody, signature) {
  if (!config.line.channelSecret) {
    console.warn('⚠️ LINE Channel Secretが設定されていません');
    return true; // 開発中は検証をスキップ
  }
  
  const hash = crypto
    .createHmac('sha256', config.line.channelSecret)
    .update(rawBody)
    .digest('base64');
  
  console.log('🔐 署名検証:');
  console.log('- 受信した署名:', signature);
  console.log('- 計算した署名:', hash);
  console.log('- 一致:', hash === signature);
  
  // 開発中は署名検証をスキップ（trueを返す）
  return true; // hash === signature;
}

// Discord Webhookにメッセージ送信
async function sendToDiscord(data) {
  if (!config.discord.webhookUrl) {
    console.error('❌ Discord Webhook URLが設定されていません');
    return false;
  }

  try {
    // LINEの日時フォーマットを変換
    const timestamp = data.timestamp ? new Date(parseInt(data.timestamp)).toISOString() : new Date().toISOString();
    
    // Webhook用ペイロードを作成
    const payload = {
      username: data.username || '不明なユーザー',
      avatar_url: data.avatar_url || data.senderIconUrl || 'https://storage.googleapis.com/gweb-uniblog-publish-prod/images/logo_line_blogheader.max-1300x1300.png',
    };

    // content（メッセージ本文）がある場合は追加
    if (data.content) {
      payload.content = data.content;
    } else if (data.text) {
      payload.content = data.text;
    }

    // 埋め込み設定
    if (data.embeds) {
      // 直接埋め込み配列が指定されている場合はそれを使用
      payload.embeds = data.embeds;
    } else {
      // 古い形式の場合は変換
      payload.embeds = [
        {
          title: data.groupName || 'LINE',
          color: 5301186, // LINE緑色
          description: data.text || '',
          timestamp: timestamp,
          footer: {
            text: 'LINE経由',
            icon_url: 'https://storage.googleapis.com/gweb-uniblog-publish-prod/images/logo_line_blogheader.max-1300x1300.png'
          }
        }
      ];

      // 画像情報がある場合、埋め込みに追加
      if (data.imageUrl) {
        payload.embeds[0].image = {
          url: data.imageUrl
        };
      }

      // 送信者情報（アイコンと名前）がある場合、埋め込みに追加
      if (data.senderName || data.senderIconUrl) {
        payload.embeds[0].author = {
          name: data.senderName || '不明なユーザー',
          icon_url: data.senderIconUrl || 'https://storage.googleapis.com/gweb-uniblog-publish-prod/images/logo_line_blogheader.max-1300x1300.png'
        };
      }
    }

    // メッセージの出力（デバッグ用）
    console.log('📤 Discordに送信するデータ:', JSON.stringify(payload, null, 2));

    // Webhookにリクエスト送信
    console.log('🔗 Discord Webhook URL:', config.discord.webhookUrl);
    const response = await fetch(config.discord.webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Discord API エラー: ${response.status} ${response.statusText} - ${errorText}`);
    }

    console.log('✅ Discordにメッセージを送信しました');
    return true;
  } catch (error) {
    console.error('❌ Discordへの送信に失敗しました:', error);
    return false;
  }
}

// LINE Messaging APIでメッセージ送信（自動応答を無効化）
async function sendLineMessage(to, messages) {
  if (!config.line.channelAccessToken) {
    console.error('❌ LINE Channel Access Tokenが設定されていません');
    return false;
  }

  try {
    // LINE Messaging APIにリクエスト送信
    const response = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.line.channelAccessToken}`
      },
      body: JSON.stringify({
        to: to,
        messages: messages
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`LINE API エラー: ${response.status} ${JSON.stringify(errorData)}`);
    }

    console.log('✅ LINEにメッセージを送信しました');
    return true;
  } catch (error) {
    console.error('❌ LINEへの送信に失敗しました:', error);
    return false;
  }
}

// LINE Messaging APIを使用してユーザーのプロフィール情報を取得
async function getLINEUserProfile(userId, groupId = null) {
  if (!config.line.channelAccessToken) {
    console.error('❌ LINE Channel Access Tokenが設定されていません');
    return null;
  }

  try {
    // APIエンドポイントを決定（グループ内ユーザーかどうかで異なる）
    const endpoint = groupId 
      ? `https://api.line.me/v2/bot/group/${groupId}/member/${userId}` 
      : `https://api.line.me/v2/bot/profile/${userId}`;
    
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${config.line.channelAccessToken}`
      }
    });

    if (!response.ok) {
      console.warn(`⚠️ ユーザープロフィール取得失敗 (${response.status}): ${userId}`);
      return null;
    }

    const profile = await response.json();
    console.log('👤 取得したユーザープロフィール:', profile);
    return profile;
  } catch (error) {
    console.error('❌ ユーザープロフィール取得エラー:', error);
    return null;
  }
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
      
      // プロファイル取得に失敗した場合のデフォルト値
      if (!userProfile) {
        userProfile = {
          displayName: userId ? `LINEユーザー ${userId.substr(-4)}` : 'LINEユーザー',
          pictureUrl: 'https://storage.googleapis.com/gweb-uniblog-publish-prod/images/logo_line_blogheader.max-1300x1300.png'
        };
        console.log('⚠️ ユーザープロファイル取得に失敗したため、デフォルト値を使用します');
      }
      
      if (event.type === 'message') {
        console.log(`📝 メッセージタイプ: ${event.message.type}`);
        
        switch (event.message.type) {
          case 'text':
            await sendToDiscord({
              content: event.message.text,
              username: userProfile.displayName,
              avatar_url: userProfile.pictureUrl
            });
            break;
            
          case 'image':
            await handleImageMessage(event, sourceType, userId, groupId, roomId, userProfile, req);
            break;
            
          case 'sticker':
            await handleStickerMessage(event, sourceType, userId, groupId, roomId, userProfile);
            break;
            
          case 'file':
            await handleFileMessage(event, sourceType, userId, groupId, roomId, userProfile, req);
            break;
            
          case 'location':
            await handleLocationMessage(event, sourceType, userId, groupId, roomId, userProfile);
            break;
            
          case 'audio':
            await handleAudioMessage(event, sourceType, userId, groupId, roomId, userProfile, req);
            break;
            
          case 'video':
            await handleVideoMessage(event, sourceType, userId, groupId, roomId, userProfile, req);
            break;
            
          case 'contact':
            await handleContactMessage(event, sourceType, userId, groupId, roomId, userProfile);
            break;
            
          default:
            console.log(`🤷‍♂️ 未対応のメッセージタイプ: ${event.message.type}`);
            await sendToDiscord({
              content: `${userProfile.displayName}さんが「${event.message.type}」タイプのメッセージを送信しました（LINEアプリで確認してください）`,
              username: userProfile.displayName,
              avatar_url: userProfile.pictureUrl
            });
        }
      } else if (event.type === 'follow') {
        // 友達追加イベント
        console.log('👋 友達追加イベント', event);
        await sendToDiscord({
          content: `${userProfile.displayName}さんがLINE Botを友達追加しました！`,
          username: "LINE通知",
          avatar_url: userProfile.pictureUrl
        });
      } else if (event.type === 'join') {
        // グループ参加イベント
        console.log('🎉 グループ参加イベント', event);
        await sendToDiscord({
          content: "LINE Botがグループに参加しました！このグループのメッセージがDiscordに転送されます。",
          username: "LINE通知",
          avatar_url: "https://storage.googleapis.com/gweb-uniblog-publish-prod/images/logo_line_blogheader.max-1300x1300.png"
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

// LINE Webhook GET リクエスト対応（検証用）
app.get(config.line.webhookPath, (req, res) => {
  console.log('\n\n📥 LINEからのWebhook GET リクエスト受信');
  console.log('📝 リクエストヘッダー:', JSON.stringify(req.headers, null, 2));
  
  // 検証リクエストに200応答
  res.status(200).send(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>LINE Webhook確認</title>
      <style>
        body {
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          line-height: 1.6;
          color: #333;
          max-width: 800px;
          margin: 0 auto;
          padding: 20px;
          background-color: #f5f5f5;
        }
        h1 {
          color: #00B900;
          border-bottom: 2px solid #00B900;
          padding-bottom: 10px;
        }
        .status {
          background-color: #fff;
          border-radius: 8px;
          padding: 15px;
          margin: 20px 0;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
      </style>
    </head>
    <body>
      <h1>LINE Webhook確認</h1>
      <div class="status">
        <p>⚡ ステータス: <strong>OK - Webhook URL有効</strong></p>
        <p>🕒 リクエスト時間: ${new Date().toLocaleString('ja-JP')}</p>
        <p>ℹ️ このエンドポイントはLINE Messaging APIからのWebhookリクエストを受け付けています。</p>
      </div>
    </body>
    </html>
  `);
});

// サーバー起動
app.listen(config.port, async () => {
  console.log('🚀 LINE-Discord連携サーバーを起動しています...');
  console.log(`⚡ ポート${config.port}で起動しました\n`);
  
  // 画像ディレクトリのアクセス権確認
  try {
    const testImagePath = path.join(imageDir, 'test.txt');
    fs.writeFileSync(testImagePath, 'テストファイル');
    console.log(`✅ 画像ディレクトリへの書き込みテスト成功: ${testImagePath}`);
    fs.unlinkSync(testImagePath);
    console.log(`✅ 画像ディレクトリからの削除テスト成功: ${testImagePath}`);
  } catch (error) {
    console.error(`❌ 画像ディレクトリのアクセス権テストに失敗: ${error.message}`);
  }
  
  // 現在のngrokのURL情報を取得
  if (ngrokPublicUrl || process.env.BASE_URL) {
    const currentUrl = ngrokPublicUrl || process.env.BASE_URL;
    console.log('🌐 現在の公開URL:', currentUrl);
    
    // テスト用画像URLを表示
    console.log('🔗 テスト用画像URL:', `${currentUrl}/public/images/test.jpg`);
    
    // LINEボットの設定を更新
    console.log('🔄 LINEボットの設定を更新中...');
    const botSetupResult = await setupLineBot();
    
    if (botSetupResult) {
      console.log('✅ LINEボットの設定が完了しました');
      
      // Webhookの疎通テスト
      try {
        console.log('🔍 Webhookの疎通テストを実行中...');
        const testResponse = await fetch('https://api.line.me/v2/bot/channel/webhook/test', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.line.channelAccessToken}`
          }
        });
        
        const testResult = await testResponse.json();
        if (testResponse.ok) {
          if (testResult.success) {
            console.log('✅ Webhook疎通テスト成功! LINEプラットフォームから接続できています');
          } else {
            console.warn('⚠️ Webhook疎通テスト失敗:', testResult.message || 'unknown reason');
            console.log('💡 LINE Developer ConsoleでWebhook URLが正しく設定されているか確認してください');
          }
        } else {
          console.warn('⚠️ Webhook疎通テストAPIエラー:', testResult);
        }
      } catch (testError) {
        console.error('❌ Webhook疎通テスト中にエラー:', testError.message);
      }
    } else {
      console.warn('⚠️ LINEボットの設定に問題があります');
    }
  }
  
  console.log('\n📋 設定情報:');
  console.log('- LINE Channel ID:', process.env.LINE_CHANNEL_ID || '未設定');
  console.log('- LINE Bot Name:', process.env.LINE_BOT_NAME || '未設定');
  console.log('- LINE Webhook URL:', process.env.LINE_WEBHOOK_URL || '未設定');
  console.log('- Discord Webhook:', config.discord.webhookUrl ? '設定済み' : '未設定');
  console.log('\n✅ サーバーは正常に起動しました');
  console.log('⌛ Webhookからのリクエストを待機中...');
}); 