// LINE2Discord連携サーバー
require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const { sendToDiscord } = require('./discordClient');

// 環境変数から設定を読み込む
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET
};

// Expressサーバー初期化
const app = express();

// LINEクライアント初期化
const lineClient = new line.Client(config);

// ルートURLへのアクセスを処理
app.get('/', (req, res) => {
  res.send('LINE to Discord連携サーバーが稼働中です。');
});

// webhook用のエンドポイント
app.post('/webhook', line.middleware(config), (req, res) => {
  console.log('Webhookイベント受信:', JSON.stringify(req.body.events, null, 2));
  
  // 受信したイベントごとに処理
  Promise.all(req.body.events.map(handleEvent))
    .then((result) => res.json(result))
    .catch((err) => {
      console.error('Webhookエラー:', err);
      res.status(500).end();
    });
});

// LINEイベントを処理する関数
async function handleEvent(event) {
  console.log('イベントタイプ:', event.type);
  
  // メッセージイベントのみ処理
  if (event.type !== 'message' || event.message.type !== 'text') {
    return Promise.resolve(null);
  }

  try {
    // 送信元情報を取得
    const groupId = event.source.groupId;
    const userId = event.source.userId;
    const messageText = event.message.text;
    const timestamp = event.timestamp;
    
    console.log('グループID:', groupId);
    console.log('ユーザーID:', userId);
    console.log('受信メッセージ:', messageText);
    
    // ユーザー情報を取得
    let userName = '不明なユーザー';
    let userIcon = null;
    try {
      const profile = await lineClient.getProfile(userId);
      userName = profile.displayName;
      userIcon = profile.pictureUrl;
      console.log('ユーザー情報取得:', profile.displayName);
    } catch (profileError) {
      // グループの場合はgetGroupMemberProfileを使用
      if (groupId) {
        try {
          const groupProfile = await lineClient.getGroupMemberProfile(groupId, userId);
          userName = groupProfile.displayName;
          userIcon = groupProfile.pictureUrl;
          console.log('グループメンバー情報取得:', groupProfile.displayName);
        } catch (groupProfileError) {
          console.warn('グループメンバー情報の取得に失敗:', groupProfileError);
        }
      } else {
        console.warn('ユーザー情報の取得に失敗:', profileError);
      }
    }
    
    // グループ名の取得（できれば）
    let groupName = 'LINEグループ';
    if (groupId) {
      try {
        const groupInfo = await lineClient.getGroupSummary(groupId);
        groupName = groupInfo.groupName;
        console.log('グループ名取得:', groupName);
      } catch (groupError) {
        console.warn('グループ情報の取得に失敗:', groupError);
      }
    }
    
    // Discordに転送
    await sendToDiscord({
      text: messageText,
      username: userName,
      timestamp: timestamp,
      groupName: groupName,
      iconUrl: userIcon
    });
    
    // メッセージの送信元がグループなら、エコーせずに処理完了
    if (event.source.type === 'group') {
      return Promise.resolve(null);
    }
    
    // 個人チャットからのメッセージの場合はエコーバックする（テスト用）
    return lineClient.replyMessage(event.replyToken, {
      type: 'text',
      text: `メッセージを受信しました: ${event.message.text}\nDiscordに転送しました。`
    });
  } catch (error) {
    console.error('エラー発生:', error);
    return Promise.resolve(null);
  }
}

// サーバー起動
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`サーバーがポート${PORT}で起動しました`);
  console.log(`Webhook URL: ${process.env.BASE_URL || 'http://localhost:'}${PORT}${process.env.WEBHOOK_PATH || '/webhook'}`);
}); 