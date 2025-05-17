const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

const token = '5344559517:AAGRRHJkUVdnMPq1KE5g7DLRK6E2X2X-2Ok';  // توکن ربات تو

const url = 'https://YOUR_RENDER_APP_URL/';  // بعد از ساخت پروژه Render، این آدرس رو جایگزین کن
const port = process.env.PORT || 3000;

const bot = new TelegramBot(token);
bot.setWebHook(`${url}bot${token}`);

const app = express();
app.use(express.json());

app.post(`/bot${token}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, "سلام! ربات Node.js روی Render فعال شد.");
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});