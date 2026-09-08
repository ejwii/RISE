// ============================================================
// RISE — push notifications upgrade (drop-in, no edits to the
// main index.html body needed beyond two <script> tags).
//
// How this works: index.html declares its functions with plain
// `function name() {}` statements. When this file loads AFTER
// index.html's own script, redeclaring the same function name
// here replaces the earlier one for every caller, because they
// all look the function up in the shared global scope at call
// time. Anything NOT redeclared below (e.g. notifText,
// updateNotifBadge, renderNotifications, toggleReminders) is
// untouched and keeps working exactly as before.
// ============================================================

// ---- 0) Fix: bottom nav scrolling away instead of staying pinned -----
// Root cause: .phone only had min-height:100vh, so on real mobile
// devices (not the desktop phone-frame simulation) the whole page grew
// with content and the browser scrolled the entire page, dragging the
// bottom nav down with it. Locking .phone to the actual viewport height
// and letting only .screen-body scroll internally fixes this.
(function fixBottomNavPinning() {
  const style = document.createElement('style');
  style.textContent = `
    @media (max-width: 639px) {
      .phone {
        height: 100vh !important;
        height: 100dvh !important;
        min-height: 0 !important;
        overflow: hidden !important;
      }
    }
  `;
  document.head.appendChild(style);
})();

// ---- 1) Firebase Cloud Messaging setup -----------------------
let messaging = null;
if (typeof FIREBASE_ENABLED !== 'undefined' && FIREBASE_ENABLED &&
    typeof firebase !== 'undefined' && firebase.messaging && firebase.messaging.isSupported()) {
  messaging = firebase.messaging();
}

// Paste the "Web Push certificate" key from:
// Firebase Console -> Project settings -> Cloud Messaging ->
// Web configuration -> Web Push certificates -> generate key pair.
const VAPID_KEY = "BEuFlWs_bh1xhcN3GqTVN2fwmYsk6MpB7aIXIa1AviZSzmFAyGl2hLRXqEK_c4AAy0IQZ85tRjBaD8DEAXXix-c";

async function setupPushNotifications() {
  if (!messaging || !currentUserId || typeof Notification === 'undefined') return;
  if (Notification.permission !== 'granted') return;
  if (!VAPID_KEY || VAPID_KEY.indexOf('PASTE') === 0) return; // not configured yet
  try {
    const reg = await navigator.serviceWorker.ready;
    const token = await messaging.getToken({ vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
    if (token) {
      await db.collection('users').doc(currentUserId).update({ fcmToken: token }).catch(() => {});
    }
  } catch (e) { /* permission dance handled elsewhere; fail silently here */ }
}

// Foreground messages: FCM doesn't auto-show a system notification while
// the tab IS open (that's only for background/closed-app delivery), so
// show one ourselves using the browser Notification API directly.
if (messaging) {
  messaging.onMessage(payload => {
    if (typeof activityNotifsOn !== 'undefined' && !activityNotifsOn && payload?.data?.kind !== 'reminder') return;
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    const title = (payload.notification && payload.notification.title) || 'RISE';
    const body = (payload.notification && payload.notification.body) || '';
    try { new Notification(title, { body, icon: './icon-192.png' }); } catch (e) {}
  });
}

// ---- 2) "Activity notifications" setting (new) ----------------
const ACTIVITY_NOTIFS_KEY = 'rise_activityNotifsOn';
let activityNotifsOn = (() => {
  try { const v = localStorage.getItem(ACTIVITY_NOTIFS_KEY); return v === null ? true : v === '1'; } catch (e) { return true; }
})();

function toggleActivityNotifs() {
  activityNotifsOn = !activityNotifsOn;
  const toggleEl = document.getElementById('activityNotifToggle');
  const knobEl = document.getElementById('activityNotifKnob');
  if (toggleEl) toggleEl.style.background = activityNotifsOn ? 'var(--purple)' : '#ccc';
  if (knobEl) knobEl.style.left = activityNotifsOn ? '21px' : '3px';
  try { localStorage.setItem(ACTIVITY_NOTIFS_KEY, activityNotifsOn ? '1' : '0'); } catch (e) {}
  const noteEl = document.getElementById('activityNotifPermissionNote');
  if (!noteEl) return;
  if (activityNotifsOn && typeof Notification !== 'undefined') {
    if (Notification.permission === 'denied') {
      noteEl.textContent = 'Notifications are blocked in your browser settings — activity alerts won\'t show until you allow them.';
      noteEl.style.display = 'block';
    } else {
      noteEl.style.display = 'none';
      ensureNotificationPermission();
    }
  } else {
    noteEl.style.display = 'none';
  }
}

function applyActivityNotifToggleUI() {
  const toggleEl = document.getElementById('activityNotifToggle');
  const knobEl = document.getElementById('activityNotifKnob');
  if (!toggleEl || !knobEl) return;
  toggleEl.style.background = activityNotifsOn ? 'var(--purple)' : '#ccc';
  knobEl.style.left = activityNotifsOn ? '21px' : '3px';
}

// Inject the toggle card into Settings, right above "Daily reminders",
// instead of needing an HTML edit.
(function injectActivityNotifCard() {
  const cardTitles = document.querySelectorAll('#screen-settings .card-title');
  let remindersCard = null;
  cardTitles.forEach(el => {
    if (el.textContent.trim() === 'Daily reminders') remindersCard = el.closest('.card');
  });
  if (!remindersCard || document.getElementById('activityNotifToggle')) return;
  const html = `
    <div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;">
        <div class="card-title" style="margin-bottom:0;">Activity notifications</div>
        <div id="activityNotifToggle" onclick="toggleActivityNotifs()" style="width:42px;height:24px;border-radius:20px;background:${activityNotifsOn ? 'var(--purple)' : '#ccc'};position:relative;cursor:pointer;transition:background 0.2s;">
          <div id="activityNotifKnob" style="width:18px;height:18px;border-radius:50%;background:#fff;position:absolute;top:3px;left:${activityNotifsOn ? '21px' : '3px'};transition:left 0.2s;"></div>
        </div>
      </div>
      <div style="font-size:11px;color:var(--muted);margin-top:6px;line-height:1.6;">Get a notification for new follows, likes, reposts, and quotes.</div>
      <div id="activityNotifPermissionNote" style="display:none;font-size:10.5px;color:#e74c3c;margin-top:8px;line-height:1.6;"></div>
    </div>`;
  remindersCard.insertAdjacentHTML('beforebegin', html);
})();

// ---- 3) Remove the gap-based leaderboard card ------------------
(function removeLeaderboardCard() {
  const cardTitles = document.querySelectorAll('.card-title');
  cardTitles.forEach(el => {
    if (el.textContent.indexOf('Ranked by longest gap') !== -1) {
      const card = el.closest('.card');
      if (card) card.remove();
    }
  });
})();

// ---- 4) Overrides that plug push into existing flows ------------
function ensureNotificationPermission() {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission === 'default') {
    Notification.requestPermission().then(perm => {
      if (perm === 'granted') setupPushNotifications();
    }).catch(() => {});
  } else if (Notification.permission === 'granted') {
    setupPushNotifications();
  }
}

function fireSystemNotification(n) {
  if (!activityNotifsOn) return;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const notifScreenEl = document.getElementById('screen-notifications');
  const onNotifScreen = notifScreenEl && notifScreenEl.classList.contains('active');
  if (document.visibilityState === 'visible' && onNotifScreen) return;
  try {
    const note = new Notification('RISE', { body: notifText(n), tag: 'rise-notif-' + n.id, icon: './icon-192.png' });
    note.onclick = () => {
      window.focus();
      openNotifications();
      note.close();
    };
  } catch (e) { /* some browsers restrict Notification() outside a service worker on mobile */ }
}

let notifListenerPrimed = false;
function listenToNotifications() {
  if (!FIREBASE_ENABLED || !currentUserId) return;
  if (notifUnsubscribe) notifUnsubscribe();
  notifListenerPrimed = false;
  ensureNotificationPermission();
  notifUnsubscribe = db.collection('notifications')
    .where('toUserId', '==', currentUserId)
    .orderBy('createdAt', 'desc')
    .limit(50)
    .onSnapshot(snapshot => {
      const items = [];
      unreadNotifCount = 0;
      snapshot.forEach(doc => {
        const d = doc.data();
        if (!d.read) unreadNotifCount++;
        items.push({
          id: doc.id,
          fromName: d.fromName || 'Someone',
          fromInitials: d.fromInitials || '?',
          fromAvatarBg: d.fromAvatarBg || '#6c5ce7',
          fromAvatarColor: d.fromAvatarColor || '#fff',
          type: d.type || 'follow',
          read: !!d.read,
          time: d.createdAt ? d.createdAt.toMillis() : Date.now()
        });
      });
      if (notifListenerPrimed) {
        snapshot.docChanges().forEach(change => {
          if (change.type !== 'added') return;
          const d = change.doc.data();
          if (d.read) return;
          fireSystemNotification({ id: change.doc.id, fromName: d.fromName || 'Someone', type: d.type || 'follow' });
        });
      }
      notifListenerPrimed = true;
      renderNotifications(items);
      updateNotifBadge();
    }, () => { /* rules/index not set up yet — leave placeholder showing */ });
}

function openNotifications() {
  showScreen('notifications');
  markNotificationsRead();
  ensureNotificationPermission();
}

function sendNotification(toUserId, type) {
  if (!FIREBASE_ENABLED || !currentUserId || !toUserId || toUserId === currentUserId) return;
  const myProfile = PROFILES[currentUserId];
  if (!myProfile) return;
  db.collection('notifications').add({
    toUserId: toUserId,
    fromUserId: currentUserId,
    fromName: myProfile.name,
    fromInitials: myProfile.initials,
    fromAvatarBg: myProfile.avatarBg,
    fromAvatarColor: myProfile.avatarColor,
    type: type,
    read: false,
    pushed: false,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  }).catch(() => {});
}

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + name).classList.add('active');
  if (name === 'settings') applyActivityNotifToggleUI();
  if (typeof RESTORABLE_SCREENS !== 'undefined' && RESTORABLE_SCREENS.includes(name)) {
    try { sessionStorage.setItem(LAST_SCREEN_KEY, name); } catch (e) {}
  }
}

function saveReminderSettings() {
  const selectedBtn = document.querySelector('#screen-settings .option-btn.selected');
  reminderFrequencyHours = selectedBtn ? parseInt(selectedBtn.dataset.hours, 10) : 12;
  quietStart = document.getElementById('quietStartInput').value || '22:00';
  quietEnd = document.getElementById('quietEndInput').value || '07:00';
  const noteEl = document.getElementById('notifPermissionNote');
  noteEl.style.display = 'none';

  const persistAndReturn = () => {
    if (FIREBASE_ENABLED && currentUserId) {
      db.collection('users').doc(currentUserId).update({
        remindersOn, reminderFrequencyHours, quietStart, quietEnd,
        timezoneOffsetMinutes: new Date().getTimezoneOffset()
      }).catch(() => showToastMsg('Settings saved locally, but could not sync — check your connection.'));
    }
    showToastMsg('Reminder settings saved.');
    showScreen('home');
  };

  if (remindersOn && typeof Notification !== 'undefined') {
    if (Notification.permission === 'granted') {
      setupPushNotifications();
      persistAndReturn();
    } else if (Notification.permission === 'denied') {
      noteEl.textContent = 'Notifications are blocked in your browser settings — reminders won\'t show until you allow them.';
      noteEl.style.display = 'block';
      persistAndReturn();
    } else {
      Notification.requestPermission().then(permission => {
        if (permission !== 'granted') {
          noteEl.textContent = 'Notifications weren\'t allowed — reminders are saved but won\'t show until you allow them.';
          noteEl.style.display = 'block';
        } else {
          setupPushNotifications();
        }
        persistAndReturn();
      });
    }
  } else {
    persistAndReturn();
  }
}
