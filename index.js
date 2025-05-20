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

// دریافت آپدیت‌ها از تلگرام از طریق وبهوک
app.post(`/bot${token}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// راه‌اندازی دیتابیس SQLite
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

  db.get(`SELECT value FROM settings WHERE key = 'help_text'`, (err, row) => {
    if (!row) {
      db.run(`INSERT INTO settings (key, value) VALUES (?, ?)`, ['help_text', 'متن پیش‌فرض راهنما']);
    }
  });
});

// وضعیت موقت کاربر برای مراحل مختلف
const userState = {};

// کمک برای ایجاد یا اطمینان از وجود کاربر در دیتابیس
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

// آپدیت امتیاز کاربر (مثبت یا منفی)
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

// ارسال منوی اصلی با دکمه‌ها
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

// هندل دستور /start با امکان لینک دعوت
bot.onText(/\/start(?: (\d+))?/, async (msg, match) => {
  const userId = msg.from.id;
  const refId = match[1] ? parseInt(match[1]) : null;

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
          { text: 'تغییر متن راهنما', callback_data: 'edit_help' }
        ]
      ]
    }
  });
});

// هندل کلیک روی دکمه‌های منو و پنل مدیریت
bot.on('callback_query', async (query) => {
  const userId = query.from.id;
  const data = query.data;
  const user = await getUser(userId);
  if (!user) return bot.answerCallbackQuery(query.id);

  if (user.banned) {
    return bot.answerCallbackQuery(query.id, { text: 'شما بن شده‌اید.', show_alert: true });
  }

  switch (data) {
    case 'calculate_rate':
    case 'calculate_wl':
      if (user.points <= 0) {
        return bot.answerCallbackQuery(query.id, { text: 'شما امتیازی برای استفاده ندارید.', show_alert: true });
      }
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
      return bot.sendMessage(userId, 'متن جدید راهنما را ارسال کنید یا /cancel برای لغو:');
  }
});

// هندل پیام‌های ورودی برای مراحل مختلف
bot.on('message', async (msg) => {
  const userId = msg.from.id;
  const text = msg.text;

  if (!userState[userId]) return; // اگر در مرحله‌ای نبود، کاری نکن

  // اگر کاربر بن شده باشد
  const user = await getUser(userId);
  if (user?.banned) {
    return bot.sendMessage(userId, 'شما بن شده‌اید و اجازه استفاده ندارید.');
  }

  const state = userState[userId];

  // لغو عملیات با دستور /cancel
  if (text === '/cancel') {
    resetUserState(userId);
    return bot.sendMessage(userId, 'عملیات لغو شد.', {
      reply_markup: { remove_keyboard: true }
    });
  }

  // مراحل پنل مدیریت (ادمین)
  if (userId === adminId) {
    switch (state.step) {
      case 'enter_id':
        if (!/^\d+$/.test(text)) return bot.sendMessage(userId, 'لطفا یک آیدی عددی معتبر وارد کنید.');
        state.targetId = parseInt(text);
        if (state.type === 'add') {
          state.step = 'enter_points';
          return bot.sendMessage(userId, 'تعداد امتیاز برای اضافه کردن را وارد کنید:');
        } else if (state.type === 'sub') {
          state.step = 'enter_points';
          return bot.sendMessage(userId, 'تعداد امتیاز برای کسر را وارد کنید:');
        }
        break;

      case 'enter_points':
        if (!/^\d+$/.test(text)) return bot.sendMessage(userId, 'لطفا یک عدد معتبر وارد کنید.');
        const pts = parseInt(text);
        if (state.type === 'add') {
          updatePoints(state.targetId, pts);
          bot.sendMessage(userId, `به کاربر ${state.targetId} مقدار ${pts} امتیاز اضافه شد.`);
        } else if (state.type === 'sub') {
          updatePoints(state.targetId, -pts);
          bot.sendMessage(userId, `از کاربر ${state.targetId} مقدار ${pts} امتیاز کسر شد.`);
        }
        resetUserState(userId);
        break;

      case 'broadcast':
        const textToSend = text;
        resetUserState(userId);
        bot.sendMessage(userId, 'پیام در حال ارسال به همه کاربران...');
        db.all(`SELECT user_id FROM users WHERE banned=0`, (err, rows) => {
          if (rows && rows.length > 0) {
            rows.forEach(row => {
              bot.sendMessage(row.user_id, `پیام همگانی:\n\n${textToSend}`).catch(() => { });
            });
          }
        });
        break;

      case 'ban_enter_id':
        if (!/^\d+$/.test(text)) return bot.sendMessage(userId, 'لطفا یک آیدی عددی معتبر وارد کنید.');
        const banId = parseInt(text);
        setBanStatus(banId, true);
        resetUserState(userId);
        return bot.sendMessage(userId, `کاربر ${banId} بن شد.`);

      case 'unban_enter_id':
        if (!/^\d+$/.test(text)) return bot.sendMessage(userId, 'لطفا یک آیدی عددی معتبر وارد کنید.');
        const unbanId = parseInt(text);
        setBanStatus(unbanId, false);
        resetUserState(userId);
        return bot.sendMessage(userId, `کاربر ${unbanId} آن‌بن شد.`);

      case 'edit_help':
        setHelpText(text);
        resetUserState(userId);
        return bot.sendMessage(userId, 'متن راهنما با موفقیت بروزرسانی شد.');
    }
  }

  // مراحل محاسبه ریت یا برد/باخت برای کاربران عادی
  if (state.type === 'rate' || state.type === 'w/l') {
    switch (state.step) {
      case 'total':
        if (!/^\d+$/.test(text)) return bot.sendMessage(userId, 'لطفا عدد صحیح وارد کنید.');
        state.total = parseInt(text);
        state.step = 'win';
        return bot.sendMessage(userId, 'تعداد بردها را وارد کنید:');

      case 'win':
        if (!/^\d+$/.test(text)) return bot.sendMessage(userId, 'لطفا عدد صحیح وارد کنید.');
        state.win = parseInt(text);
        if (state.win > state.total) return bot.sendMessage(userId, 'تعداد برد نمی‌تواند بیشتر از کل بازی‌ها باشد.');
        
        // انجام محاسبه
        let result = '';
        if (state.type === 'rate') {
          const rate = ((state.win / state.total) * 100).toFixed(2);
          result = `نرخ برد شما: ${rate}%`;
        } else if (state.type === 'w/l') {
          const lose = state.total - state.win;
          result = `برد: ${state.win}\nباخت: ${lose}`;
        }
        updatePoints(userId, -1); // کم کردن 1 امتیاز
        resetUserState(userId);
        bot.sendMessage(userId, result + `\nامتیاز باقی‌مانده: ${user.points - 1}`);
        sendMainMenu(userId);
        break;
    }
  }

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
