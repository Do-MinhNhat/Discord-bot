import 'dotenv/config';
import express from 'express';
import { DiscordRequest } from './utils.js';
import { Client, GatewayIntentBits } from 'discord.js';
import { sendGeminiMessage } from './core/gemini.js';
import { verifyKeyMiddleware } from 'discord-interactions';
import { InteractionType, InteractionResponseType, InteractionResponseFlags, MessageComponentTypes } from 'discord-interactions';
import { getRandomEmoji } from './utils.js';


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
      messageContent = 'Hãy trả lời tất cả các câu hỏi mà tôi hoặc những người khác vừa gửi hoặc đã gửi trước đó hoặc chào tôi nếu không có gì liên quan tới bạn.';

    // Quan trọng: Gắn tên người gửi để AI biết ai đang nói với ai
    const content = role === 'model' ? `${messageContent}` : `Name & Id(${msg.author.username} - ${msg.author.id}): ${messageContent}`;

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

/**
 * Interactions endpoint URL where Discord will send HTTP requests
 * Parse request body and verifies incoming requests using discord-interactions package
 */
app.post('/interactions', verifyKeyMiddleware(process.env.PUBLIC_KEY), async function (req, res) {
  // Interaction id, type and data
  const { id, type, data } = req.body;

  /**
   * Handle verification requests
   */
  if (type === InteractionType.PING) {
    return res.send({ type: InteractionResponseType.PONG });
  }

  /**
   * Handle slash command requests
   * See https://discord.com/developers/docs/interactions/application-commands#slash-commands
   */
  if (type === InteractionType.APPLICATION_COMMAND) {
    const { name, options } = data;

    // "delete" command
    if (name === 'delete') {
      try {
        // Delete specific number of bot messages
        const number = options[0].options?.[0]?.value;

        if (!number || number < 1) {
          return res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: 'Hãy nhập số lượng lớn hơn 0.',
              flags: InteractionResponseFlags.EPHEMERAL,
            },
          });
        }

        const messages = await message.channel.messages.fetch({ limit: 100 });

        const botMessages = messages.filter(msg => msg.author.id === client.user.id);

        if (botMessages.size > 0) {
          await message.channel.bulkDelete(botMessages, true);
          message.channel.send("🧹 Đã dọn dẹp các phản hồi cũ của Por!").then(m => {
            setTimeout(() => m.delete(), 3000); // Tự xóa thông báo này sau 3s
          });
        }
        else {
          return res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: '❌ Không tìm thấy tin nhắn của bot để xóa.',
              flags: InteractionResponseFlags.EPHEMERAL,
            },
          });
        }

        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: `✅ Đã xóa ${botMessages.size} tin nhắn của bot.`
          },
        });
      } catch (error) {
        console.error('Delete command error:', error);
        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: '❌ Đã xảy ra lỗi khi xóa tin nhắn.',
            flags: InteractionResponseFlags.EPHEMERAL,
          },
        });
      }
    }

    console.error(`unknown command: ${name}`);
    return res.status(400).json({ error: 'unknown command' });
  }

  console.error('unknown interaction type', type);
  return res.status(400).json({ error: 'unknown interaction type' });
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
