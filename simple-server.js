// 簡易的なLINE Webhook受信テスト用サーバー
require('dotenv').config();
const express = require('express');
const crypto = require('crypto');

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
  res.send('LINE Webhook テストサーバーが稼働中です。');
});

// LINE Webhook署名検証関数
function validateSignature(rawBody, signature) {
  const channelSecret = process.env.LINE_CHANNEL_SECRET;
  const hash = crypto
    .createHmac('sha256', channelSecret)
    .update(rawBody)
    .digest('base64');
  
  return hash === signature;
}

// webhook用のエンドポイント
app.post('/webhook', (req, res) => {
  console.log('Webhookリクエスト受信');
  
  try {
    // リクエストヘッダー確認
    console.log('リクエストヘッダー:', req.headers);
    
    // 署名検証
    const signature = req.headers['x-line-signature'];
    if (signature) {
      const isValid = validateSignature(req.rawBody, signature);
      console.log('署名検証結果:', isValid ? '有効' : '無効');
      if (!isValid) {
        console.warn('署名検証失敗');
        // 署名検証失敗でも200を返す (デバッグのため)
      }
    }
    
    // 受信したイベントデータを表示
    console.log('受信データ:', JSON.stringify(req.body, null, 2));
    
    // LINE Platformへの応答 - 必ず200を返す
    res.status(200).end();
  } catch (error) {
    console.error('Webhookエラー:', error);
    // エラーが発生しても200を返す (LINEプラットフォームの要件)
    res.status(200).end();
  }
});

// 他のエンドポイント (テスト用)
app.get('/webhook', (req, res) => {
  res.send('GET /webhook - このエンドポイントはLINE Webhookで使用されます。POSTリクエストを送信してください。');
});

// サーバー起動
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`テストサーバーがポート${PORT}で起動しました`);
  console.log(`Webhook URL: ${process.env.BASE_URL || 'http://localhost:' + PORT}/webhook`);
  console.log('注意: 外部からアクセスするには、ngrokなどのトンネリングサービスが必要です');
}); 