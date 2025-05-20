const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const app = express();

const token = '8129314550:AAFQTvL8VVg-4QtQD8QLY03LCWiSP1uaCak';
const adminId = 381183017;
const webhookUrl = 'https://my-telegram-bot-albl.onrender.com';
const port = process.env.PORT || 10000;

// وبهوک => polling باید false باشه
const bot = new TelegramBot(token, { polling: false });
bot.setWebHook(`${webhookUrl}/bot${token}`);

app.use(express.json());

app.post(`/bot${token}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

const db = new sqlite3.Database('./botdata.sqlite');
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    user_id INTEGER PRIMARY KEY,
    username TEXT,
    points INTEGER DEFAULT 5,
    invites INTEGER DEFAULT 0,
    banned INTEGER DEFAULT 0
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )`);

  // ذخیره متن راهنما اگر موجود نباشد
  db.get(`SELECT value FROM settings WHERE key = 'help_text'`, (err, row) => {
    if (!row) {
      db.run(`INSERT INTO settings (key, value) VALUES (?, ?)`, ['help_text', 'متن پیش‌فرض راهنما']);
    }
  });
});

const userState = {};

// ذخیره کاربر در دیتابیس
function ensureUser(user) {
  db.run(`INSERT OR IGNORE INTO users (user_id, username) VALUES (?, ?)`, [user.id, user.username || '']);
}

// گرفتن اطلاعات کاربر از دیتابیس
function getUser(userId) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT * FROM users WHERE user_id = ?`, [userId], (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

// بروزرسانی امتیاز کاربر
function updatePoints(userId, amount) {
  db.run(`UPDATE users SET points = points + ? WHERE user_id = ?`, [amount, userId]);
}

// تغییر وضعیت بن کاربر
function setBanStatus(userId, status) {
  db.run(`UPDATE users SET banned = ? WHERE user_id = ?`, [status ? 1 : 0, userId]);
}

// گرفتن متن راهنما از دیتابیس
function getHelpText() {
  return new Promise((resolve, reject) => {
    db.get(`SELECT value FROM settings WHERE key = 'help_text'`, (err, row) => {
      if (err) reject(err);
      else resolve(row ? row.value : 'متن راهنما موجود نیست.');
    });
  });
}

// ذخیره متن راهنما در دیتابیس
function setHelpText(newText) {
  db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('help_text', ?)`, [newText]);
}

// پاک کردن وضعیت کاربر (لغو مراحل)
function resetUserState(userId) {
  delete userState[userId];
}

// تابع ارسال منوی اصلی
function sendMainMenu(userId) {
  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: 'محاسبه ریت', callback_data: 'calculate_rate' },
          { text: 'محاسبه برد/باخت', callback_data: 'calculate_wl' }
        ],
        [
          { text: 'دریافت لینک دعوت', callback_data: 'referral' },
          { text: 'حساب کاربری', callback_data: 'profile' }
        ],
        [
          { text: 'پشتیبانی', callback_data: 'support' }
        ],
        [
          { text: 'راهنما', callback_data: 'help' }
        ],
        [
          { text: 'خرید امتیاز', callback_data: 'buy' }
        ]
      ]
    }
  };

  // اگر ادمین است دکمه پنل را اضافه کن
  if (userId === adminId) {
    keyboard.reply_markup.inline_keyboard.push([
      { text: 'پنل مدیریت', callback_data: 'admin_panel' }
    ]);
  }

  bot.sendMessage(userId, 'به ربات خوش آمدید. یکی از گزینه‌ها را انتخاب کنید.', keyboard);
}

// وقتی استارت زده شد: وضعیت لغو، منوی اصلی بفرست
bot.onText(/\/start(?: (\d+))?/, async (msg, match) => {
  const userId = msg.from.id;
  const refId = match[1];
  ensureUser(msg.from);

  // اگر بن است پیام بده و برگرد
  const user = await getUser(userId);
  if (user?.banned) {
    return bot.sendMessage(userId, 'شما بن شده‌اید و اجازه استفاده از ربات را ندارید.');
  }

  // لغو مراحل قبلی
  resetUserState(userId);

  // مدیریت دعوت
  if (refId && parseInt(refId) !== userId) {
    if (user.invites === 0) {
      updatePoints(refId, 5);
      db.run(`UPDATE users SET invites = invites + 1 WHERE user_id = ?`, [refId]);
      db.run(`UPDATE users SET invites = 1 WHERE user_id = ?`, [userId]); // جلوگیری از امتیاز تکراری
    }
  }

  sendMainMenu(userId);
});

// مدیریت دکمه‌ها
bot.on('callback_query', async (query) => {
  const userId = query.from.id;
  const data = query.data;
  const user = await getUser(userId);
  if (!user) return bot.answerCallbackQuery(query.id);

  if (user.banned) {
    await bot.answerCallbackQuery(query.id, { text: 'شما بن شده‌اید.', show_alert: true });
    return;
  }

  switch (data) {
    case 'calculate_rate':
    case 'calculate_wl':
      if (user.points <= 0) {
        await bot.answerCallbackQuery(query.id, { text: 'شما امتیازی برای استفاده ندارید.', show_alert: true });
        return;
      }
      updatePoints(userId, -1);
      userState[userId] = {
        type: data === 'calculate_rate' ? 'rate' : 'w/l',
        step: 'total'
      };
      await bot.answerCallbackQuery(query.id);
      return bot.sendMessage(userId, 'تعداد کل بازی‌ها را وارد کن:');

    case 'referral':
      await bot.answerCallbackQuery(query.id);
      return bot.sendMessage(userId, `لینک دعوت اختصاصی شما:\nhttps://t.me/mlbbratebot?start=${userId}`);

    case 'profile':
      await bot.answerCallbackQuery(query.id);
      return bot.sendMessage(userId, `آیدی عددی: ${userId}\nامتیاز باقی‌مانده: ${user.points}\nتعداد دعوتی‌ها: ${user.invites}`);

    case 'buy':
      await bot.answerCallbackQuery(query.id);
      return bot.sendMessage(userId, 'برای خرید امتیاز به پیوی @Beast3694 مراجعه کنید.');

    case 'support':
      userState[userId] = { step: 'support' };
      await bot.answerCallbackQuery(query.id);
      return bot.sendMessage(userId, 'شما در بخش پشتیبانی هستید. هر پیام شما به من فوروارد خواهد شد. برای خروج /start بزنید.');

    case 'help':
      await bot.answerCallbackQuery(query.id);
      const helpText = await getHelpText();
      return bot.sendMessage(userId, helpText);

    case 'admin_panel':
      if (userId !== adminId) {
        await bot.answerCallbackQuery(query.id, { text: 'شما ادمین نیستید.', show_alert: true });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      return bot.sendMessage(userId, 'انتخاب کن:', {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '➕ افزودن امتیاز', callback_data: 'add_points' },
              { text: '➖ کسر امتیاز', callback_data: 'sub_points' }
            ],
            [
              { text: '📢 پیام همگانی', callback_data: 'broadcast' }
            ],
            [
              { text: 'بن کردن کاربر', callback_data: 'ban_user' },
              { text: 'آن‌بن کردن کاربر', callback_data: 'unban_user' }
            ],
            [
              { text: 'تغییر متن راهنما', callback_data: 'edit_help' }
            ]
          ]
        }
      });

    case 'add_points':
    case 'sub_points':
      userState[userId] = { step: 'enter_id', type: data === 'add_points' ? 'add' : 'sub' };
      await bot.answerCallbackQuery(query.id);
      return bot.sendMessage(userId, 'آیدی عددی کاربر را وارد کنید:');

    case 'broadcast':
      userState[userId] = { step: 'broadcast' };
      await bot.answerCallbackQuery(query.id);
      return bot.sendMessage(userId, 'متن پیام همگانی را ارسال کنید یا /cancel برای لغو:');

    case 'ban_user':
      userState[userId] = { step: 'ban_enter_id' };
      await bot.answerCallbackQuery(query.id);
      return bot.sendMessage(userId, 'آیدی عددی کاربر برای بن کردن را وارد کنید:');

    case 'unban_user':
      userState[userId] = { step: 'unban_enter_id' };
      await bot.answerCallbackQuery(query.id);
      return bot.sendMessage(userId, 'آیدی عددی کاربر برای آن‌بن کردن را وارد کنید:');

    case 'edit_help':
      userState[userId] = { step: 'edit_help' };
      await bot.answerCallbackQuery(query.id);
      return bot.sendMessage(userId, 'متن جدید راهنما را ارسال کنید:');

    default:
      await bot.answerCallbackQuery(query.id);
  }
});

// مدیریت پیام‌ها
bot.on('message', async (msg) => {
  const userId = msg.from.id;
  const text = msg.text;

  // اگر پیام از کانال یا گروه یا ... است و متن نیست، رد کن
  if (!text) return;

  ensureUser(msg.from);
  const user = await getUser(userId);
  if (!user) return;

  if (user.banned) {
    if (text === '/start') {
      return bot.sendMessage(userId, 'شما بن شده‌اید و نمی‌توانید از ربات استفاده کنید.');
    } else {
      return; // پیام‌های بن شده‌ها را نادیده بگیر
    }
  }

  // اگر استارت زده شد همه مراحل لغو شود
  if (text === '/start') {
    resetUserState(userId);
    return sendMainMenu(userId);
  }

  // اگر کاربر در وضعیت خاصی است (مراحل محاسبه، پنل مدیریت، پشتیبانی و ...)
  const state = userState[userId];
  if (!state) return; // هیچ مرحله‌ای نیست، پیام‌ها را نادیده بگیر

  // مدیریت مراحل مختلف
  if (state.step === 'total') {
    const total = parseInt(text);
    if (isNaN(total)) return bot.sendMessage(userId, 'تعداد کل بازی‌ها را به صورت عدد وارد کن.');
    state.total = total;
    state.step = 'rate';
    return bot.sendMessage(userId, 'ریت فعلی را وارد کن (مثلاً 55):');
  }

  if (state.step === 'rate') {
    const rate = parseFloat(text);
    if (isNaN(rate)) return bot.sendMessage(userId, 'درصد ریت را به صورت عدد وارد کن.');
    if (state.type === 'rate') {
      state.rate = rate;
      state.step = 'target';
      return bot.sendMessage(userId, 'ریت هدف را وارد کن:');
    } else {
      const wins = Math.round((state.total * rate) / 100);
      const losses = state.total - wins;
      bot.sendMessage(userId, `برد: ${wins} | باخت: ${losses}`);
      delete userState[userId];
    }

    if (state.step === 'target') {
      const target = parseFloat(text);
      if (isNaN(target)) return bot.sendMessage(userId, 'ریت هدف را به صورت عدد وارد کن.');
      const currentWins = (state.total * state.rate) / 100;
      const x = Math.ceil(((target / 100 * state.total) - currentWins) / (1 - target / 100));
      bot.sendMessage(userId, `برای رسیدن به ${target}% باید ${x} بازی متوالی ببری.`);
      delete userState[userId];
    }

    if (state.step === 'enter_id') {
      const targetId = parseInt(text);
      if (isNaN(targetId)) return bot.sendMessage(userId, 'آیدی عددی نامعتبر است.');
      state.targetId = targetId;
      state.step = 'enter_amount';
      return bot.sendMessage(userId, 'مقدار امتیاز را وارد کنید:');
    }

    if (state.step === 'enter_amount') {
      const amount = parseInt(text);
      if (isNaN(amount)) return bot.sendMessage(userId, 'عدد وارد کن.');
      updatePoints(state.targetId, state.type === 'add' ? amount : -amount);
      bot.sendMessage(userId, 'انجام شد.');
      delete userState[userId];
    }

    if (state.step === 'broadcast') {
      db.all(`SELECT user_id FROM users`, [], (err, rows) => {
        if (!err) {
          rows.forEach(row => {
            bot.sendMessage(row.user_id, text).catch(() => {});
          });
        }
      });
      bot.sendMessage(userId, 'پیام همگانی ارسال شد.');
      delete userState[userId];
    }

    return;
  }

  if (userId === adminId && text === '/panel') {
    return bot.sendMessage(userId, 'ورود به پنل ادمین:', {
      reply_markup: {
        inline_keyboard: [[{ text: 'ورود به پنل', callback_data: 'admin_panel' }]]
      }
    });
  }
});
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
