const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

const token = '5344559517:AAGRRHJkUVdnMPq1KE5g7DLRK6E2X2C-2Ok';  // توکن خودت
const url = 'https://my-telegram-bot-albl.onrender.com';          // آدرس پروژه رندر خودت
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
  const chatId = msg.chat.id;
  userState[chatId] = {};
  bot.sendMessage(chatId, "سلام! ربات محاسبه‌گر ریت موبایل لجند فعال شد. لطفا تعداد مچ‌هایت را بفرست.");
});

bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!userState[chatId]) return;

  const state = userState[chatId];

  if (!state.totalMatches) {
    const n = parseInt(text);
    if (isNaN(n)) {
      return bot.sendMessage(chatId, "لطفا فقط عدد وارد کن. چند تا مچ بازی کردی؟");
    }
    state.totalMatches = n;
    return bot.sendMessage(chatId, "عالی! ریت فعلیت چند درصده؟ (مثلا 60)");
  }

  if (!state.winRate) {
    const r = parseFloat(text);
    if (isNaN(r)) {
      return bot.sendMessage(chatId, "درصد ریت رو فقط عددی وارد کن.");
    }
    state.winRate = r;
    return bot.sendMessage(chatId, "و میخوای ریتت به چند درصد برسه؟");
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
