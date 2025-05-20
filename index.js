const { Telegraf } = require('telegraf');
const sqlite3 = require('sqlite3').verbose();

const bot = new Telegraf('8129314550:AAFQTvL8VVg-4QtQD8QLY03LCWiSP1uaCak');
const ADMIN_ID = 381183017;

// ساخت دیتابیس و جداول
const db = new sqlite3.Database('./database.sqlite');

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    chat_id INTEGER PRIMARY KEY,
    uses_left INTEGER DEFAULT 5,
    banned_until INTEGER DEFAULT 0,
    extra_uses INTEGER DEFAULT 0
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS invites (
    inviter INTEGER,
    invitee INTEGER PRIMARY KEY
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY,
    start_message TEXT DEFAULT 'سلام! به ربات ما خوش آمدید.'
  )`);
  
  // یک ردیف تنظیمات اگر نیست، ایجاد کن
  db.get(`SELECT * FROM settings WHERE id = 1`, (err, row) => {
    if (!row) {
      db.run(`INSERT INTO settings (id, start_message) VALUES (1, 'سلام! به ربات ما خوش آمدید.')`);
    }
  });
});

// تابع ارسال منوی اصلی (کیبورد معمولی)
function sendMainMenu(chatId) {
  const keyboard = {
    reply_markup: {
      keyboard: [
        ['محاسبه ریت موبایل لجند'],
        ['چند دست بردم چند دست باختم؟'],
        ['اطلاعات من'],
        ['دعوت دوستان'],
        ['خرید شانس']
      ],
      resize_keyboard: true,
      one_time_keyboard: false
    }
  };
  db.get(`SELECT start_message FROM settings WHERE id = 1`, (err, row) => {
    const startMsg = row && row.start_message ? row.start_message : 'سلام! به ربات ما خوش آمدید.';
    bot.telegram.sendMessage(chatId, startMsg, keyboard);
  });
}

// هنگام استارت و ثبت دعوت
bot.start((ctx) => {
  const chatId = ctx.chat.id;
  const startPayload = ctx.startPayload;

  // ثبت کاربر اگر قبلاً ثبت نشده
  db.get(`SELECT * FROM users WHERE chat_id = ?`, [chatId], (err, user) => {
    if (err) return console.error(err);
    if (!user) {
      db.run(`INSERT INTO users (chat_id, uses_left, banned_until, extra_uses) VALUES (?, 5, 0, 0)`, [chatId]);
    }
  });

  // اگر پارامتر دعوت دارد
  if (startPayload) {
    const inviterId = parseInt(startPayload);
    if (!isNaN(inviterId) && inviterId !== chatId) {
      // ثبت دعوت فقط اگر قبلاً دعوت نشده
      db.get(`SELECT * FROM invites WHERE invitee = ?`, [chatId], (err, inviteRow) => {
        if (!inviteRow) {
          db.run(`INSERT INTO invites (inviter, invitee) VALUES (?, ?)`, [inviterId, chatId], (err2) => {
            if (!err2) {
              // ۵ شانس اضافه به دعوت کننده بده
              db.get(`SELECT extra_uses FROM users WHERE chat_id = ?`, [inviterId], (err3, inviterRow) => {
                if (inviterRow) {
                  const newExtra = inviterRow.extra_uses + 5;
                  db.run(`UPDATE users SET extra_uses = ? WHERE chat_id = ?`, [newExtra, inviterId]);
                }
              });
            }
          });
        }
      });
    }
  }

  sendMainMenu(chatId);
});

// میدلور چک بن بودن
bot.use(async (ctx, next) => {
  const chatId = ctx.chat.id;
  db.get(`SELECT banned_until FROM users WHERE chat_id = ?`, [chatId], (err, row) => {
    if (row && row.banned_until > Date.now()) {
      ctx.reply('متأسفانه شما تا اطلاع ثانوی از استفاده از ربات محدود شده‌اید.');
    } else {
      next();
    }
  });
});

// شنیدن پیام‌ها و دکمه‌ها
bot.on('text', (ctx) => {
  const chatId = ctx.chat.id;
  const text = ctx.message.text;

  if (text === 'محاسبه ریت موبایل لجند') {
    db.get(`SELECT uses_left, extra_uses FROM users WHERE chat_id = ?`, [chatId], (err, user) => {
      if (!user) {
        ctx.reply('خطا در دریافت اطلاعات کاربری.');
        return;
      }
      const totalUses = user.uses_left + user.extra_uses;
      if (totalUses <= 0) {
        ctx.reply('شما شانس استفاده از این بخش را ندارید. برای افزایش شانس‌ها از بخش دعوت دوستان یا خرید شانس استفاده کنید.');
        return;
      }

      ctx.reply('لطفا ریت خود را به درصد وارد کنید:');
      ctx.session = { action: 'get_rate' };
    });
  }
  else if (text === 'چند دست بردم چند دست باختم؟') {
    ctx.reply('لطفا تعداد کل مچ‌هایی که بازی کرده‌اید را وارد کنید:');
    ctx.session = { action: 'get_matches' };
  }
  else if (text === 'اطلاعات من') {
    db.get(`SELECT COUNT(*) as cnt FROM invites WHERE inviter = ?`, [chatId], (err, row) => {
      const invitesCount = row ? row.cnt : 0;
      db.get(`SELECT uses_left, extra_uses FROM users WHERE chat_id = ?`, [chatId], (err2, userRow) => {
        if (!userRow) {
          ctx.reply('خطا در دریافت اطلاعات کاربری.');
          return;
        }
        const totalUses = userRow.uses_left + userRow.extra_uses;
        ctx.reply(`آیدی عددی شما: ${chatId}\nتعداد دعوتی‌ها: ${invitesCount}\nشانس‌های باقی‌مانده: ${totalUses}`);
      });
    });
  }
  else if (text === 'دعوت دوستان') {
    const link = `https://t.me/MlbbRateBot?start=${chatId}`;
    ctx.reply(`لینک دعوت شما:\n${link}\nبا این لینک دوستانتان را دعوت کنید و ۵ شانس دائمی اضافه بگیرید.`);
  }
  else if (text === 'خرید شانس') {
    ctx.reply('برای خرید شانس به این آیدی پیام دهید:\n@Beast3694');
  }
  else {
    // مدیریت ورودی‌های مرحله‌ای
    if (ctx.session && ctx.session.action === 'get_rate') {
      let rate = parseFloat(text.replace(',', '.'));
      if (isNaN(rate) || rate < 0 || rate > 100) {
        ctx.reply('لطفا یک عدد معتبر بین 0 تا 100 وارد کنید.');
        return;
      }

      // کم کردن یک شانس کاربر
      db.get(`SELECT uses_left, extra_uses FROM users WHERE chat_id = ?`, [chatId], (err, user) => {
        if (!user) return;
        let usesLeft = user.uses_left;
        let extra = user.extra_uses;

        if (extra > 0) {
          extra -= 1;
          db.run(`UPDATE users SET extra_uses = ? WHERE chat_id = ?`, [extra, chatId]);
        } else if (usesLeft > 0) {
          usesLeft -= 1;
          db.run(`UPDATE users SET uses_left = ? WHERE chat_id = ?`, [usesLeft, chatId]);
        }

        ctx.reply(`شما ریت ${rate}% را وارد کردید.`);
        sendMainMenu(chatId);
        ctx.session = null;
      });
    }
    else if (ctx.session && ctx.session.action === 'get_matches') {
      let matches = parseInt(text);
      if (isNaN(matches) || matches <= 0) {
        ctx.reply('لطفا تعداد مچ‌ها را به عدد صحیح وارد کنید.');
        return;
      }
      ctx.session.matches = matches;
      ctx.reply('لطفا ریت خود را به درصد وارد کنید:');
      ctx.session.action = 'get_rate_for_matches';
    }
    else if (ctx.session && ctx.session.action === 'get_rate_for_matches') {
      let rate = parseFloat(text.replace(',', '.'));
      if (isNaN(rate) || rate < 0 || rate > 100) {
        ctx.reply('لطفا یک عدد معتبر بین 0 تا 100 وارد کنید.');
        return;
      }

      const matches = ctx.session.matches;

      // محاسبه برد و باخت
      const wins = Math.round(matches * (rate / 100));
      const losses = matches - wins;

      // کم کردن یک شانس کاربر
      db.get(`SELECT uses_left, extra_uses FROM users WHERE chat_id = ?`, [chatId], (err, user) => {
        if (!user) return;
        let usesLeft = user.uses_left;
        let extra = user.extra_uses;

        if (extra > 0) {
          extra -= 1;
          db.run(`UPDATE users SET extra_uses = ? WHERE chat_id = ?`, [extra, chatId]);
        } else if (usesLeft > 0) {
          usesLeft -= 1;
          db.run(`UPDATE users SET uses_left = ? WHERE chat_id = ?`, [usesLeft, chatId]);
        }

        ctx.reply(`شما تا الان ${wins} دست بردید و ${losses} دست باختید.`);
        sendMainMenu(chatId);
        ctx.session = null;
      });
    }
  }
});

// مدیریت (فقط برای ADMIN_ID)
bot.command('panel', (ctx) => {
  if (ctx.chat.id !== ADMIN_ID) {
    ctx.reply('شما دسترسی به پنل مدیریت ندارید.');
    return;
  }

  const keyboard = {
    reply_markup: {
      keyboard: [
        ['تغییر پیام استارت'],
        ['ارسال پیام به کاربر خاص'],
        ['بن کردن کاربر'],
        ['بن تایمی کاربر'],
        ['آن بن کردن کاربر'],
        ['اضافه کردن شانس به کاربر'],
        ['بازگشت']
      ],
      resize_keyboard: true,
      one_time_keyboard: false
    }
  };

  ctx.reply('به پنل مدیریت خوش آمدید:', keyboard);
});

// مدیریت بخش‌ها (شبیه سشن ساده برای پنل مدیریتی)
const adminSession = {};

bot.on('text', (ctx, next) => {
  if (ctx.chat.id !== ADMIN_ID) return next();

  const text = ctx.message.text;

  if (text === 'بازگشت') {
    sendMainMenu(ADMIN_ID);
    adminSession[ADMIN_ID] = null;
    return;
  }

  if (!adminSession[ADMIN_ID]) {
    switch (text) {
      case 'تغییر پیام استارت':
        adminSession[ADMIN_ID] = { step: 'change_start_message' };
        ctx.reply('متن جدید پیام استارت را ارسال کنید:');
        break;
      case 'ارسال پیام به کاربر خاص':
        adminSession[ADMIN_ID] = { step: 'send_message_user_id' };
        ctx.reply('آیدی عددی کاربر را ارسال کنید:');
        break;
      case 'بن کردن کاربر':
        adminSession[ADMIN_ID] = { step: 'ban_user_permanent' };
        ctx.reply('آیدی عددی کاربر برای بن دائمی را ارسال کنید:');
        break;
      case 'بن تایمی کاربر':
        adminSession[ADMIN_ID] = { step: 'ban_user_temporary_id' };
        ctx.reply('آیدی عددی کاربر برای بن تایمی را ارسال کنید:');
        break;
      case 'آن بن کردن کاربر':
        adminSession[ADMIN_ID] = { step: 'unban_user' };
        ctx.reply('آیدی عددی کاربر برای آن بن را ارسال کنید:');
        break;
      case 'اضافه کردن شانس به کاربر':
        adminSession[ADMIN_ID] = { step: 'add_chance_user_id' };
        ctx.reply('آیدی عددی کاربر را ارسال کنید:');
        break;
      default:
        break;
    }
    return;
  }

  // مراحل بعدی هر بخش پنل
  const session = adminSession[ADMIN_ID];

  switch (session.step) {
    case 'change_start_message':
      db.run(`UPDATE settings SET start_message = ? WHERE id = 1`, [text], (err) => {
        if (!err) ctx.reply('پیام استارت با موفقیت تغییر کرد.');
        else ctx.reply('خطا در تغییر پیام استارت.');
        adminSession[ADMIN_ID] = null;
      });
      break;

    case 'send_message_user_id':
      const userIdMsg = parseInt(text);
      if (isNaN(userIdMsg)) {
        ctx.reply('آیدی معتبر نیست. لطفا عدد وارد کنید.');
        return;
      }
      session.targetUser = userIdMsg;
      session.step = 'send_message_text';
      ctx.reply('پیامی که می‌خواهید ارسال کنید را بنویسید:');
      break;

    case 'send_message_text':
      bot.telegram.sendMessage(session.targetUser, text)
        .then(() => ctx.reply('پیام با موفقیت ارسال شد.'))
        .catch(() => ctx.reply('ارسال پیام به کاربر با خطا مواجه شد.'));
      adminSession[ADMIN_ID] = null;
      break;

    case 'ban_user_permanent':
      const banUserId = parseInt(text);
      if (isNaN(banUserId)) {
        ctx.reply('آیدی معتبر نیست. لطفا عدد وارد کنید.');
        return;
      }
      db.run(`UPDATE users SET banned_until = ? WHERE chat_id = ?`, [Infinity, banUserId], (err) => {
        if (!err) ctx.reply('کاربر با موفقیت بن شد.');
        else ctx.reply('خطا در بن کردن کاربر.');
        adminSession[ADMIN_ID] = null;
      });
      break;

    case 'ban_user_temporary_id':
      const banTempUserId = parseInt(text);
      if (isNaN(banTempUserId)) {
        ctx.reply('آیدی معتبر نیست. لطفا عدد وارد کنید.');
        return;
      }
      session.targetUser = banTempUserId;
      session.step = 'ban_user_temporary_time';
      ctx.reply('مدت زمان بن (به دقیقه) را وارد کنید:');
      break;

    case 'ban_user_temporary_time':
      const minutes = parseInt(text);
      if (isNaN(minutes) || minutes <= 0) {
        ctx.reply('لطفا یک عدد صحیح مثبت وارد کنید.');
        return;
      }
      const banUntil = Date.now() + minutes * 60000;
      db.run(`UPDATE users SET banned_until = ? WHERE chat_id = ?`, [banUntil, session.targetUser], (err) => {
        if (!err) ctx.reply('کاربر به صورت موقت بن شد.');
        else ctx.reply('خطا در بن کردن کاربر.');
        adminSession[ADMIN_ID] = null;
      });
      break;

    case 'unban_user':
      const unbanUserId = parseInt(text);
      if (isNaN(unbanUserId)) {
        ctx.reply('آیدی معتبر نیست. لطفا عدد وارد کنید.');
        return;
      }
      db.run(`UPDATE users SET banned_until = 0 WHERE chat_id = ?`, [unbanUserId], (err) => {
        if (!err) ctx.reply('کاربر با موفقیت آن بن شد.');
        else ctx.reply('خطا در آن بن کردن کاربر.');
        adminSession[ADMIN_ID] = null;
      });
      break;

    case 'add_chance_user_id':
      const addChanceUserId = parseInt(text);
      if (isNaN(addChanceUserId)) {
        ctx.reply('آیدی معتبر نیست. لطفا عدد وارد کنید.');
        return;
      }
      session.targetUser = addChanceUserId;
      session.step = 'add_chance_user_amount';
      ctx.reply('تعداد شانس اضافی که می‌خواهید اضافه کنید را وارد کنید:');
      break;

    case 'add_chance_user_amount':
      const amount = parseInt(text);
      if (isNaN(amount) || amount <= 0) {
        ctx.reply('لطفا عدد صحیح مثبت وارد کنید.');
        return;
      }
      db.get(`SELECT extra_uses FROM users WHERE chat_id = ?`, [session.targetUser], (err, user) => {
        if (!user) {
          ctx.reply('کاربر یافت نشد.');
          adminSession[ADMIN_ID] = null;
          return;
        }
        const newExtra = user.extra_uses + amount;
        db.run(`UPDATE users SET extra_uses = ? WHERE chat_id = ?`, [newExtra, session.targetUser], (err2) => {
          if (!err2) ctx.reply('شانس اضافه شد.');
          else ctx.reply('خطا در افزودن شانس.');
          adminSession[ADMIN_ID] = null;
        });
      });
      break;

    default:
      break;
  }
});

// لانچ ربات
bot.launch();
console.log('Bot started...');


---
