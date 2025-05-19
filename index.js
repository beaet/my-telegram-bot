const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const token = '8129314550:AAFQTvL8VVg-4QtQD8QLY03LCWiSP1uaCak';
const adminPanelId = 381183017;
const url = 'https://my-telegram-bot-albl.onrender.com';
const port = process.env.PORT || 3000;

const bot = new TelegramBot(token);
bot.setWebHook(`${url}/bot${token}`);

const app = express();
app.use(express.json());

const db = new sqlite3.Database('./botdata.sqlite', (err) => {
  if (err) return console.error(err.message);
  console.log('Connected to SQLite database');
});

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    chat_id INTEGER PRIMARY KEY,
    username TEXT,
    is_admin INTEGER DEFAULT 0,
    muted_until INTEGER DEFAULT 0
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )`);

  const defaultMessages = {
    welcome: "سلام به گروه خوش آمدید!",
    mute: "شما ساکت شده‌اید.",
    kick: "شما از گروه اخراج شدید."
  };

  for (const [key, value] of Object.entries(defaultMessages)) {
    db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`, [key, value]);
  }
});

const userState = {};

function getSetting(key) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT value FROM settings WHERE key = ?`, [key], (err, row) => {
      if (err) return reject(err);
      resolve(row ? row.value : null);
    });
  });
}

function setSetting(key, value) {
  return new Promise((resolve, reject) => {
    db.run(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, [key, value], (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

function addOrUpdateUser(chatId, username) {
  db.run(`INSERT INTO users(chat_id, username) VALUES(?, ?) ON CONFLICT(chat_id) DO UPDATE SET username=excluded.username`, [chatId, username]);
}

async function isAdmin(chatId, userId) {
  try {
    const admins = await bot.getChatAdministrators(chatId);
    return admins.some(a => a.user.id === userId);
  } catch {
    return false;
  }
}

app.post(`/bot${token}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  addOrUpdateUser(chatId, msg.from.username || '');
  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [{ text: "محاسبه ریت موبایل لجند", callback_data: "calc_rate" }],
        [{ text: "چند دست بردم چند دست باختم؟", callback_data: "calc_wins_losses" }]
      ]
    }
  };
  await bot.sendMessage(chatId, "سلام! من ربات محاسبه‌گر ریت هستم. انتخاب کنید:", keyboard);
});

bot.on('callback_query', async (callbackQuery) => {
  const msg = callbackQuery.message;
  const userId = callbackQuery.from.id;
  const data = callbackQuery.data;

  if (data === 'calc_rate') {
    bot.sendMessage(msg.chat.id, "لطفا تعداد مچ‌هایت را وارد کن.");
    userState[userId] = { action: 'calc_rate' };
  } else if (data === 'calc_wins_losses') {
    bot.sendMessage(msg.chat.id, "لطفا تعداد مچ‌هایت را وارد کن.");
    userState[userId] = { action: 'calc_wins_losses' };
  }
});

bot.on('message', async (msg) => {
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!userState[userId]) return;

  const state = userState[userId];

  if (state.action === 'calc_rate') {
    const totalMatches = parseInt(text);
    if (isNaN(totalMatches)) {
      return bot.sendMessage(chatId, "لطفا فقط عدد وارد کن.");
    }
    state.totalMatches = totalMatches;
    bot.sendMessage(chatId, "عالی! ریت فعلیت چند درصده؟");
    state.action = 'calc_rate_win_rate';
  } else if (state.action === 'calc_rate_win_rate') {
    const winRate = parseFloat(text);
    if (isNaN(winRate)) {
      return bot.sendMessage(chatId, "درصد ریت رو فقط عددی وارد کن.");
    }
    state.winRate = winRate;
    bot.sendMessage(chatId, "و میخوای ریتت به چند درصد برسه؟");
    state.action = 'calc_rate_target_rate';
  } else if (state.action === 'calc_rate_target_rate') {
    const targetRate = parseFloat(text);
    if (isNaN(targetRate)) {
      return bot.sendMessage(chatId, "درصد هدف ریت رو عددی وارد کن.");
    }
    state.targetRate = targetRate;

    const currentWins = state.totalMatches * state.winRate / 100;
    const requiredWins = ((state.targetRate / 100) * state.totalMatches - currentWins) / (1 - state.targetRate / 100);
    const x = Math.ceil(requiredWins);

    if (x <= 0) {
      bot.sendMessage(chatId, "ریت فعلیت از هدف بیشتره یا خیلی نزدیکشه. نیازی به برد بیشتر نیست!");
    } else {
      bot.sendMessage(chatId, `برای رسیدن به ${state.targetRate}% ریت، باید ${x} بازی پشت سر هم ببری!`);
    }

    delete userState[userId];
  } else if (state.action === 'calc_wins_losses') {
    const totalMatches = parseInt(text);
    if (isNaN(totalMatches)) {
      return bot.sendMessage(chatId, "لطفا فقط عدد وارد کن.");
    }
    state.totalMatches = totalMatches;
    bot.sendMessage(chatId, "عالی! ریت فعلیت چند درصده؟");
    state.action = 'calc_wins_losses_win_rate';
  } else if (state.action === 'calc_wins_losses_win_rate') {
    const winRate = parseFloat(text);
    if (isNaN(winRate)) {
      return bot.sendMessage(chatId, "درصد ریت رو فقط عددی وارد کن.");
    }
    state.winRate = winRate;

    const currentWins = state.totalMatches * state.winRate / 100;
    const currentLosses = state.totalMatches - currentWins;

    bot.sendMessage(chatId, `تا به الان ${Math.round(currentWins)} دست بردی و ${Math.round(currentLosses)} دست باختی.`);
    delete userState[userId];
  }
});

bot.onText(/\/panel/, async (msg) => {
  if (msg.from.id !== adminPanelId) {
    return bot.sendMessage(msg.chat.id, "شما اجازه دسترسی به پنل مدیریتی رو ندارید.");
  }

  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [{ text: "تنظیم پیام خوش‌آمد", callback_data: "edit_welcome" }],
        [{ text: "تنظیم پیام سکوت", callback_data: "edit_mute" }],
        [{ text: "تنظیم پیام اخراج", callback_data: "edit_kick" }],
        [{ text: "ارسال پیام به همه کاربران", callback_data: "send_to_all" }]
      ]
    }
  };

  await bot.sendMessage(msg.chat.id, "پنل مدیریت ربات:", keyboard);
});

bot.on('callback_query', async (callbackQuery) => {
  const msg = callbackQuery.message;
  const userId = callbackQuery.from.id;
  const data = callbackQuery.data;

  if (userId !== adminPanelId) {
    return bot.answerCallbackQuery(callbackQuery.id, { text: "دسترسی ندارید." });
  }

  if (data === 'edit_welcome' || data === 'edit_mute' || data === 'edit_kick') {
    const key = data.replace('edit_', '');
    bot.sendMessage(msg.chat.id, `لطفا متن جدید برای پیام "${key}" را ارسال کنید:`);
    userState[userId] = { action: 'edit_setting', key };
  } else if (data === 'send_to_all') {
    bot.sendMessage(msg.chat.id, "لطفا پیام مورد نظر را ارسال کنید:");
    userState[userId] = { action: 'send_to_all' };
  }

  bot.answerCallbackQuery(callbackQuery.id);
});

bot.on('message', async (msg) => {
  const userId = msg.from.id;

  if (userState[userId] && userState[userId].action === 'edit_setting') {
    const key = userState[userId].key;
    const newValue = msg.text;

    await setSetting(key, newValue);
    await bot.sendMessage(msg.chat.id, `پیام ${key} با موفقیت به‌روزرسانی شد.`);
    delete userState[userId];
  } else if (userState[userId] && userState[userId].action === 'send_to_all') {
    const message = msg.text;

    db.all(`SELECT chat_id FROM users`, [], (err, rows) => {
      if (err) return bot.sendMessage(msg.chat.id, "خطا در ارسال پیام.");
      rows.forEach(row => {
        bot.sendMessage(row.chat_id, message);
      });
    });

    await bot.sendMessage(msg.chat.id, "پیام با موفقیت به همه کاربران ارسال شد.");
    delete userState[userId];
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
