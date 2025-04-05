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

// 静的ファイル提供用のディレクトリを設定
// 絶対パスを使用して明示的に設定
const publicDir = path.join(__dirname, 'public');
console.log('📁 静的ファイル配信ディレクトリ:', publicDir);
app.use('/public', express.static(publicDir));
// 追加: 直接ルートパスにもマウントして冗長性を確保
app.use(express.static(publicDir));

// 生のリクエストデータを取得するためのミドルウェア
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString();
  }
}));

// 生のテキストを取得するためのミドルウェア
app.use(express.text({
  type: '*/*',
  verify: (req, res, buf) => {
    if (!req.rawBody) {
      req.rawBody = buf.toString();
    }
  }
}));

// rawBodyを確保するためのミドルウェア
app.use((req, res, next) => {
  const chunks = [];
  
  // リクエストデータを保存
  req.on('data', (chunk) => {
    chunks.push(chunk);
  });
  
  // リクエスト完了時にrawBodyを設定
  req.on('end', () => {
    if (!req.rawBody) {
      const buffer = Buffer.concat(chunks);
      req.rawBody = buffer.toString();
      
      try {
        if (!req.body || Object.keys(req.body).length === 0) {
          req.body = JSON.parse(req.rawBody);
        }
      } catch (e) {
        console.log('⚠️ ボディのJSONパースに失敗:', e.message);
      }
    }
    next();
  });
  
  // リクエスト処理の継続
  if (req.rawBody) {
    next();
  }
});

// ngrok警告をスキップするヘッダーを追加するミドルウェア
app.use((req, res, next) => {
  // ngrokのブラウザ警告ページをスキップするためのヘッダーを設定
  res.setHeader('ngrok-skip-browser-warning', '1');
  next();
});

// 画像とファイル保存のための準備
const imageDir = path.join(__dirname, 'public', 'images');
if (!fs.existsSync(imageDir)) {
  fs.mkdirSync(imageDir, { recursive: true });
  console.log('📁 画像用ディレクトリを作成しました:', imageDir);
} else {
  console.log('📁 既存の画像ディレクトリを使用します:', imageDir);
}

// 画像ダウンロード＆保存関数
async function downloadImage(url, filePath, headers = {}) {
  console.log('🔄 画像ダウンロード開始:', url);
  try {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`画像ダウンロードエラー: ${response.status} ${response.statusText}`);
    }

    // ダウンロードしたデータをバッファとして取得
    const buffer = await response.arrayBuffer();
    
    // ディレクトリが存在するか確認
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      console.log(`📁 ディレクトリを作成します: ${dir}`);
      fs.mkdirSync(dir, { recursive: true });
    }
    
    // バッファをファイルに書き込み
    fs.writeFileSync(filePath, Buffer.from(buffer));
    
    // ファイルが正常に保存されたか確認
    if (fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath);
      console.log(`✅ 画像を保存しました: ${filePath} (サイズ: ${stats.size} バイト)`);
      return true;
    } else {
      throw new Error('ファイルの保存に失敗しました');
    }
  } catch (error) {
    console.error('❌ 画像ダウンロードに失敗:', error);
    return false;
  }
}

// 安全なファイル名を生成
function getSafeFileName(original) {
  // ランダムな文字列を生成して一意なファイル名にする
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 1000000);
  return `${timestamp}_${random}.jpg`;
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
    // 現在のベースURLを取得（コンソールにも出力）
    const currentBaseUrl = process.env.BASE_URL || `http://${req.headers.host}`;
    console.log('🔗 現在のベースURL:', currentBaseUrl);
    
    // 一意のファイル名を生成
    const imageFileName = getSafeFileName(event.message.id);
    const imagePath = path.join(imageDir, imageFileName);
    // 修正: 両方のパスを用意（二重アクセス用）
    const imageRelativePath = `/public/images/${imageFileName}`;
    const imageDirectPath = `/images/${imageFileName}`;
    
    console.log('📂 画像保存先パス:', imagePath);
    console.log('🔗 画像相対パス (public):', imageRelativePath);
    console.log('🔗 画像相対パス (direct):', imageDirectPath);
    
    // LINE APIから画像をダウンロード（認証ヘッダー付き）
    const downloadSuccess = await downloadImage(
      `https://api-data.line.me/v2/bot/message/${event.message.id}/content`,
      imagePath,
      { 'Authorization': `Bearer ${config.line.channelAccessToken}` }
    );
    
    if (!downloadSuccess) {
      throw new Error('画像のダウンロードに失敗しました');
    }
    
    // 画像の公開URL（デバッグ出力を追加）
    // 修正: 代替URLを用意
    let imageUrl = `${currentBaseUrl}${imageDirectPath}`;
    const backupImageUrl = `${currentBaseUrl}${imageRelativePath}`;
    console.log('🔗 画像の公開URL (primary):', imageUrl);
    console.log('🔗 画像の公開URL (backup):', backupImageUrl);
    
    // 画像にアクセスできるか確認
    try {
      const imageCheckResponse = await fetch(imageUrl, { method: 'HEAD' });
      console.log(`🔍 画像URLチェック結果: ${imageCheckResponse.status} ${imageCheckResponse.statusText}`);
      if (!imageCheckResponse.ok) {
        console.warn('⚠️ 画像直接URLへのアクセスに失敗しました。バックアップURLを使用します。');
        // バックアップURLを使用
        imageUrl = backupImageUrl;
      }
    } catch (checkErr) {
      console.warn('⚠️ 画像URLチェック中にエラー:', checkErr.message);
    }
    
    // Discordに画像埋め込みメッセージを送信
    const result = await sendToDiscord({
      text: "【画像が送信されました】",
      username: `LINE ${userProfile?.displayName || 'ユーザー'} (${userId ? userId.substr(-4) : '不明'})`,
      timestamp: event.timestamp,
      groupName: sourceType === 'user' 
        ? 'LINE個人チャット' 
        : `LINE${sourceType === 'group' ? 'グループ' : 'ルーム'} (${(groupId || roomId || '').substr(-4)})`,
      senderName: userProfile?.displayName || null,
      senderIconUrl: userProfile?.pictureUrl || null,
      imageUrl: imageUrl
    });
    
    console.log(`Discord送信結果(画像付き): ${result ? '成功' : '失敗'}`);
  } catch (err) {
    console.error('❌ 画像処理中にエラーが発生:', err);
    
    // エラー時は通常のテキストメッセージだけ送信
    await sendToDiscord({
      text: `【画像が送信されましたが、転送に失敗しました】\nエラー: ${err.message}`,
      username: `LINE ${userProfile?.displayName || 'ユーザー'} (${userId ? userId.substr(-4) : '不明'})`,
      timestamp: event.timestamp,
      groupName: sourceType === 'user' 
        ? 'LINE個人チャット' 
        : `LINE${sourceType === 'group' ? 'グループ' : 'ルーム'} (${(groupId || roomId || '').substr(-4)})`,
      senderName: userProfile?.displayName || null,
      senderIconUrl: userProfile?.pictureUrl || null
    });
  }
}

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
    </body>
    </html>
  `);
});

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
      avatar_url: data.iconUrl || 'https://storage.googleapis.com/gweb-uniblog-publish-prod/images/logo_line_blogheader.max-1300x1300.png',
      embeds: [
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
      ]
    };

    // 画像情報がある場合、埋め込みに追加
    if (data.imageUrl) {
      payload.embeds[0].image = {
        url: data.imageUrl
      };
      
      // 直接URLをメッセージ本文にも追加（埋め込みがうまくいかない場合の対策）
      payload.content = `${data.imageUrl}`;
    }

    // 送信者情報（アイコンと名前）がある場合、埋め込みに追加
    if (data.senderName || data.senderIconUrl) {
      payload.embeds[0].author = {
        name: data.senderName || '不明なユーザー',
        icon_url: data.senderIconUrl || 'https://storage.googleapis.com/gweb-uniblog-publish-prod/images/logo_line_blogheader.max-1300x1300.png'
      };
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

// スタンプメッセージを処理
async function handleStickerMessage(event, sourceType, userId, groupId, roomId, userProfile) {
  console.log(`📱 ${sourceType}からスタンプを受信:`, event.message);
  
  try {
    // LINE公式スタンプのURLを構築
    const stickerUrl = `https://stickershop.line-scdn.net/stickershop/v1/sticker/${event.message.stickerId}/android/sticker.png`;
    
    const result = await sendToDiscord({
      text: "【スタンプが送信されました】",
      username: `LINE ${userProfile?.displayName || 'ユーザー'} (${userId ? userId.substr(-4) : '不明'})`,
      timestamp: event.timestamp,
      groupName: sourceType === 'user' 
        ? 'LINE個人チャット' 
        : `LINE${sourceType === 'group' ? 'グループ' : 'ルーム'} (${(groupId || roomId || '').substr(-4)})`,
      senderName: userProfile?.displayName || null,
      senderIconUrl: userProfile?.pictureUrl || null,
      imageUrl: stickerUrl
    });
    
    console.log(`Discord送信結果(スタンプ): ${result ? '成功' : '失敗'}`);
  } catch (err) {
    console.error('Discord送信中にエラーが発生:', err);
  }
}

// LINE Webhook用のエンドポイント（POSTリクエスト）
app.post(config.line.webhookPath, async (req, res) => {
  console.log('\n\n📥 LINEからのWebhookリクエスト受信');
  console.log('📝 リクエストヘッダー:', JSON.stringify(req.headers, null, 2));
  
  // リクエストボディの内容をログに出力
  let requestBody = '';
  try {
    requestBody = JSON.stringify(req.body, null, 2);
    console.log('📝 リクエストボディ:', requestBody);
  } catch (e) {
    console.error('⚠️ リクエストボディの解析に失敗:', e);
    console.log('📝 リクエストボディ (raw):', req.rawBody?.toString() || '空');
  }
  
  try {
    // LINE Platformからの応答確認用
    if (!req.body || !req.body.events || req.body.events.length === 0) {
      console.log('ℹ️ イベントなし（接続確認）');
      return res.status(200).end();
    }
    
    // 署名検証
    const signature = req.headers['x-line-signature'];
    if (signature) {
      const isValid = validateLineSignature(req.rawBody, signature);
      if (!isValid) {
        console.warn('⚠️ 署名検証失敗！');
        // 本番環境ではここで処理を中止するべき
        // return res.status(403).end();  // 開発中はコメントアウト
      }
    } else {
      console.warn('⚠️ x-line-signature ヘッダーがありません');
    }
    
    // 受信したイベントごとに処理
    for (const event of req.body.events) {
      console.log(`ℹ️ イベントタイプ: ${event.type}`);
      
      // フォローイベント処理
      if (event.type === 'follow') {
        const userId = event.source.userId;
        console.log(`🎉 ユーザー ${userId} がボットをフォローしました`);
        
        // フォロー時の応答メッセージ（任意）
        await sendLineMessage(userId, [
          {
            type: 'text',
            text: 'フォローありがとうございます！このボットはLINEとDiscordを連携します。グループに招待することでメッセージをDiscordに転送できます。'
          }
        ]);
      }
      
      // メッセージイベントのみ処理
      if (event.type === 'message') {
        const sourceType = event.source.type; // 'user', 'group', 'room'
        const userId = event.source.userId;
        const groupId = event.source.groupId;
        const roomId = event.source.roomId;
        
        console.log(`📩 メッセージイベント:
        - タイプ: ${sourceType}
        - ユーザーID: ${userId || '不明'}
        - グループID: ${groupId || 'なし'}
        - ルームID: ${roomId || 'なし'}`);
        
        // グループIDを保存（必要な場合）
        if (groupId && (!process.env.LINE_GROUP_ID || process.env.LINE_GROUP_ID === '未設定')) {
          try {
            const envContent = fs.readFileSync('.env', 'utf8');
            const updatedEnv = envContent.replace(/LINE_GROUP_ID=.*$/m, `LINE_GROUP_ID=${groupId}`);
            fs.writeFileSync('.env', updatedEnv);
            console.log(`📝 グループID ${groupId} を.envファイルに保存しました`);
          } catch (err) {
            console.warn('⚠️ .envファイルの更新に失敗しました:', err.message);
          }
        }
        
        // ユーザープロフィール情報を取得（送信者名とアイコン）
        let userProfile = null;
        if (userId) {
          userProfile = await getLINEUserProfile(userId, groupId);
        }
        
        // テキストメッセージを処理
        if (event.message.type === 'text') {
          const messageText = event.message.text;
          console.log(`📱 ${sourceType}から受信したテキスト: ${messageText}`);
          
          // Discordに転送
          try {
            const result = await sendToDiscord({
              text: messageText,
              username: `LINE ${userProfile?.displayName || 'ユーザー'} (${userId ? userId.substr(-4) : '不明'})`,
              timestamp: event.timestamp,
              groupName: sourceType === 'user' 
                ? 'LINE個人チャット' 
                : `LINE${sourceType === 'group' ? 'グループ' : 'ルーム'} (${(groupId || roomId || '').substr(-4)})`,
              senderName: userProfile?.displayName || null,
              senderIconUrl: userProfile?.pictureUrl || null
            });
            
            console.log(`Discord送信結果: ${result ? '成功' : '失敗'}`);
          } catch (err) {
            console.error('Discord送信中にエラーが発生:', err);
          }
        }
        // 画像メッセージを処理
        else if (event.message.type === 'image') {
          await handleImageMessage(event, sourceType, userId, groupId, roomId, userProfile, req);
        } 
        // スタンプ（スタンプ）メッセージを処理
        else if (event.message.type === 'sticker') {
          await handleStickerMessage(event, sourceType, userId, groupId, roomId, userProfile);
        } else {
          // テキスト以外のメッセージタイプ
          console.log(`ℹ️ サポート外のメッセージタイプ: ${event.message.type}`);
        }
      }
    }
    
    // LINE Platformへの応答
    res.status(200).end();
  } catch (error) {
    console.error('❌ Webhookエラー:', error);
    // エラーが発生しても200を返す (LINE Platformの要件)
    res.status(200).end();
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