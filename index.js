const TelegramBot = require('node-telegram-bot-api');

// توکن و آیدی مدیر
const TOKEN = '8129314550:AAFQTvL8VVg-4QtQD8QLY03LCWiSP1uaCak';
const ADMIN_ID = 381183017;

const bot = new TelegramBot(TOKEN, { polling: true });

// دیتابیس موقت (در حافظه)
const users = {};
const welcomeMessage = {
  text: 'سلام! به ربات ما خوش اومدی.',
  buttons: [{ text: 'مشاهده امکانات', callback_data: 'features' }]
};

function canUseFeature(userId) {
  const today = new Date().toDateString();
  if (!users[userId]) users[userId] = { uses: {}, banned: false, invitedBy: null };
  if (users[userId].banned) return false;
  if (users[userId].uses[today] >= 10) return false;
  users[userId].uses[today] = (users[userId].uses[today] || 0) + 1;
  return true;
}

bot.onText(/\/start(?: (.+))?/, (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const ref = match[1];

  if (!users[userId]) {
    users[userId] = { uses: {}, banned: false, invitedBy: null };
    if (ref && ref !== String(userId)) {
      users[userId].invitedBy = ref;
      if (users[ref]) {
        users[ref].bonus = (users[ref].bonus || 0) + 5;
      }
    }
  }

  const buttons = {
    reply_markup: {
      inline_keyboard: [welcomeMessage.buttons]
    }
  };
  bot.sendMessage(chatId, welcomeMessage.text, buttons);
});

bot.on('callback_query', (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;
  if (data === 'features') {
    bot.sendMessage(chatId, 'امکانات:\n- ماشین حساب نرخ\n- آنالیز برد/باخت\n- معرفی به دوستان\n...');
  }
});

bot.onText(/\/rate (\d+) (\d+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const amount = Number(match[1]);
  const rate = Number(match[2]);

  if (!canUseFeature(msg.from.id)) return bot.sendMessage(chatId, 'محدودیت روزانه رسیدی یا بن شدی.');

  const result = amount * rate;
  bot.sendMessage(chatId, `نتیجه: ${result}`);
});

bot.onText(/\/analyze (.+)/, (msg, match) => {
  const input = match[1].split(',').map(x => x.trim().toLowerCase());
  const chatId = msg.chat.id;
  if (!canUseFeature(msg.from.id)) return bot.sendMessage(chatId, 'محدودیت روزانه رسیدی یا بن شدی.');

  let wins = 0, losses = 0;
  input.forEach(val => {
    if (val === 'win') wins++;
    else if (val === 'lose') losses++;
  });
  bot.sendMessage(chatId, `برد: ${wins}\nباخت: ${losses}`);
});

bot.onText(/\/me/, (msg) => {
  const id = msg.from.id;
  const info = users[id] || {};
  bot.sendMessage(msg.chat.id,
    `آیدی: ${id}\nبن: ${info.banned ? 'بله' : 'خیر'}\nدعوت‌کننده: ${info.invitedBy || 'نداری'}\nپاداش: ${info.bonus || 0}`);
});

bot.onText(/\/ban (\d+)/, (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  const target = match[1];
  if (!users[target]) users[target] = { uses: {}, banned: false };
  users[target].banned = true;
  bot.sendMessage(msg.chat.id, `کاربر ${target} بن شد.`);
});

bot.onText(/\/unban (\d+)/, (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  const target = match[1];
  if (!users[target]) users[target] = { uses: {}, banned: false };
  users[target].banned = false;
  bot.sendMessage(msg.chat.id, `کاربر ${target} آنبن شد.`);
});

bot.onText(/\/setwelcome (.+)/, (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  welcomeMessage.text = match[1];
  bot.sendMessage(msg.chat.id, 'پیام خوش‌آمدگویی آپدیت شد.');
});

bot.onText(/\/setbutton (.+)/, (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  const text = match[1];
  welcomeMessage.buttons = [{ text, callback_data: 'features' }];
  bot.sendMessage(msg.chat.id, 'دکمه خوش‌آمدگویی آپدیت شد.');
});
