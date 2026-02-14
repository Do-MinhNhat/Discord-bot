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
  const { id, type, data, channel_id } = req.body;

  if (type === InteractionType.PING) {
    return res.send({ type: InteractionResponseType.PONG });
  }

  if (type === InteractionType.APPLICATION_COMMAND) {
    const { name, options } = data;

    if (name === 'delete') {
      res.send({
        type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
        data: { flags: InteractionResponseFlags.EPHEMERAL } // Chỉ người gọi mới thấy hoặc không
      });
      
      try {
        // 1. Lấy giá trị number từ options (đã sửa lại đường dẫn lấy data)
        const numberOption = options?.find(opt => opt.name === 'number');
        const limitToDelete = numberOption?.value || 10;

        // 2. Lấy channel từ client (Giả sử bạn đã khởi tạo client ở file này)
        const channel = await client.channels.fetch(channel_id);

        if (!channel) throw new Error("Không tìm thấy channel");

        // 3. Fetch tin nhắn (Tối đa 100 tin gần nhất để lọc)
        const messages = await channel.messages.fetch({ limit: 100 });

        // 4. Lọc tin nhắn của Bot
        const botMessages = messages
          .filter(msg => msg.author.id === client.user.id)
          .first(limitToDelete); // Chỉ lấy số lượng người dùng yêu cầu

        if (botMessages.length > 0) {
          await channel.bulkDelete(botMessages, true);

          // Trả lời phản hồi cho Interaction
          return res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: `🧹 Por đã dọn dẹp xong ${botMessages.length} tin nhắn!`,
            },
          });
        } else {
          return res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: '❌ Không tìm thấy tin nhắn nào của ta để xóa.',
              flags: InteractionResponseFlags.EPHEMERAL,
            },
          });
        }
      } catch (error) {
        console.error('Delete command error:', error);
        // Trả lời lỗi để Interaction không bị treo "Bot is thinking"
        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: { content: '❌ Lỗi: Bot thiếu quyền hoặc lỗi hệ thống.' },
        });
      }
    }
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
