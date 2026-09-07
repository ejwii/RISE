// RISE push notification poller.
// Runs on a schedule via GitHub Actions instead of a Firebase Cloud
// Function — this avoids needing the Blaze (billing) plan entirely.
// Does two jobs each run:
//   1. Sends a push for any /notifications doc not yet pushed (follow,
//      like, repost, quote).
//   2. Sends a scheduled reminder push to any user whose personal
//      frequency has elapsed and who isn't in quiet hours.

const admin = require("firebase-admin");

// Phones/text viewers sometimes turn the private_key field's literal \n
// escape sequences into real line breaks when copying the file's content.
// That makes the raw text invalid JSON (a bare newline inside a quoted
// string), even though it looks fine to a human. Repair just that one
// field before parsing, regardless of how the paste mangled it.
let raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
raw = raw.replace(/"private_key":\s*"([^"]*)"/, (match, key) => {
  const fixed = key.replace(/\r?\n/g, "\\n");
  return `"private_key": "${fixed}"`;
});
const serviceAccount = JSON.parse(raw);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

const db = admin.firestore();
const messaging = admin.messaging();

async function sendActivityPushes() {
  const snap = await db.collection("notifications").where("pushed", "==", false).get();
  if (snap.empty) return;

  for (const doc of snap.docs) {
    const n = doc.data();
    const userDoc = await db.collection("users").doc(n.toUserId).get();
    const token = userDoc.exists ? userDoc.data().fcmToken : null;

    if (!token) {
      await doc.ref.update({ pushed: true }); // nothing to send to, don't retry forever
      continue;
    }

    const textByType = {
      follow: `${n.fromName || "Someone"} started following you`,
      like: `${n.fromName || "Someone"} liked your post`,
      repost: `${n.fromName || "Someone"} reposted your post`,
      quote: `${n.fromName || "Someone"} quoted your post`,
    };
    const body = textByType[n.type] || `${n.fromName || "Someone"} sent you a notification`;

    try {
      await messaging.send({
        token,
        notification: { title: "RISE", body },
        data: { kind: "activity", tag: `rise-notif-${doc.id}` },
        webpush: { fcmOptions: { link: "/" } },
      });
    } catch (err) {
      if (err.code === "messaging/registration-token-not-registered") {
        await db.collection("users").doc(n.toUserId).update({ fcmToken: admin.firestore.FieldValue.delete() });
      }
      console.error("activity push failed for", doc.id, err.message);
    }
    await doc.ref.update({ pushed: true });
  }
}

function isInQuietHours(startStr, endStr, timezoneOffsetMinutes, nowMs) {
  const localMs = nowMs - timezoneOffsetMinutes * 60000;
  const localDate = new Date(localMs);
  const nowMin = localDate.getUTCHours() * 60 + localDate.getUTCMinutes();

  const [sh, sm] = startStr.split(":").map(Number);
  const [eh, em] = endStr.split(":").map(Number);
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;

  if (startMin === endMin) return false;
  if (startMin < endMin) return nowMin >= startMin && nowMin < endMin;
  return nowMin >= startMin || nowMin < endMin;
}

async function sendScheduledReminders() {
  const now = Date.now();
  const usersSnap = await db.collection("users").where("remindersOn", "==", true).get();

  for (const doc of usersSnap.docs) {
    const u = doc.data();
    if (!u.fcmToken) continue;

    const freqHours = u.reminderFrequencyHours || 12;
    const lastReminderTime = u.lastReminderTime || 0;
    const elapsedHours = (now - lastReminderTime) / 3600000;
    if (elapsedHours < freqHours) continue;

    if (isInQuietHours(u.quietStart || "22:00", u.quietEnd || "07:00", u.timezoneOffsetMinutes || 0, now)) continue;

    try {
      await messaging.send({
        token: u.fcmToken,
        notification: { title: "RISE", body: "Just checking in — how are you doing today?" },
        data: { kind: "reminder", tag: "rise-reminder" },
        webpush: { fcmOptions: { link: "/" } },
      });
      await doc.ref.update({ lastReminderTime: now });
    } catch (err) {
      if (err.code === "messaging/registration-token-not-registered") {
        await doc.ref.update({ fcmToken: admin.firestore.FieldValue.delete() });
      }
      console.error("reminder push failed for", doc.id, err.message);
    }
  }
}

(async () => {
  await sendActivityPushes();
  await sendScheduledReminders();
  console.log("Poller run complete:", new Date().toISOString());
})().catch(err => {
  console.error("Poller run failed:", err);
  process.exit(1);
});
