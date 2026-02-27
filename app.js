import 'dotenv/config';
import express from 'express';
import { DiscordRequest } from './utils.js';
import { Client, GatewayIntentBits } from 'discord.js';
import { sendGeminiMessage, startGemini, setInstruction } from './core/gemini.js';
import { verifyKeyMiddleware, InteractionType, InteractionResponseType } from 'discord-interactions';

const app = express();
const PORT = process.env.PORT || 3000;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const chatSessions = new Map(); // Lưu trữ chat session theo Server

async function sendLog(APP_ID, token, textContent) {
  if (!textContent) {
    textContent = "Log rỗng";
  }

  // Split nếu quá dài (Discord limit 2000 chars)
  const chunks = textContent.match(/[\s\S]{1,1900}/g) || [textContent];

  for (const chunk of chunks) {
    await DiscordRequest(`webhooks/${process.env.APP_ID}/${token}`, {
      method: 'POST',
      body: {
        content: `\`\`\`json\n${chunk}\n\`\`\``,
        flags: 64
      },
    });
  }
}

async function getContext(channel, limit = 30) {
  const messages = await channel.messages.fetch({ limit });
  // Đảo ngược để tin cũ lên đầu
  const sorted = Array.from(messages.values()).reverse();

  // Tìm vị trí tin nhắn cuối cùng của AI, chỉ lấy từ đó trở đi
  let lastBotIndex = -1;
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i].author.id === client.user.id) {
      lastBotIndex = i;
      break;
    }
  }
  // Chỉ lấy tin nhắn user sau lần trả lời cuối của AI (bỏ tin AI)
  const relevant = lastBotIndex === -1 ? sorted : sorted.slice(lastBotIndex + 1);

  // Gom nhóm tin nhắn liên tiếp cùng người gửi
  const grouped = [];
  for (const msg of relevant) {
    if (!msg.content && msg.attachments.size === 0) continue;

    let messageContent = msg.content;
    if (messageContent.startsWith('por')) {
      messageContent = messageContent.slice(3).trim();
    }

    const last = grouped[grouped.length - 1];
    if (last && last.authorId === msg.author.id) {
      // Cùng người gửi: gom vào cùng 1 content
      last.contents.push(messageContent);
    } else {
      grouped.push({
        authorId: msg.author.id,
        authorName: msg.author.username,
        contents: [messageContent],
      });
    }
  }

  const allMessages = grouped.map(group => ({
    [`${group.authorName}-${group.authorId}`]: {
      content: group.contents.join('\n')
    }
  }));

return `\`\`\`json\n${JSON.stringify(allMessages, null, 2)}\n\`\`\``;
}

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.content.startsWith('por')) return;
  const chatSession = chatSessions.get(message.guildId);
  if (!chatSession) {
    await message.reply("Hệ thống chưa được khởi động, vui lòng sử dụng lệnh /start");
    return;
  }

  const context = await getContext(message.channel);

  try {
    await message.channel.sendTyping();

    const responseText = await sendGeminiMessage(context, chatSession);

    responseText.split('\n').forEach(line => {
      if (line.trim().length > 0) {
        message.channel.send(line);
      }
    });

  } catch (error) {
    console.error('AI Error:', error);
    await message.reply("Hệ thống đang lỗi, vui lòng thử lại sau");
  }
});

app.get('/say', async (req, res) => {
  const { id, msg } = req.query;

  if (!msg || !id) {
    return res.status(400).send('Thiếu nội dung hoặc ID kênh!');
  }

  try {
    await DiscordRequest(`channels/${id}/messages`, {
      method: 'POST',
      body: { content: msg },
    });
    return res.send(`Bot đã nói: ${msg}`);
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
  const { type, data, channel_id, token, guild_id } = req.body; // Lấy thêm token ở đây

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
    const endpoint = `webhooks/${process.env.APP_ID}/${token}/messages/@original`;

    if (name === 'set_instruction') {
      const instruction = options?.find(opt => opt.name === 'instruction')?.value || null;
      setInstruction(instruction);
      return res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: `Đã cập nhật hướng dẫn mới!`,
          flags: 64,
        },
      });
    }

    if (name === 'log') {
      const chatSession = chatSessions.get(guild_id);
      if (!chatSession || !chatSession.getHistory) {
        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: `Log rỗng`,
            flags: 64,
          },
        });
      }
      res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: `Đang gửi log...`,
          flags: 64,
        },
      });
      try {
        const history = await chatSession.getHistory()
        // Chỉ lấy phần JSON từ các entry (loại bỏ text thường)
        const jsonParts = history
          .map(entry => entry.parts.map(p => p.text).join(''))
          .map(text => {
            const match = text.match(/```json\n([\s\S]*?)\n```/);
            return match ? match[1] : null;
          })
          .filter(Boolean);
        const log = jsonParts.join('\n');
        await sendLog(process.env.APP_ID, token, log);
      }
      catch (error) {
        console.error('Error fetching log:', error);
        await DiscordRequest(endpoint, {
          method: 'PATCH',
          body: { content: 'Lỗi khi lấy log!', flags: 64 },
        });
      }
      return;
    }

    if (name === 'stop') {
      chatSessions.delete(guild_id);
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
        const chatSession = await startGemini(instruction, model);
        chatSessions.set(guild_id, chatSession);
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

      try {
        res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: `Đang duyệt qua các tin nhắn...`,
            flags: 64,
          },
        });

        const messages = await channel.messages.fetch({ limit: 100 });

        // Filter bot messages
        const botMessages = messages
          .filter(msg => msg.author.id === client.user.id)
          .first(options[0].value);

        if (botMessages.length > 0) {
          await DiscordRequest(endpoint, {
            method: 'PATCH',
            body: { content: `Đang dọn dẹp các tin nhắn...`, flags: 64 }
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
          return await DiscordRequest(endpoint, {
            method: 'PATCH',
            body: { content: `Đã dọn xong ${deletedCount} tin nhắn!`, flags: 64 }
          });
        }
        return await DiscordRequest(endpoint, {
          method: 'PATCH',
          body: { content: `Không tìm thấy tin nhắn nào`, flags: 64 }
        });
      } catch (error) {
        console.error('Error deleting messages:', error);
        return await DiscordRequest(endpoint, {
          method: 'PATCH',
          body: { content: `Lỗi khi xóa tin nhắn!`, flags: 64 }
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