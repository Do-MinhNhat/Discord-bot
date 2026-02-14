import 'dotenv/config';
import express from 'express';
import { DiscordRequest } from './utils.js';
import { Client, GatewayIntentBits } from 'discord.js';
import { sendGeminiMessage } from './core/gemini.js';

const app = express();
const PORT = process.env.PORT || 3000;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

async function getFullChannelHistory(channel, limit = 20) {
  const messages = await channel.messages.fetch({ limit });
  // Đảo ngược để tin cũ lên đầu
  const sorted = Array.from(messages.values()).reverse();

  return sorted.reduce((acc, msg) => {
    // 1. Bỏ qua tin nhắn nếu nó không có nội dung chữ (chỉ có ảnh/embed)
    if (!msg.content && msg.attachments.size === 0) return acc;
    // Xác định vai trò: Nếu là Bot của bạn thì là 'model', còn lại là 'user'
    const role = msg.author.id === client.user.id ? "model" : "user";

    // Loại bỏ 'por' ở đầu câu nếu là user
    let messageContent = msg.content;
    if (role === 'user' && messageContent.startsWith('por')) {
      messageContent = messageContent.slice(3).trim();
    }

    if (messageContent.length === 0)
      messageContent = 'Hãy trả lời tất cả các câu hỏi mà tôi hoặc những người khác vừa gửi hoặc đã gửi trước đó.';

    // Quan trọng: Gắn tên người gửi để AI biết ai đang nói với ai
    const content = role === 'model' ? `${messageContent}` : `Name(${msg.author.username}): ${messageContent}`;

    if (acc.length > 0 && acc[acc.length - 1].role === role) {
      acc[acc.length - 1].parts[0].text += ` \n ${content}`;
    } else {
      acc.push({ role, parts: [{ text: content }] });
    }
    return acc;
  }, []);
}

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.content.startsWith('por')) return;

  const fullHistory = await getFullChannelHistory(message.channel, 15);

  const LastMessage = fullHistory[fullHistory.length - 1];

  const historyWithoutLast = fullHistory.slice(0, -1);

  const prompt = LastMessage.parts[0].text;

  try {
    await message.channel.sendTyping();

    const responseText = await sendGeminiMessage(prompt, historyWithoutLast);
    await message.reply(`${responseText}`);

  } catch (error) {
    console.error('AI Error:', error);
    await message.reply("Hệ thống đang lỗi, vui lòng thử lại sau");
  }
});

app.get('/say', async (req, res) => {
  const { message, CHANNEL_ID } = req.query;

  if (!message || !CHANNEL_ID) {
    return res.status(400).send('Thiếu nội dung hoặc ID kênh!');
  }

  try {
    await DiscordRequest(`channels/${CHANNEL_ID}/messages`, {
      method: 'POST',
      body: { content: message },
    });
    return res.send(`Bot đã nói: ${message}`);
  } catch (err) {
    console.error(err);
    return res.status(500).send('Lỗi khi bot đang cố gắng nói.');
  }
});

client.login(process.env.DISCORD_TOKEN);

app.listen(PORT, () => {
  console.log('Listening on port', PORT);
  DiscordRequest(`channels/1471517352079396905/messages`, {
    method: 'POST',
    body: {
      content: `Khởi động Prosteii`,
    },
  });
});
