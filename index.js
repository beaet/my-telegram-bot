async function setHelpText(newText) {
  await set(settingsRef('help_text'), newText);
}

async function getAllUsersFromDatabase() {
  // مثلا نمونه برای SQLite:
  return new Promise((resolve, reject) => {
    db.all('SELECT id, name, points FROM users', [], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

// ---- Gift Code helpers ----
const giftCodeRef = code => ref(db, `gift_codes/${code}`);
const globalGiftCodeRef = code => ref(db, `global_gift_codes/${code}`);
async function upsertGiftCode(code, points) {
  await set(giftCodeRef(code), points);
}
async function deleteGiftCode(code) {
  await remove(giftCodeRef(code));
}
async function getGiftCode(code) {
  const snap = await get(giftCodeRef(code));
  return snap.exists() ? snap.val() : null;
}
async function upsertGlobalGiftCode(code, points) {
  await set(globalGiftCodeRef(code), { points, users_used: {} });
}
async function getGlobalGiftCode(code) {
  const snap = await get(globalGiftCodeRef(code));
  return snap.exists() ? snap.val() : null;
}
async function addUserToGlobalGiftCode(code, userId) {
  const gift = await getGlobalGiftCode(code);
  if (!gift) return false;
  let users_used = gift.users_used || {};
  users_used[userId] = true;
  await update(globalGiftCodeRef(code), { users_used });
  return true;
}
async function deleteGlobalGiftCode(code) {
  await remove(globalGiftCodeRef(code));
}
async function listGiftCodesCombined() {
  const codesSnap = await get(ref(db, 'gift_codes'));
  const codes = codesSnap.exists() ? Object.keys(codesSnap.val()).map(code => ({
    type: 'یکبارمصرف',
    code,
    points: codesSnap.val()[code]
  })) : [];
  const globalSnap = await get(ref(db, 'global_gift_codes'));
  const gCodes = globalSnap.exists()
    ? Object.keys(globalSnap.val()).map(code => ({
        type: 'همگانی',
        code,
        points: globalSnap.val()[code].points
      }))
    : [];
  return codes.concat(gCodes);
}
