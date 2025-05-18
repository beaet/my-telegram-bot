const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const { Configuration, OpenAIApi } = require('openai');

const token = '5344559517:AAGRRHJkUVdnMPq1KE5g7DLRK6E2X2C-2Ok';  // توکن تلگرام تو
const url = 'https://my-telegram-bot-albl.onrender.com';       // آدرس پروژه Render تو
const port = process.env.PORT || 3000;

const openaiApiKey = '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';

const configuration = new Configuration({
  apiKey: openaiApiKey,
});
const openai = new OpenAIApi(configuration);

const bot = new TelegramBot(token, { webHook: true });
bot.setWebHook(`${url}/bot${token}`);

const app = express();
app.use(express.json());

app.post(`/bot${token}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, "سلام! بهم یه توضیح بده، برات عکس می‌سازم.");
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (text.startsWith('/start')) return;

  bot.sendMessage(chatId, "در حال ساخت عکس، صبر کن...");

  try {
    const response = await openai.createImage({
      prompt: text,
      n: 1,
      size: "512x512",
    });

    const imageUrl = response.data.data[0].url;
    bot.sendPhoto(chatId, imageUrl);

  } catch (error) {
    console.error(error);
    bot.sendMessage(chatId, "متاسفانه نتونستم عکس بسازم.");
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
