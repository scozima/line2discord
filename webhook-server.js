// LINE-Discord連携サーバー
require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const fetch = require('node-fetch');

// Expressサーバー初期化
const app = express();
// 生のリクエストデータを取得するためのミドルウェア
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

// ルートURLへのアクセスを処理
app.get('/', (req, res) => {
  res.send('LINE-Discord連携サーバーが稼働中です。');
});

// LINE Webhook署名検証関数
function validateLineSignature(rawBody, signature) {
  const channelSecret = process.env.LINE_CHANNEL_SECRET;
  const hash = crypto
    .createHmac('sha256', channelSecret)
    .update(rawBody)
    .digest('base64');
  
  return hash === signature;
}

// Discord Webhookにメッセージ送信
async function sendToDiscord(data) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    console.error('Discord Webhook URLが設定されていません');
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

    // Webhookにリクエスト送信
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Discord API エラー: ${response.status} ${response.statusText}`);
    }

    console.log('Discordにメッセージを送信しました');
    return true;
  } catch (error) {
    console.error('Discordへの送信に失敗しました:', error);
    return false;
  }
}

// LINE Webhook用のエンドポイント
app.post('/webhook', async (req, res) => {
  console.log('LINEからWebhookリクエスト受信');
  
  try {
    // 署名検証
    const signature = req.headers['x-line-signature'];
    if (signature) {
      const isValid = validateLineSignature(req.rawBody, signature);
      console.log('署名検証結果:', isValid ? '有効' : '無効');
      if (!isValid) {
        console.warn('署名検証失敗!');
        // LINE Platformには常に200を返す（デバッグ中は続行）
      }
    }
    
    // LINE Platformからの応答確認用
    if (!req.body.events || req.body.events.length === 0) {
      console.log('イベントなし（接続確認）');
      return res.status(200).end();
    }
    
    // 受信したイベントごとに処理
    for (const event of req.body.events) {
      console.log('イベントタイプ:', event.type);
      
      // メッセージイベントのみ処理
      if (event.type === 'message' && event.message.type === 'text') {
        const groupId = event.source.groupId;
        const userId = event.source.userId;
        const messageText = event.message.text;
        const timestamp = event.timestamp;
        
        console.log(`メッセージ受信 [${event.source.type}]: ${messageText}`);
        
        // Discordに転送
        await sendToDiscord({
          text: messageText,
          username: userId ? `LINEユーザー (${userId.substr(-4)})` : '不明なユーザー',
          timestamp: timestamp,
          groupName: groupId ? `LINEグループ (${groupId.substr(-4)})` : 'LINE個人チャット',
        });
      }
    }
    
    // LINE Platformへの応答
    res.status(200).end();
  } catch (error) {
    console.error('Webhookエラー:', error);
    // エラーが発生しても200を返す (LINE Platformの要件)
    res.status(200).end();
  }
});

// サーバー起動
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`連携サーバーがポート${PORT}で起動しました`);
  console.log(`Webhook URL: ${process.env.BASE_URL || 'http://localhost:' + PORT}/webhook`);
}); 