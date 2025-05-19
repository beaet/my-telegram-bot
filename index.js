// فایل اصلی: index.js
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const token = '8129314550:AAFQTvL8VVg-4QtQD8QLY03LCWiSP1uaCak';
const url = 'https://my-telegram-bot-albl.onrender.com';
const port = process.env.PORT || 3000;

const bot = new TelegramBot(token);
bot.setWebHook(${url}/bot${token});

const app = express();
app.use(express.json());

app.post(/bot${token}, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// دیتابیس
const dbPath = path.resolve(__dirname, 'users.db');
const db = new sqlite3.Database(dbPath);

// ساخت جدول‌ها
db.serialize(() => {
  db.run(CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    chances INTEGER DEFAULT 3,
    permanent_chances INTEGER DEFAULT 0,
    invited INTEGER DEFAULT 0,
    banned_until INTEGER DEFAULT 0,
    banned_permanent INTEGER DEFAULT 0
  ));
  db.run(CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  ));
});

const ADMIN_ID = 381183017;

// تابع گرفتن یا ساخت کاربر
function getUser(id, callback) {
  db.get(SELECT * FROM users WHERE id = ?, [id], (err, row) => {
    if (err) return callback(null);
    if (!row) {
      db.run(INSERT INTO users(id) VALUES(?), [id], () => {
        db.get(SELECT * FROM users WHERE id = ?, [id], (err2, row2) => callback(row2));
      });
    } else {
      callback(row);
    }
  });
}

function updateUserChances(id, used = 1) {
  db.run(UPDATE users SET chances = chances - ? WHERE id = ?, [used, id]);
}

function resetDailyChances() {
  db.run(UPDATE users SET chances = 3);
}

function addPermanentChances(id, n) {
  db.run(UPDATE users SET permanent_chances = permanent_chances + ? WHERE id = ?, [n, id]);
}

function banUser(id, until = null) {
  if (until) {
    db.run(UPDATE users SET banned_until = ? WHERE id = ?, [until, id]);
  } else {
    db.run(UPDATE users SET banned_permanent = 1 WHERE id = ?, [id]);
  }
}

function unbanUser(id) {
  db.run(UPDATE users SET banned_permanent = 0, banned_until = 0 WHERE id = ?, [id]);
}

// ذخیره تنظیمات
function setSetting(key, value) {
  db.run(REPLACE INTO settings(key, value) VALUES (?, ?), [key, value]);
}
function getSetting(key, callback) {
  db.get(SELECT value FROM settings WHERE key = ?, [key], (err, row) => {
    callback(row ? row.value : null);
  });
}

// حافظه موقت وضعیت کاربر
const userStates = {};

// هندل استارت
bot.onText(/\/start(?: (\d+))?/, (msg, match) => {
  const id = msg.from.id;
  const chatId = msg.chat.id;
  const referralId = match[1];

  getUser(id, (user) => {
    if (!user) return;
    const now = Date.now();
    if (user.banned_permanent || user.banned_until > now) {
      return bot.sendMessage(chatId, 'متاسفانه شما از استفاده از ربات تا اطلاع ثانوی محروم هستید.');
    }

    if (referralId && parseInt(referralId) !== id) {
      db.get(SELECT * FROM users WHERE id = ?, [referralId], (err, refUser) => {
        if (refUser) {
          db.run(UPDATE users SET invited = invited + 1, permanent_chances = permanent_chances + 5 WHERE id = ?, [referralId]);
        }
      });
    }

    getSetting('welcome_message', (msgText) => {
      const welcome = msgText || 'سلام! لطفا یکی از گزینه‌های زیر را انتخاب کن:';
      bot.sendMessage(chatId, welcome, {
        reply_markup: {
          keyboard: [
            ['محاسبه ریت موبایل لجند'],
            ['چند دست بردم چند دست باختم؟'],
            ['اطلاعات من', 'دعوت از دوستان']
          ],
          resize_keyboard: true
        }
      });
    });
  });
});

bot.onText(/\/panel/, (msg) => {
  if (msg.from.id !== ADMIN_ID) return;
  bot.sendMessage(msg.chat.id, 'پنل مدیریت:', {
    reply_markup: {
      keyboard: [
        ['تنظیم پیام خوش‌آمدگویی'],
        ['ارسال پیام به کاربر خاص'],
        ['بن دائمی', 'بن زمان‌دار', 'آن‌بن کردن'],
        ['افزایش شانس کاربر']
      ],
      resize_keyboard: true
    }
  });
});

// ادامه دارد... (در پیام بعدی ادامه کد را می‌فرستم)

const totalMatches = parseInt(text);
    if (isNaN(totalMatches)) return bot.sendMessage(chatId, "لطفا فقط عدد وارد کن. چند مچ بازی کردی؟");
    state.totalMatches = totalMatches;
    bot.sendMessage(chatId, "حالا درصد ریتت رو بگو (مثلاً 60):");
    return;
  }

  if (!state.currentRate) {
    const currentRate = parseFloat(text);
    if (isNaN(currentRate)) return bot.sendMessage(chatId, "درصد ریت رو درست وارد کن.");
    state.currentRate = currentRate;

    const wins = Math.round(state.totalMatches * currentRate / 100);
    const losses = state.totalMatches - wins;

    bot.sendMessage(chatId, تعداد بردها: ${wins}\nتعداد باخت‌ها: ${losses});
    delete userState[chatId];
    userUsage[chatId].usedToday += 1;
    return;
  }

  // وضعیت محاسبه ریت اولیه
  if (!state.step) {
    const totalMatches = parseInt(text);
    if (isNaN(totalMatches)) return bot.sendMessage(chatId, "لطفا فقط عدد وارد کن. چند مچ بازی کردی؟");
    state.step = 'currentRate';
    state.totalMatches = totalMatches;
    return bot.sendMessage(chatId, "عالی! حالا بگو درصد ریت فعلیت چند درصده؟");
  } else if (state.step === 'currentRate') {
    const currentRate = parseFloat(text);
    if (isNaN(currentRate)) return bot.sendMessage(chatId, "درصد فعلیت رو درست وارد کن.");
    state.currentRate = currentRate;
    state.step = 'targetRate';
    return bot.sendMessage(chatId, "میخوای ریتت به چند درصد برسه؟");
  } else if (state.step === 'targetRate') {
    const targetRate = parseFloat(text);
    if (isNaN(targetRate)) return bot.sendMessage(chatId, "درصد هدف رو درست وارد کن.");
    const { totalMatches, currentRate } = state;
    const currentWins = totalMatches * currentRate / 100;
    const requiredWins = ((targetRate / 100) * totalMatches - currentWins) / (1 - targetRate / 100);
    const x = Math.ceil(requiredWins);

    if (x <= 0) {
      bot.sendMessage(chatId, "ریت فعلیت از هدف بالاتره یا خیلی نزدیکه. نیازی به برد بیشتر نیست!");
    } else {
      bot.sendMessage(chatId, برای رسیدن به ${targetRate}% ریت، باید ${x} بازی پشت سر هم ببری!);
    }
    delete userState[chatId];
    userUsage[chatId].usedToday += 1;
  }
});

// سرور
app.listen(port, () => {
  console.log(Server is running on port ${port});
});
