const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const app = express();

const token = '8129314550:AAFQTvL8VVg-4QtQD8QLY03LCWiSP1uaCak';  // توکن ربات
const adminId = 381183017;  // آیدی ادمین
const webhookUrl = 'https://my-telegram-bot-albl.onrender.com';  // آدرس وبهوک شما
const port = process.env.PORT || 10000;

// تنظیم وبهوک و ربات
const bot = new TelegramBot(token, { polling: false });
bot.setWebHook(`${webhookUrl}/bot${token}`);

app.use(express.json());

// دریافت آپدیت‌ها از تلگرام
app.post(`/bot${token}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// دیتابیس SQLite
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

  // مقدار پیشفرض help_text
  db.get(`SELECT value FROM settings WHERE key = 'help_text'`, (err, row) => {
    if (!row) {
      db.run(`INSERT INTO settings (key, value) VALUES (?, ?)`, ['help_text', 'متن پیش‌فرض راهنما']);
    }
  });

  // مقدار پیشفرض bot_active = 1 (فعال)
  db.get(`SELECT value FROM settings WHERE key = 'bot_active'`, (err, row) => {
    if (!row) {
      db.run(`INSERT INTO settings (key, value) VALUES (?, ?)`, ['bot_active', '1']);
    }
  });
});

// وضعیت موقت کاربر
const userState = {};

// کمک برای وجود داشتن کاربر در دیتابیس
function ensureUser(user) {
  db.run(`INSERT OR IGNORE INTO users (user_id, username) VALUES (?, ?)`, [user.id, user.username || '']);
}

// گرفتن اطلاعات کاربر
function getUser(userId) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT * FROM users WHERE user_id = ?`, [userId], (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

// گرفتن وضعیت فعال بودن ربات
function getBotActive() {
  return new Promise((resolve, reject) => {
    db.get(`SELECT value FROM settings WHERE key = 'bot_active'`, (err, row) => {
      if (err) reject(err);
      else resolve(row ? row.value === '1' : true);
    });
  });
}

// آپدیت وضعیت فعال بودن ربات
function setBotActive(status) {
  db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('bot_active', ?)`, [status ? '1' : '0']);
}

// آپدیت امتیاز کاربر
function updatePoints(userId, amount) {
  db.run(`UPDATE users SET points = points + ? WHERE user_id = ?`, [amount, userId]);
}

// تغییر وضعیت بن کاربر
function setBanStatus(userId, status) {
  db.run(`UPDATE users SET banned = ? WHERE user_id = ?`, [status ? 1 : 0, userId]);
}

// گرفتن متن راهنما
function getHelpText() {
  return new Promise((resolve, reject) => {
    db.get(`SELECT value FROM settings WHERE key = 'help_text'`, (err, row) => {
      if (err) reject(err);
      else resolve(row ? row.value : 'متن راهنما موجود نیست.');
    });
  });
}

// ذخیره متن جدید راهنما
function setHelpText(newText) {
  db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('help_text', ?)`, [newText]);
}

// پاک کردن وضعیت موقت کاربر
function resetUserState(userId) {
  delete userState[userId];
}

// ارسال منوی اصلی
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

  bot.sendMessage(userId, 'به ربات خوش آمدید. یکی از گزینه‌ها را انتخاب کنید.', keyboard);
}

// هندل دستور /start
bot.onText(/\/start(?: (\d+))?/, async (msg, match) => {
  const userId = msg.from.id;
  const refId = match[1] ? parseInt(match[1]) : null;

  // بررسی وضعیت فعال بودن ربات
  const active = await getBotActive();
  if (!active && userId !== adminId) {
    return bot.sendMessage(userId, 'ربات فعلا غیر فعال است. لطفا بعدا مراجعه کنید.');
  }

  ensureUser(msg.from);
  const user = await getUser(userId);

  if (user?.banned) {
    return bot.sendMessage(userId, 'شما بن شده‌اید و اجازه استفاده از ربات را ندارید.');
  }

  resetUserState(userId);

  // مدیریت دعوت
  if (refId && refId !== userId) {
    db.get(`SELECT invites FROM users WHERE user_id = ?`, [userId], (err, row) => {
      if (row && row.invites === 0) {
        updatePoints(refId, 5);
        db.run(`UPDATE users SET invites = invites + 1 WHERE user_id = ?`, [refId]);
        db.run(`UPDATE users SET invites = 1 WHERE user_id = ?`, [userId]);
      }
    });
  }

  sendMainMenu(userId);
});

// هندل دستور /panel فقط برای ادمین
bot.onText(/\/panel/, async (msg) => {
  const userId = msg.from.id;
  if (userId !== adminId) {
    return bot.sendMessage(userId, 'شما دسترسی به پنل مدیریت ندارید.');
  }

  const botActive = await getBotActive();

  bot.sendMessage(userId, 'پنل مدیریت:', {
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
          { text: botActive ? 'خاموش کردن ربات' : 'روشن کردن ربات', callback_data: 'toggle_bot' }
        ],
        [
          { text: 'تغییر متن راهنما', callback_data: 'edit_help' }
        ]
      ]
    }
  });
});

// هندل دکمه‌های پنل و منو
bot.on('callback_query', async (query) => {
  const userId = query.from.id;
  const data = query.data;
  const user = await getUser(userId);

  if (!user) return bot.answerCallbackQuery(query.id);

  // وقتی ربات خاموش است، فقط ادمین اجازه کار دارد
  const botActive = await getBotActive();
  if (!botActive && userId !== adminId) {
    return bot.answerCallbackQuery(query.id, { text: 'ربات فعلا غیر فعال است.', show_alert: true });
  }

  if (user.banned) {
    return bot.answerCallbackQuery(query.id, { text: 'شما بن شده‌اید.', show_alert: true });
  }

  switch (data) {
    case 'toggle_bot':
      if (userId !== adminId) return bot.answerCallbackQuery(query.id, { text: 'شما دسترسی ندارید.', show_alert: true });
      const newStatus = !botActive;
      setBotActive(newStatus);
      await bot.answerCallbackQuery(query.id, { text: `ربات اکنون ${newStatus ? 'فعال' : 'غیرفعال'} شد.` });
      // دوباره نمایش پنل
      bot.emit('text', { from: { id: adminId }, text: '/panel' });
      break;



  // مرحله پشتیبانی: فوروارد پیام به ادمین
  if (state.step === 'support') {
    if (msg.text || msg.photo || msg.video || msg.sticker) {
      // فوروارد پیام به ادمین
      bot.forwardMessage(adminId, userId, msg.message_id);
      return bot.sendMessage(userId, 'پیام شما ارسال شد. برای خروج /start را بزنید.');
    }
  }
});
  
// شروع سرور
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
