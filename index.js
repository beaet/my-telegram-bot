const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

const token = '5344559517:AAGRRHJkUVdnMPq1KE5g7DLRK6E2X2C-2Ok';  // توکن درست
const url = 'https://my-telegram-bot-albl.onrender.com';  
const port = process.env.PORT || 3000;

const bot = new TelegramBot(token, { webHook: true });
bot.setWebHook(`${url}/bot${token}`);

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
