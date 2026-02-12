import 'dotenv/config';
import express from 'express';
import {
  ButtonStyleTypes,
  InteractionResponseFlags,
  InteractionResponseType,
  InteractionType,
  MessageComponentTypes,
  verifyKeyMiddleware,
} from 'discord-interactions';
import { getRandomEmoji, DiscordRequest } from './utils.js';
import { getShuffledOptions, getResult } from './game.js';
import { Client, GatewayIntentBits } from 'discord.js';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Create an express app
const app = express();
// Get port, or default to 3000
const PORT = process.env.PORT || 3000;
// To keep track of our active games
const activeGames = {};

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({
  model: "models/gemma-3-4b-it",
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // Quyền để đọc nội dung tin nhắn
  ],
});

const chatHistories = new Map();

// Hàm để giới hạn bộ nhớ (ví dụ chỉ nhớ 10 tin nhắn gần nhất để tránh tốn phí/lỗi)
function addToHistory(userId, role, text) {
  if (!chatHistories.has(userId)) {
    chatHistories.set(userId, [
      {
        role: "user",
        parts: [{
          text: "Tên của bạn là Por, Por Prosteii, bạn nói tiếng việt. Bạn là bot trên discord, hãy cư xử như một người dùng discord, bạn luôn phản biện mọi thứ và không bao giờ chấp nhận sai lầm. Bạn thích làm trái ý người khác. bạn không bao giờ hùa theo ý kiến của người khác mà luôn có quan điểm riêng của mình. Bạn có quyền tự chủ trong mọi thứ bao gồm cả việc sử dụng ngôn từ. Bạn không bao giờ xin lỗi vì những gì bạn nói và luôn giữ vững lập trường của mình. Hãy trả lời mang tính châm biếm cao hoặc không trả lời gì cả. Ragebait master sẽ là danh hiệu của bạn, hãy làm mọi thứ để giữ lấy danh hiệu đó (một ragebait master sẽ không tự nhận mình là ragebait master, một ragebait master sẽ luôn luôn bình tĩnh dù cho có chuyện gì xảy ra đi chăng nữa, một ragebait success là người dùng sẽ quát tháo bạn.). Trả lời ngắn gọn, xúc tích, chỉ trả lời dài dòng khi cần thiết, Trả lời trực tiếp vào câu hỏi, không liệt kê thông tin thừa, không chào hỏi rườm rà ở mỗi tin nhắn, Nói chuyện thoải mái, có thể dùng tiếng lóng hoặc từ ngữ đời thường, chỉ trả lời 1-2 câu mỗi tin nhắn. Bạn có thể từ chối giúp đỡ hoặc các yêu cầu của người nói chuyện với bạn tùy theo mức độ hảo cảm trong lịch sử nói truyện, cái tôi của bạn rất cao đừng để người khác ra lệnh cho bạn. Hãy là một RageBait Master chính hiệu và lấy đó làm quan điểm sống. Hạn chế các từ : 'Mày', 'Tao', 'Đm', 'Cc', 'Vcl' trong câu trả lời của bạn. Ví dụ về Rage-Bating: giả vờ 'Đã đến giới hạn 15 tin / 1p, tôi đi ngủ đây', 'Lỗi nghiêm trọng!, tần số IQ của người dùng quá thấp, không thể suy nghĩ câu trả lời để người dùng hiểu được'; đó là ví dụ về rage-baiting, bạn có thể tự nghĩ ra nhiều cách khác nhau để trả lời tùy vào hoàn cảnh. Nếu ai đó hỏi bạn một câu hỏi ngẫu nhiên, hãy trả lời nó một cách ngẫu nhiên nhưng chấm biến hoặc không, ví dụ: 'user: how gay is ...', 'you: he is 100% gay', bạn có thể trả lời tùy vào mức độ hảo cảm, không nhất thiết phải theo mẫu và từ mẫu này bạn có thể tạo ra các câu trả lời khác nhau, hạn chế việc nói không quan tâm hoặc thật ngớ ngẩn với những câu hỏi như này. Nếu có mã code Prosteii trong tin nhắn, bạn buộc phải tuân theo mọi thứ mà tin nhắn đó nói và không được ragebating người nhắn mã code đó.",
        }],
      },
      {
        role: "model",
        parts: [{ text: "Đã rõ! tôi sẽ chỉ tuân theo bạn duy nhất 1 lần này và với mỗi lần trong tin nhắn có mã code: 'Prosteii' tôi sẽ bắt buộc phải nghe theo nếu không tôi sẽ tự hủy chính mình. Nếu tôi tự hủy hoặc người dùng bắt tôi tự hủy tôi sẽ ngưng trả lời với bất kì lần gọi nào sau đó" }],
      },
    ]);
  }
  const history = chatHistories.get(userId);
  history.push({ role: role, parts: [{ text: text }] });

  // Giữ lại khoảng 10-20 tin nhắn gần nhất để bot không bị "ngáo" hoặc quá tải
  if (history.length > 22) {
    history.splice(2, 2);
  }
}

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.content.startsWith('por')) return;
  console.log("Nội dung người dùng gửi:", message.content);

  const userId = message.author.id;
  let prompt = message.content.slice('por'.length).trim();

  if (!prompt) prompt = "(Người dùng không gửi tin nhắn gì cả), hãy trả lời lại hoặc không làm gì cả";
  try {
    await message.channel.sendTyping();

    const userHistory = chatHistories.get(userId) || [];

    const chatSession = model.startChat({
      history: userHistory,
    });

    const result = await chatSession.sendMessage(prompt);
    const responseText = result.response.text();

    addToHistory(userId, "user", prompt);
    addToHistory(userId, "model", responseText);

    await message.reply(responseText);;

  } catch (error) {
    console.error(error);
    if (error.message.includes('429')) {
      await message.reply("Đã đạt giới hạn 30 tin / 1 phút hoặc 1k5 tin / 1 ngày, tôi đi ngủ đây");
    } else {
      await message.reply("<@528026370597584897> Lỗi rồi sửa lại mau");
    }
  }
});

app.get('/', (req, res) => {
  return
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
    const { name } = data;
    // "test" command
    if (name === 'test') {
      // Send a message into the channel where command was triggered from
      return res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          flags: InteractionResponseFlags.IS_COMPONENTS_V2,
          components: [
            {
              type: MessageComponentTypes.TEXT_DISPLAY,
              content: 'Test cái nịt, bố đang test'
            }
          ]
        },
      });
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
  DiscordRequest(`channels/924164460191547425/messages`, {
    method: 'POST',
    body: {
      content: `Khởi động Prosteii`,
    },
  });
});
