import 'dotenv/config';
import express from 'express';
import { DiscordRequest } from './utils.js';
import { Client, GatewayIntentBits } from 'discord.js';
import { sendGeminiMessage, startGemini } from './core/gemini.js';
import { verifyKeyMiddleware } from 'discord-interactions';
import { InteractionType, InteractionResponseType } from 'discord-interactions';


const app = express();
const PORT = process.env.PORT || 3000;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

var chatSession = null;

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
      messageContent = '[Tin nhắn này dùng để gọi AI phản hồi, không có nội dung chữ]';

    // Quan trọng: Gắn tên người gửi để AI biết ai đang nói với ai
    const content = role === 'model' ? `${messageContent}` : `<@${msg.author.id}>: ${messageContent}`;

    if (acc.length > 0 && acc[acc.length - 1].role === role) {
      acc[acc.length - 1].parts[0].text += `\n${content}`;
    } else {
      acc.push({ role, parts: [{ text: content }] });
    }
    return acc;
  }, []);
}


client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.content.startsWith('por')) return;
  if (!chatSession) {
    await message.reply("Hệ thống chưa được khởi động, vui lòng sử dụng lệnh /start");
    return;
  }

  const fullHistory = await getFullChannelHistory(message.channel, 15);

  const LastMessage = fullHistory[fullHistory.length - 1];
  const lines = LastMessage.parts[0].text.split('\n');
  lines[lines.length - 1] += " << [Yêu cầu chính, phía trên là lịch sử hội thoại để tham khảo, có thể bỏ qua nếu không liên quan]";
  const prompt = lines.join('\n');

  try {
    await message.channel.sendTyping();

    const responseText = await sendGeminiMessage(prompt,chatSession);
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
  const { type, data, channel_id, token } = req.body; // Lấy thêm token ở đây

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

    if (name === 'stop') {
      chatSession = null;
      return res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: `Hệ thống đã được dừng!`,
        },
      });
    }

    if (name === 'start') {
      const instruction = options?.find(opt => opt.name === 'instruction')?.value || null;
      const model = options?.find(opt => opt.name === 'model')?.value || 0;
      try {
        chatSession = await startGemini(instruction, model);
        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: `Hệ thống đã được khởi động!`,
          },
        });
      } catch (error) {
        console.error('Error starting Chat Bot:', error);
        return res.status(500).send({ error: 'Failed to start Chat Bot' });
      }
    }

    // "delete" command
    if (name === 'delete') {
      const channel = await client.channels.fetch(channel_id);

      if (!channel) throw new Error("Không tìm thấy channel");

      const endpoint = `webhooks/${process.env.APP_ID}/${token}/messages/@original`;
      
      try {
        res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: `Đang duyệt qua các tin nhắn...`,
          },
        });
        // Fetch messages (max 100 to filter)
        const messages = await channel.messages.fetch({ limit: 100 });

        // Filter bot messages
        const botMessages = messages
          .filter(msg => msg.author.id === client.user.id)
          .first(options[0].value);
        
        if (botMessages.length > 0) {
          await DiscordRequest(endpoint, {
            method: 'PATCH',
            body: { content: `Đang dọn dẹp các tin nhắn...` }
          });
          let deletedCount = 0;
          for (const msg of botMessages) {
            try {
              await msg.delete();
              deletedCount++;
            } catch (error) {
              console.error('Failed to delete message:', error);
            }
          }

          await DiscordRequest(endpoint, {
            method: 'PATCH',
            body: { content: `Đã dọn xong ${deletedCount} tin nhắn!` }
          });

        } else {
          return await DiscordRequest(endpoint, {
            method: 'PATCH',
            body: { content: `Không tìm thấy tin nhắn nào` }
          });
        }

        setTimeout(async () => {
          await DiscordRequest(endpoint, { method: 'DELETE' }).catch(() => { });
        }, 3000);
        
        return;
      } catch (error) {
        console.error('Delete command error:', error);
        return await DiscordRequest(endpoint, {
          method: 'PATCH',
          body: { content: `Lỗi: ${error.message}` }
        });
      }
    }
    console.error(`unknown command: ${name}`);
    return res.status(400).json({ error: 'unknown command' });
  }
  console.error('unknown interaction type', type);
  return res.status(400).json({ error: 'unknown interaction type' });
});



app.listen(PORT, () => {
  console.log('Listening on port', PORT);
  DiscordRequest(`channels/1471517352079396905/messages`, {
    method: 'POST',
    body: {
      content: `Khởi động Prosteii`,
    },
  });
});

client.login(process.env.DISCORD_TOKEN);