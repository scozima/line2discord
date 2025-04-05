// Discord Webhook クライアント
const fetch = require('node-fetch');
require('dotenv').config();

/**
 * Discord Webhookを使用してメッセージを送信する関数
 * @param {Object} data メッセージデータ
 * @param {string} data.text メッセージ本文
 * @param {string} data.username 送信者名
 * @param {string} data.timestamp タイムスタンプ
 * @param {string} data.groupName グループ名（任意）
 * @param {string} data.iconUrl アイコンURL（任意）
 * @param {string} webhookUrl Discord Webhook URL (省略時は環境変数から読み込み)
 * @returns {Promise<boolean>} 送信成功の場合はtrue
 */
async function sendToDiscord(data, webhookUrl = process.env.DISCORD_WEBHOOK_URL) {
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
      content: data.text || '',
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

module.exports = { sendToDiscord }; 