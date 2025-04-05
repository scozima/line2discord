// Discord連携モジュール
require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');

// Discord Bot用の設定
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// 起動時の処理
client.once('ready', () => {
  console.log(`Discord Botが起動しました: ${client.user.tag}`);
});

// エラーハンドリング
client.on('error', (error) => {
  console.error('Discord Botエラー:', error);
});

// Botログイン
client.login(process.env.DISCORD_BOT_TOKEN);

/**
 * LINEメッセージをDiscordに転送する関数
 * @param {Object} data メッセージデータ
 * @param {string} data.text メッセージ本文
 * @param {string} data.username 送信者名
 * @param {string} data.timestamp タイムスタンプ
 * @param {string} data.groupName グループ名（任意）
 * @param {string} data.iconUrl アイコンURL（任意）
 */
async function sendToDiscord(data) {
  try {
    // チャンネルを取得
    const channelId = process.env.DISCORD_CHANNEL_ID;
    const channel = await client.channels.fetch(channelId);
    
    if (!channel) {
      throw new Error(`Discord チャンネルが見つかりません: ${channelId}`);
    }
    
    // 埋め込みメッセージを作成
    const embed = new EmbedBuilder()
      .setColor('#00B900') // LINE色
      .setTitle(data.groupName || 'LINE')
      .setDescription(data.text)
      .setAuthor({
        name: data.username || '不明なユーザー',
        iconURL: data.iconUrl || 'https://storage.googleapis.com/gweb-uniblog-publish-prod/images/logo_line_blogheader.max-1300x1300.png'
      })
      .setTimestamp(new Date(data.timestamp || Date.now()))
      .setFooter({
        text: 'LINE経由',
        iconURL: 'https://storage.googleapis.com/gweb-uniblog-publish-prod/images/logo_line_blogheader.max-1300x1300.png'
      });
    
    // メッセージを送信
    await channel.send({ embeds: [embed] });
    console.log('Discordにメッセージを送信しました');
    return true;
  } catch (error) {
    console.error('Discordへの送信に失敗しました:', error);
    return false;
  }
}

module.exports = { sendToDiscord }; 