const { Telegraf, session } = require('telegraf');
const sqlite3 = require('sqlite3').verbose();

const bot = new Telegraf('8129314550:AAFQTvL8VVg-4QtQD8QLY03LCWiSP1uaCak');
const ADMIN_ID = 381183017;

bot.use(session());

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

// استارت و ثبت دعوت
bot.start(async (ctx) => {
  const chatId = ctx.chat.id;
  const startPayload = ctx.startPayload;

  // ثبت کاربر جدید با ۵ شانس اولیه
  db.get(`SELECT * FROM users WHERE chat_id = ?`, [chatId], (err, user) => {
    if (err) return console.error(err);
    if (!user) {
      db.run(`INSERT INTO users (chat_id, uses_left, banned_until, extra_uses) VALUES (?, 5, 0, 0)`, [chatId]);
    }
  });

  // ثبت دعوت اگر پارامتر start وجود داشته باشد و معتبر باشد
  if (startPayload) {
    const inviterId = parseInt(startPayload);
    if (!isNaN(inviterId) && inviterId !== chatId) {
      db.get(`SELECT * FROM invites WHERE invitee = ?`, [chatId], (err, inviteRow) => {
        if (!inviteRow) {
          db.run(`INSERT INTO invites (inviter, invitee) VALUES (?, ?)`, [inviterId, chatId], (err2) => {
            if (!err2) {
              // ۵ شانس اضافه دائمی برای دعوت کننده
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

// میدلور بررسی بن بودن
bot.use(async (ctx, next) => {
  if (!ctx.chat) return next(); // بعضی آپدیت‌ها چت ندارند
  const chatId = ctx.chat.id;
  db.get(`SELECT banned_until FROM users WHERE chat_id = ?`, [chatId], (err, row) => {
    if (row && row.banned_until > Date.now()) {
      ctx.reply('متأسفانه شما تا اطلاع ثانوی از استفاده از ربات محدود شده‌اید.');
    } else {
      next();
    }
  });
});

// پاسخ به پیام‌ها و دکمه‌ها
bot.on('text', (ctx) => {
  const chatId = ctx.chat.id;
  const text = ctx.message.text;

  // تابع کم کردن ۱ شانس از کاربران (اول از extra_uses، سپس uses_left)
  function consumeChance(callback) {
    db.get(`SELECT uses_left, extra_uses FROM users WHERE chat_id = ?`, [chatId], (err, user) => {
      if (!user) {
        callback(false);
        return;
      }
      let { uses_left, extra_uses } = user;
      if (extra_uses > 0) {
        extra_uses--;
        db.run(`UPDATE users SET extra_uses = ? WHERE chat_id = ?`, [extra_uses, chatId]);
        callback(true);
      } else if (uses_left > 0) {
        uses_left--;
        db.run(`UPDATE users SET uses_left = ? WHERE chat_id = ?`, [uses_left, chatId]);
        callback(true);
      } else {
        callback(false);
      }
    });
  }

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
      ctx.session.action = 'get_rate';
    });
  }
  else if (text === 'چند دست بردم چند دست باختم؟') {
    ctx.reply('لطفا تعداد کل مچ‌هایی که بازی کرده‌اید را وارد کنید:');
    ctx.session.action = 'get_matches';
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
    if (ctx.session.action === 'get_rate') {
      let rate = parseFloat(text.replace(',', '.'));
      if (isNaN(rate) || rate < 0 || rate > 100) {
        ctx.reply('لطفا یک عدد معتبر بین 0 تا 100 وارد کنید.');
        return;
      }
      consumeChance((success) => {
        if (!success) {
          ctx.reply('شانس استفاده ندارید. لطفا شانس‌های خود را افزایش دهید.');
          ctx.session = null;
          return;
        }
        ctx.reply(`شما ریت ${rate}% را وارد کردید.`);
        sendMainMenu(chatId);
        ctx.session = null;
      });
    }
    else if (ctx.session.action === 'get_matches') {
      let matches = parseInt(text);
      if (isNaN(matches) || matches <= 0) {
        ctx.reply('لطفا تعداد مچ‌ها را به عدد صحیح وارد کنید.');
        return;
      }
      ctx.session.matches = matches;
      ctx.reply('لطفا ریت خود را به درصد وارد کنید:');
      ctx.session.action = 'get_rate_for_matches';
    }
    else if (ctx.session.action === 'get_rate_for_matches') {
      let rate = parseFloat(text.replace(',', '.'));
      if (isNaN(rate) || rate < 0 || rate > 100) {
        ctx.reply('لطفا یک عدد معتبر بین 0 تا 100 وارد کنید.');
        return;
      }

      const matches = ctx.session.matches;
      const wins = Math.round(matches * (rate / 100));
      const losses = matches - wins;

      consumeChance((success) => {
        if (!success) {
          ctx.reply('شانس استفاده ندارید. لطفا شانس‌های خود را افزایش دهید.');
          ctx.session = null;
          return;
        }
        ctx.reply(`شما تا الان ${wins} دست بردید و ${losses} دست باختید.`);
        sendMainMenu(chatId);
        ctx.session = null;
      });
    }
  }
});

// پنل مدیریت فقط برای ADMIN_ID
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

    // ... کد قبل از این قسمت بدون تغییر

case 'send_message_text':
  bot.telegram.sendMessage(session.targetUser, text)
    .then(() => ctx.reply('پیام با موفقیت ارسال شد.'))
    .catch(() => ctx.reply('ارسال پیام به کاربر با خطا رخ داد.'))
    .finally(() => {
      adminSession[ADMIN_ID] = null;
    });
  break;

// ... ادامه کد بدون تغییر
      
    case 'ban_user_permanent':
      {
        const userIdBan = parseInt(text);
        if (isNaN(userIdBan)) {
          ctx.reply('آیدی معتبر نیست. لطفا عدد وارد کنید.');
          return;
        }
        const forever = 32503680000000; // تاریخ خیلی دور آینده (سال 3000 میلادی)
        db.get(`SELECT * FROM users WHERE chat_id = ?`, [userIdBan], (err, row) => {
          if (!row) {
            ctx.reply('کاربر یافت نشد.');
            adminSession[ADMIN_ID] = null;
            return;
          }
          db.run(`UPDATE users SET banned_until = ? WHERE chat_id = ?`, [forever, userIdBan], (err2) => {
            if (!err2) ctx.reply('کاربر با موفقیت به صورت دائمی بن شد.');
            else ctx.reply('خطا در بن کردن کاربر.');
            adminSession[ADMIN_ID] = null;
          });
        });
      }
      break;

    case 'ban_user_temporary_id':
      {
        const userIdTempBan = parseInt(text);
        if (isNaN(userIdTempBan)) {
          ctx.reply('آیدی معتبر نیست. لطفا عدد وارد کنید.');
          return;
        }
        session.targetUser = userIdTempBan;
        session.step = 'ban_user_temporary_duration';
        ctx.reply('مدت زمان بن (به دقیقه) را وارد کنید:');
      }
      break;

    case 'ban_user_temporary_duration':
      {
        const durationMin = parseInt(text);
        if (isNaN(durationMin) || durationMin <= 0) {
          ctx.reply('مدت زمان معتبر نیست. لطفا عدد مثبت وارد کنید.');
          return;
        }
        const bannedUntil = Date.now() + durationMin * 60 * 1000;
        db.get(`SELECT * FROM users WHERE chat_id = ?`, [session.targetUser], (err, row) => {
          if (!row) {
            ctx.reply('کاربر یافت نشد.');
            adminSession[ADMIN_ID] = null;
            return;
          }
          db.run(`UPDATE users SET banned_until = ? WHERE chat_id = ?`, [bannedUntil, session.targetUser], (err2) => {
            if (!err2) ctx.reply(`کاربر به مدت ${durationMin} دقیقه بن شد.`);
            else ctx.reply('خطا در بن تایمی کاربر.');
            adminSession[ADMIN_ID] = null;
          });
        });
      }
      break;

    case 'unban_user':
      {
        const userIdUnban = parseInt(text);
        if (isNaN(userIdUnban)) {
          ctx.reply('آیدی معتبر نیست. لطفا عدد وارد کنید.');
          return;
        }
        db.get(`SELECT * FROM users WHERE chat_id = ?`, [userIdUnban], (err, row) => {
          if (!row) {
            ctx.reply('کاربر یافت نشد.');
            adminSession[ADMIN_ID] = null;
            return;
          }
          db.run(`UPDATE users SET banned_until = 0 WHERE chat_id = ?`, [userIdUnban], (err2) => {
            if (!err2) ctx.reply('کاربر با موفقیت آن بن شد.');
            else ctx.reply('خطا در آن بن کردن کاربر.');
            adminSession[ADMIN_ID] = null;
          });
        });
      }
      break;

    case 'add_chance_user_id':
      {
        const userIdAdd = parseInt(text);
        if (isNaN(userIdAdd)) {
          ctx.reply('آیدی معتبر نیست. لطفا عدد وارد کنید.');
          return;
        }
        session.targetUser = userIdAdd;
        session.step = 'add_chance_user_amount';
        ctx.reply('تعداد شانس‌هایی که می‌خواهید اضافه کنید را وارد کنید:');
      }
      break;

    case 'add_chance_user_amount':
      {
        const amount = parseInt(text);
        if (isNaN(amount) || amount <= 0) {
          ctx.reply('مقدار معتبر نیست. لطفا عدد مثبت وارد کنید.');
          return;
        }
        db.get(`SELECT uses_left FROM users WHERE chat_id = ?`, [session.targetUser], (err, row) => {
          if (!row) {
            ctx.reply('کاربر یافت نشد.');
            adminSession[ADMIN_ID] = null;
            return;
          }
          const newUses = row.uses_left + amount;
          db.run(`UPDATE users SET uses_left = ? WHERE chat_id = ?`, [newUses, session.targetUser], (err2) => {
            if (!err2) ctx.reply(`تعداد ${amount} شانس به کاربر اضافه شد.`);
            else ctx.reply('خطا در اضافه کردن شانس.');
            adminSession[ADMIN_ID] = null;
          });
        });
      }
      break;

    default:
      ctx.reply('دستور نامعتبر. لطفا دوباره تلاش کنید.');
      adminSession[ADMIN_ID] = null;
      break;
  }
});

bot.launch();
