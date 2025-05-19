const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const token = '1077501291:AAGleB88hdBlRKxG6-wGRbK2z6-kCXC_Bcs';
const adminPanelId = 381183017;  // آیدی عددی مدیر پنل
const url = 'https://my-telegram-bot-albl.onrender.com'; // آدرس ربات شما در Render
const port = process.env.PORT || 3000;

const bot = new TelegramBot(token);
bot.setWebHook(`${url}/bot${token}`);

const app = express();
app.use(express.json());

// Health check endpoint برای Render
app.get('/health', (req, res) => {
  res.sendStatus(200);
});

// دیتابیس SQLite
const db = new sqlite3.Database('./botdata.sqlite', (err) => {
  if (err) return console.error('DB error:', err.message);
  console.log('Connected to SQLite database');
});

// ساخت جداول اگر موجود نیستند
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

// توابع کمکی
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
    db.run(`INSERT INTO settings (key, value) VALUES (?, ?) 
            ON CONFLICT(key) DO UPDATE SET value=excluded.value`, [key, value], (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

function addOrUpdateUser(chatId, username) {
  db.run(`INSERT INTO users(chat_id, username) VALUES(?, ?) 
          ON CONFLICT(chat_id) DO UPDATE SET username=excluded.username`, [chatId, username]);
}

async function isAdmin(chatId, userId) {
  try {
    const admins = await bot.getChatAdministrators(chatId);
    return admins.some(a => a.user.id === userId);
  } catch {
    return false;
  }
}

// وبهوک برای دریافت آپدیت
app.post(`/bot${token}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// دستورها

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  addOrUpdateUser(chatId, msg.from.username || '');
  bot.sendMessage(chatId, "سلام! من ربات مدیریت گروه هستم. برای دیدن دستورات /help رو بزن.");
});

bot.onText(/\/help/, async (msg) => {
  const chatId = msg.chat.id;
  const helpText = `
دستورات ربات:

/start - شروع کار با ربات
/menu - منوی مدیریت گروه (فقط ادمین‌ها)
/panel - پنل مدیریت ربات (فقط مدیر مشخص شده)
/mute [ریپلای] - ساکت کردن فرد
/unmute [ریپلای] - باز کردن سکوت فرد
/kick [ریپلای] - اخراج فرد
/setwelcome [متن] - تنظیم پیام خوش‌آمدگویی (در پنل)
/showsettings - نمایش پیام‌های فعلی تنظیم شده (در پنل)

و...

برای اطلاعات بیشتر با پشتیبانی تماس بگیرید.
  `;
  await bot.sendMessage(chatId, helpText);
});

// پنل مدیریتی فقط برای آیدی مشخص شده
bot.onText(/\/panel/, async (msg) => {
  if (msg.from.id !== adminPanelId) {
    return bot.sendMessage(msg.chat.id, "شما اجازه دسترسی به پنل مدیریتی را ندارید.");
  }

  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [{ text: "آمار کاربران", callback_data: "stats" }],
        [{ text: "تنظیم پیام خوش‌آمد", callback_data: "edit_welcome" }],
        [{ text: "تنظیم پیام سکوت", callback_data: "edit_mute" }],
        [{ text: "تنظیم پیام اخراج", callback_data: "edit_kick" }],
        [{ text: "نمایش پیام‌های فعلی", callback_data: "show_settings" }]
      ]
    }
  };

  await bot.sendMessage(msg.chat.id, "پنل مدیریت ربات:", keyboard);
});

// هندل کال‌بک‌ها
bot.on('callback_query', async (callbackQuery) => {
  const msg = callbackQuery.message;
  const userId = callbackQuery.from.id;
  const data = callbackQuery.data;

  if (userId !== adminPanelId) {
    return bot.answerCallbackQuery(callbackQuery.id, { text: "دسترسی ندارید." });
  }

  if (data === 'stats') {
    db.get(`SELECT COUNT(*) as count FROM users`, [], (err, row) => {
      if (err) return bot.sendMessage(msg.chat.id, "خطا در دریافت آمار.");
      bot.sendMessage(msg.chat.id, `تعداد کل کاربران ثبت شده: ${row.count}`);
    });
  }
  else if (data.startsWith('edit_')) {
    const key = data.replace('edit_', '');
    bot.sendMessage(msg.chat.id, `لطفا متن جدید برای پیام "${key}" را ارسال کنید:`);
    userState[userId] = { action: 'edit_setting', key };
  }
  else if (data === 'show_settings') {
    db.all(`SELECT key, value FROM settings`, [], (err, rows) => {
      if (err) return bot.sendMessage(msg.chat.id, "خطا در دریافت تنظیمات.");
      let text = "پیام‌های فعلی:\n";
      rows.forEach(row => {
        text += `${row.key}: ${row.value}\n\n`;
      });
      bot.sendMessage(msg.chat.id, text);
    });
  }

  bot.answerCallbackQuery(callbackQuery.id);
});

// دریافت پیام برای ویرایش پیام‌ها در پنل
bot.on('message', async (msg) => {
  const userId = msg.from.id;

  // اگر در حالت ویرایش پیام هستیم
  if (userState[userId] && userState[userId].action === 'edit_setting') {
    const key = userState[userId].key;
    const newValue = msg.text;

    await setSetting(key, newValue);
    await bot.sendMessage(msg.chat.id, `پیام ${key} با موفقیت به‌روزرسانی شد.`);
    delete userState[userId];
    return;
  }
});

// مثال دستور mute (فقط ادمین‌ها)
bot.onText(/\/mute/, async (msg) => {
  if (msg.chat.type === 'private') return;
  const fromId = msg.from.id;
  const chatId = msg.chat.id;

  const isUserAdmin = await isAdmin(chatId, fromId);
  if (!isUserAdmin) return;

  if (!msg.reply_to_message) {
    return bot.sendMessage(chatId, "برای ساکت کردن، روی پیام فرد ریپلای کنید.");
  }

  const targetId = msg.reply_to_message.from.id;
  try {
    await bot.restrictChatMember(chatId, targetId, { can_send_messages: false });
    const muteMsg = await getSetting('mute');
    bot.sendMessage(chatId, muteMsg);
  } catch {
    bot.sendMessage(chatId, "خطا در ساکت کردن فرد.");
  }
});

// دستور unmute
bot.onText(/\/unmute/, async (msg) => {
  if (msg.chat.type === 'private') return;
  const fromId = msg.from.id;
  const chatId = msg.chat.id;

  const isUserAdmin = await isAdmin(chatId, fromId);
  if (!isUserAdmin) return;

  if (!msg.reply_to_message) {
    return bot.sendMessage(chatId, "برای باز کردن سکوت، روی پیام فرد ریپلای کنید.");
  }

  const targetId = msg.reply_to_message.from.id;
  try {
    await bot.restrictChatMember(chatId, targetId, { can_send_messages: true, can_send_media_messages: true, can_send_other_messages: true, can_add_web_page_previews: true });
    bot.sendMessage(chatId, "سکوت فرد برداشته شد.");
  } catch {
    bot.sendMessage(chatId, "خطا در باز کردن سکوت.");
  }
});

// دستور kick
bot.onText(/\/kick/, async (msg) => {
  if (msg.chat.type === 'private') return;
  const fromId = msg.from.id;
  const chatId = msg.chat.id;

  const isUserAdmin = await isAdmin(chatId, fromId);
  if (!isUserAdmin) return;

  if (!msg.reply_to_message) {
    return bot.sendMessage(chatId, "برای اخراج، روی پیام فرد ریپلای کنید.");
  }

  const targetId = msg.reply_to_message.from.id;
  try {
    await bot.kickChatMember(chatId, targetId);
    const kickMsg = await getSetting('kick');
    bot.sendMessage(chatId, kickMsg);
  } catch {
    bot.sendMessage(chatId, "خطا در اخراج فرد.");
  }
});

// سرور گوش میده
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
