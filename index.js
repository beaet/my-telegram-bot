const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

const token = 'توکن_ربات_تو_اینجا';
const url = 'https://my-telegram-bot-albl.onrender.com';
const port = process.env.PORT || 3000;

const bot = new TelegramBot(token);
bot.setWebHook(`${url}/bot${token}`);

const app = express();
app.use(express.json());

app.post(`/bot${token}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

const userState = {};

bot.onText(/\/start/, (msg) => {
  console.log("Got /start from:", msg.chat.id);
  const chatId = msg.chat.id;
  userState[chatId] = {};
  bot.sendMessage(chatId, "سلام به ربات محاسبه گر ریت موبایل لجند خوش اومدی. من میتونم به طور دقیق بهت بگم که برای رسیدن به ریتی که میخوای باید چند دست وین کنی! برای شروع فقط کافیه تعداد مچ هات رو به صورت عدد بهم بگی");
});

bot.on('message', (msg) => {
  console.log("Got message:", msg.text);
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!userState[chatId]) return;

  const state = userState[chatId];

  if (!state.totalMatches) {
    const n = parseInt(text);
    if (isNaN(n)) {
      return bot.sendMessage(chatId, "فقط عدد وارد کن. چند تا مچ بازی کردی؟");
    }
    state.totalMatches = n;
    return bot.sendMessage(chatId, "عالیه! ریت فعلیت چند درصده؟");
  }

  if (!state.winRate) {
    const r = parseFloat(text);
    if (isNaN(r)) {
      return bot.sendMessage(chatId, "درصد ریت رو فقط عددی وارد کن.");
    }
    state.winRate = r;
    return bot.sendMessage(chatId, "و میخوای که ریتت به چند درصد برسه؟");
  }

  if (!state.targetRate) {
    const t = parseFloat(text);
    if (isNaN(t)) {
      return bot.sendMessage(chatId, "درصد هدف ریت رو عددی وارد کن.");
    }
    state.targetRate = t;

    const { totalMatches, winRate, targetRate } = state;
    const currentWins = totalMatches * winRate / 100;

    const requiredWins = ((targetRate / 100) * totalMatches - currentWins) / (1 - targetRate / 100);
    const x = Math.ceil(requiredWins);

    if (x <= 0) {
      bot.sendMessage(chatId, "ریت فعلیت از هدف بیشتره یا خیلی نزدیکشه. نیازی به برد بیشتر نیست!");
    } else {
      bot.sendMessage(chatId, `برای رسیدن به ${targetRate}% ریت، باید ${x} بازی پشت سر هم ببری!`);
    }

    delete userState[chatId];
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
