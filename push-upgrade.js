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

// ---- 8) (removed) ------------------------------------------------
// This used to override the mentor "Submit for review" button with a
// second, parallel signup implementation that injected duplicate
// username/password fields and wrote user docs WITHOUT
// pendingMentorReview — silently defeating the manual-review gate
// (every mentor applicant looked identical to a personal account
// until an admin happened to notice the mentorApplication field by
// hand). The base index.html already has a correct, working
// submitMentorSignup() — real email, real Firebase verification
// email, and pendingMentorReview:true set from the start — so it's
// left alone here to run as intended.

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

// ---- 7) Fix: post detail view showed baked-in "(you)" for anyone ---
// viewPost() rendered p.author raw with no cleanup at all — the one
// screen that had neither the existing .replace() workaround nor any
// per-viewer recomputation. This is the actual source of "someone
// else's post shows me as (you)" when tapping into a post.
function viewPost(id) {
  currentPostId = id;
  const p = POSTS[id];
  currentPostAuthorId = p.authorId;
  document.getElementById('pd-avatar').textContent = p.avatar;
  document.getElementById('pd-avatar').style.background = p.avatarBg;
  document.getElementById('pd-avatar').style.color = p.avatarColor;
  const cleanAuthor = (p.author || '').replace(' (you)', '');
  const isMe = p.authorId === currentUserId;
  const youTag = isMe ? ' <span style="font-size:10px;color:var(--muted);font-weight:400;">(you)</span>' : '';
  const nameEl = document.getElementById('pd-name');
  nameEl.innerHTML = cleanAuthor + (p.mentor ? ' <svg class="icon" style="color:var(--verified-blue);font-size:12px;"><use href="#i-rosette-discount-check"/></svg>' : '') + youTag;
  if (p.authorId) {
    nameEl.style.cursor = 'pointer';
    nameEl.onclick = () => viewProfile(p.authorId);
    document.getElementById('pd-avatar').style.cursor = 'pointer';
    document.getElementById('pd-avatar').onclick = () => viewProfile(p.authorId);
  }
  document.getElementById('pd-text').textContent = p.text;
  document.getElementById('pd-likes').textContent = p.likes;
  document.getElementById('pd-reposts').textContent = p.reposts;
  document.getElementById('pd-like-btn').style.color = p.liked ? 'var(--red)' : 'var(--muted)';
  document.getElementById('pd-repost-btn').style.color = (p.repostedBy || []).includes(currentUserId) ? '#27ae60' : 'var(--muted)';
  renderComments(p);
  showScreen('postDetail');
}

// ---- 5) Fix: "(you)" wrongly baked into stored names ------------
// Root cause: post/comment creation code appended " (you)" directly into
// the author name TEXT that gets saved to Firestore, so every viewer —
// not just the actual author — saw "(you)" forever, since it was just
// literal saved text, never computed per-viewer.
function addComment() {
  const input = document.getElementById('pd-comment-input');
  const text = input.value.trim();
  if (!text) return;
  const prof = PROFILES[currentUserId];
  const comment = {
    authorId: currentUserId,
    authorName: prof.name,
    avatar: prof.initials, avatarBg: prof.avatarBg, avatarColor: prof.avatarColor,
    text: text.replace(/</g, '&lt;'), likes: 0, liked: false
  };
  if (FIREBASE_ENABLED) {
    db.collection('posts').doc(currentPostId).update({
      comments: firebase.firestore.FieldValue.arrayUnion(comment)
    }).then(() => {
      POSTS[currentPostId].comments.push(comment);
      input.value = '';
      renderComments(POSTS[currentPostId]);
    }).catch(() => showToastMsg('Could not post your comment — check your connection.'));
    return;
  }
  POSTS[currentPostId].comments.push(comment);
  input.value = '';
  renderComments(POSTS[currentPostId]);
}

function renderComments(p) {
  const commentsDiv = document.getElementById('pd-comments');
  commentsDiv.innerHTML = p.comments.map((c, i) => {
    // Strip any "(you)" baked into older, already-saved comments, then
    // recompute correctly per-viewer instead of trusting stored text.
    const cleanName = (c.authorName || '').replace(' (you)', '');
    const isMe = c.authorId && c.authorId === currentUserId;
    const nameHTML = isMe ? `${cleanName} <span style="font-size:10px;color:var(--muted);font-weight:400;">(you)</span>` : cleanName;
    const clickAttr = c.authorId ? ` onclick="viewProfile('${c.authorId}')" style="cursor:pointer;"` : '';
    return `
    <div style="padding:10px 0;border-bottom:1px solid var(--border);display:flex;gap:8px;">
      <div class="avatar"${clickAttr} style="width:26px;height:26px;font-size:10px;background:${c.avatarBg};color:${c.avatarColor};flex-shrink:0;${c.authorId ? 'cursor:pointer;' : ''}">${c.avatar}</div>
      <div style="flex:1;">
        <div${clickAttr} style="font-size:12px;font-weight:600;">${nameHTML}</div>
        <div style="font-size:12px;margin-top:2px;">${c.text}</div>
        <div style="display:flex;gap:14px;margin-top:6px;">
          <span style="font-size:10.5px;color:${c.liked ? 'var(--purple)' : 'var(--muted)'};cursor:pointer;display:flex;align-items:center;gap:3px;" onclick="toggleCommentLike(${i}, this)"><svg class="icon" style="width:0.9em;height:0.9em;"><use href="#i-heart"/></svg> ${c.likes}</span>
          <span style="font-size:10.5px;color:var(--muted);cursor:pointer;" onclick="replyToComment('${cleanName}')">Reply</span>
        </div>
      </div>
    </div>`;
  }).join('');
  document.getElementById('pd-no-comments').style.display = p.comments.length ? 'none' : 'block';
}

function submitQuote() {
  const quoteText = document.getElementById('quoteTextInput').value.trim();
  if (!quoteText) return;
  closeSheet('quoteModal');
  const originalId = repostSheetTarget;
  const original = POSTS[originalId];
  original.reposts += 1;
  updateRepostUI(originalId);
  const prof = PROFILES[currentUserId];
  const cleanQuoteText = quoteText.replace(/</g, '&lt;');
  if (FIREBASE_ENABLED) {
    db.collection('posts').doc(originalId).update({
      reposts: firebase.firestore.FieldValue.increment(1)
    }).catch(() => showToastMsg('Could not save the repost count — check your connection.'));
    db.collection('posts').add({
      authorId: currentUserId, author: prof.name, avatar: prof.initials,
      avatarBg: prof.avatarBg, avatarColor: prof.avatarColor, mentor: prof.mentor, text: cleanQuoteText,
      likes: 0, likedBy: [], reposts: 0, repostedBy: [], comments: [], quotedPostId: originalId,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    }).catch(() => showToastMsg('Could not post your quote — check your connection.'));
    sendNotification(original.authorId, 'quote');
  }
  const id = 'p' + Date.now();
  POSTS[id] = { authorId: currentUserId, author: prof.name, avatar: prof.initials, avatarBg: prof.avatarBg, avatarColor: prof.avatarColor, mentor: prof.mentor, text: cleanQuoteText, likes: 0, liked: false, reposts: 0, repostedBy: [], comments: [], time: Date.now(), quotedPostId: originalId };
  extraFeedItems.unshift({ type: 'post', id, time: POSTS[id].time });
  renderExtraFeed();
  renderMyPosts();
}

function postPersonalContent() {
  const text = document.getElementById('personalPostText').value.trim();
  if (!text) { showToastMsg('Write something first.'); return; }
  const prof = PROFILES[currentUserId];
  const cleanText = text.replace(/</g, '&lt;');
  if (FIREBASE_ENABLED) {
    db.collection('posts').add({
      authorId: currentUserId, author: prof.name, avatar: prof.initials,
      avatarBg: prof.avatarBg, avatarColor: prof.avatarColor, mentor: false, text: cleanText,
      likes: 0, reposts: 0, repostedBy: [], comments: [],
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    }).then(() => {
      document.getElementById('personalPostText').value = '';
      showScreen('feed');
    }).catch(() => showToastMsg('Could not post — check your connection and try again.'));
    return;
  }
  const id = 'p' + Date.now();
  POSTS[id] = { authorId: currentUserId, author: prof.name, avatar: prof.initials, avatarBg: prof.avatarBg, avatarColor: prof.avatarColor, mentor: false, text: cleanText, likes: 0, liked: false, reposts: 0, repostedBy: [], comments: [], time: Date.now() };
  extraFeedItems.unshift({ type: 'post', id, time: POSTS[id].time });
  renderExtraFeed();
  renderMyPosts();
  document.getElementById('personalPostText').value = '';
  showScreen('feed');
}

// ---- 6) Fix: notification usernames weren't clickable ------------
function renderNotifications(items) {
  const listEl = document.getElementById('notifList');
  const emptyEl = document.getElementById('notifEmpty');
  if (!listEl) return;
  if (!items.length) {
    listEl.innerHTML = '';
    if (emptyEl) emptyEl.style.display = 'block';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';
  listEl.innerHTML = items.map(n => {
    const clickAttr = n.fromUserId ? ` onclick="viewProfile('${n.fromUserId}')" style="cursor:pointer;"` : '';
    return `
    <div class="card" style="display:flex;gap:10px;align-items:center;${n.read ? '' : 'background:rgba(108,92,231,0.06);'}">
      <div class="avatar"${clickAttr} style="width:34px;height:34px;font-size:11px;background:${n.fromAvatarBg};color:${n.fromAvatarColor};">${n.fromInitials}</div>
      <div style="flex:1;font-size:12.5px;"><span${clickAttr}>${notifText(n)}</span><div style="font-size:10.5px;color:var(--muted);margin-top:2px;">${timeAgo(n.time)}</div></div>
    </div>`;
  }).join('');
}
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
          fromUserId: d.fromUserId,
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

// ---- 9) Mentor bio editing + real profile photo upload ------------
// mv-bio was hardcoded placeholder text with no way to change it, and
// mv-avatar was just initials in a colored circle with no click
// handler at all — mentors had no way to set a real photo. This adds
// a tap-to-edit bio and a tap-to-upload avatar (opens the device's
// camera or photo library, same as any normal app), persists both to
// Firestore (/users/{uid} and /publicProfiles/{uid} so other people
// viewing this mentor's profile see them too), and patches the three
// existing functions that build a profile's on-screen state
// (setCurrentUser, viewProfile, injectFirestoreProfile) so a saved
// photo actually renders instead of just being stored invisibly.
//
// Scope note: this covers the mentor's own profile view (mv-avatar)
// and other people's view of that profile (vp-avatar). Feed posts,
// comments, and search results still show initials-only avatars for
// now — extending the photo everywhere else is a bigger, separate
// pass through feedPostCardHTML/renderComments/renderSearchResults/
// renderMessagesList if you want that too.
function applyMentorAvatarUrl(uid, url) {
  if (PROFILES[uid]) PROFILES[uid].avatarUrl = url;
  if (uid === currentUserId) {
    const el = document.getElementById('mv-avatar');
    if (el) {
      el.style.backgroundImage = `url("${url}")`;
      el.style.backgroundSize = 'cover';
      el.style.backgroundPosition = 'center';
      el.textContent = '';
    }
  }
  if (uid === currentViewedProfile) {
    const el = document.getElementById('vp-avatar');
    if (el) {
      el.style.backgroundImage = `url("${url}")`;
      el.style.backgroundSize = 'cover';
      el.style.backgroundPosition = 'center';
      el.textContent = '';
    }
  }
}

(function setupMentorProfileEditing() {
  const bioEl = document.getElementById('mv-bio');
  const avatarEl = document.getElementById('mv-avatar');
  if (!bioEl || !avatarEl || document.getElementById('mvAvatarFileInput')) return; // already set up

  // --- Bio: edit via the visible "Edit bio" button (Instagram-style), ---
  // plus the bio text itself stays clickable as a shortcut to the same action.
  function editMentorBio() {
    if (!FIREBASE_ENABLED || !currentUserId) return;
    const current = bioEl.textContent.trim();
    const next = prompt('Edit your bio:', current);
    if (next === null) return;
    const trimmed = next.trim();
    bioEl.textContent = trimmed;
    db.collection('users').doc(currentUserId).update({ bio: trimmed }).then(() => {
      const publicRef = db.collection('publicProfiles').doc(currentUserId);
      return publicRef.update({ bio: trimmed }).catch(() => publicRef.set({ bio: trimmed }, { merge: true }));
    }).then(() => {
      const p = PROFILES[currentUserId];
      if (p) p.bio = trimmed;
    }).catch(() => showToastMsg('Could not save your bio — check your connection.'));
  }
  bioEl.style.cursor = 'pointer';
  bioEl.title = 'Tap to edit your bio';
  bioEl.onclick = editMentorBio;
  const editBioBtn = document.getElementById('mvEditBioBtn');
  if (editBioBtn) editBioBtn.onclick = editMentorBio;

  // --- Avatar: tap to upload (camera or library) ---
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.id = 'mvAvatarFileInput';
  fileInput.accept = 'image/*';
  // "capture" nudges mobile browsers toward opening the camera directly;
  // the device's normal picker still offers "choose from library" too.
  fileInput.capture = 'environment';
  fileInput.style.display = 'none';
  avatarEl.parentElement.insertBefore(fileInput, avatarEl.nextSibling);

  avatarEl.style.cursor = 'pointer';
  avatarEl.title = 'Tap to change your photo';
  avatarEl.onclick = function () { fileInput.click(); };

  fileInput.onchange = function (event) {
    const file = event.target.files[0];
    if (!file || !currentUserId) return;
    if (!FIREBASE_ENABLED) { showToastMsg('Demo mode — connect Firebase to upload a real photo.'); return; }
    showToastMsg('Uploading photo...');

    let settled = false;
    const stallTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      showToastMsg('Upload is taking too long — check your connection and try again.');
    }, 45000);

    uploadToCloudinary(file).then(url => {
      if (settled) return;
      settled = true;
      clearTimeout(stallTimer);
      applyMentorAvatarUrl(currentUserId, url);
      const publicRef = db.collection('publicProfiles').doc(currentUserId);
      return Promise.all([
        db.collection('users').doc(currentUserId).update({ avatarUrl: url }),
        publicRef.update({ avatarUrl: url }).catch(() => publicRef.set({ avatarUrl: url }, { merge: true }))
      ]);
    }).then(() => { if (!settled) return; showToastMsg('Profile photo updated.'); })
    .catch((err) => {
      if (settled) return;
      settled = true;
      clearTimeout(stallTimer);
      console.error('Could not finish avatar upload:', err);
      showToastMsg('Could not upload your photo — check your connection and try again.');
    });
  };
})();

// ---- 10) Media uploads via Cloudinary instead of Firebase Storage -----
// Firebase Storage requires the paid Blaze plan. Cloudinary's free tier
// supports unsigned uploads straight from the browser, so both the
// mentor avatar upload (above) and the mentor "Post to feed" media
// upload (below) now send files there instead and save the returned
// secure_url into Firestore exactly like the Storage download URL did
// before. Nothing else about the data model changes.
//
// Fill in your cloud name below — find it on your Cloudinary dashboard
// (top of the page / Settings > Product environment settings, labeled
// "Cloud name"). CLOUDINARY_UPLOAD_PRESET must be an UNSIGNED preset
// (yours is named tbju9kel per your Cloudinary console).
const CLOUDINARY_CLOUD_NAME = 'REPLACE_WITH_YOUR_CLOUD_NAME';
const CLOUDINARY_UPLOAD_PRESET = 'tbju9kel';

function uploadToCloudinary(file, onProgress) {
  return new Promise((resolve, reject) => {
    if (!CLOUDINARY_CLOUD_NAME || CLOUDINARY_CLOUD_NAME.indexOf('REPLACE_WITH') === 0) {
      reject(new Error('Cloudinary cloud name is not configured yet.'));
      return;
    }
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
    xhr.open('POST', `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/auto/upload`);
    xhr.upload.onprogress = (e) => {
      if (onProgress && e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText);
          resolve(data.secure_url);
        } catch (err) { reject(err); }
      } else {
        reject(new Error(`Cloudinary upload failed (${xhr.status}): ${xhr.responseText}`));
      }
    };
    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.send(formData);
  });
}

// Override: same as index.html's postMentorContent, but attached media
// now goes to Cloudinary instead of Firebase Storage.
postMentorContent = function () {
  const input = document.getElementById('mentorPostText');
  const text = input.value.trim();
  if (!text) { showToastMsg('Write something first.'); return; }
  const prof = PROFILES[currentUserId];
  const cleanText = text.replace(/</g, '&lt;');
  const btn = document.getElementById('mentorPostBtn');

  if (!FIREBASE_ENABLED) {
    const id = 'p' + Date.now();
    POSTS[id] = { authorId: currentUserId, author: prof.name, avatar: prof.initials, avatarBg: prof.avatarBg, avatarColor: prof.avatarColor, mentor: true, text: cleanText, likes: 0, liked: false, reposts: 0, repostedBy: [], comments: [], time: Date.now() };
    if (mentorAttachedMedia) {
      POSTS[id].mediaUrl = mentorAttachedMedia.url;
      POSTS[id].mediaType = mentorAttachedMedia.type;
    }
    extraFeedItems.unshift({ type: 'post', id, time: POSTS[id].time });
    renderExtraFeed();
    renderMyPosts();
    input.value = '';
    clearMentorMedia();
    showToastMsg("Posted. It's live at the top of the Home feed and on your profile.");
    showScreen('home');
    setProfileType('mentor');
    return;
  }

  const postData = {
    authorId: currentUserId, author: prof.name, avatar: prof.initials,
    avatarBg: prof.avatarBg, avatarColor: prof.avatarColor, mentor: true, text: cleanText,
    likes: 0, likedBy: [], reposts: 0, repostedBy: [], comments: [],
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  const finishPost = () => {
    db.collection('posts').add(postData).then(() => {
      btn.disabled = false;
      btn.innerHTML = '<svg class="icon"><use href="#i-send"/></svg> Post to feed';
      input.value = '';
      clearMentorMedia();
      showToastMsg("Posted. It's live at the top of the Home feed and on your profile.");
      showScreen('home');
      setProfileType('mentor');
    }).catch(() => {
      btn.disabled = false;
      btn.innerHTML = '<svg class="icon"><use href="#i-send"/></svg> Post to feed';
      showToastMsg('Could not post — check your connection and try again.');
    });
  };

  btn.disabled = true;
  if (mentorAttachedMedia && mentorAttachedMedia.file) {
    btn.textContent = 'Uploading media... 0%';
    let settled = false;
    const stallTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      btn.disabled = false;
      btn.innerHTML = '<svg class="icon"><use href="#i-send"/></svg> Post to feed';
      showToastMsg('Upload is taking too long — check your connection and try again.');
    }, 45000);

    uploadToCloudinary(mentorAttachedMedia.file, (pct) => {
      if (settled) return;
      btn.textContent = `Uploading media... ${pct}%`;
    }).then(url => {
      if (settled) return;
      settled = true;
      clearTimeout(stallTimer);
      postData.mediaUrl = url;
      postData.mediaType = mentorAttachedMedia.type;
      btn.textContent = 'Posting...';
      finishPost();
    }).catch(err => {
      if (settled) return;
      settled = true;
      clearTimeout(stallTimer);
      console.error('Media upload failed:', err);
      btn.disabled = false;
      btn.innerHTML = '<svg class="icon"><use href="#i-send"/></svg> Post to feed';
      showToastMsg('Could not upload your media — check your connection and try again.');
    });
  } else {
    btn.textContent = 'Posting...';
    finishPost();
  }
};

// Wrap (not redeclare) the three functions that build profile state,
// so a saved avatarUrl actually renders wherever these already run.
const _origSetCurrentUser = setCurrentUser;
setCurrentUser = function (id) {
  _origSetCurrentUser(id);
  const p = PROFILES[id];
  if (p && p.avatarUrl) applyMentorAvatarUrl(id, p.avatarUrl);
};

const _origViewProfile = viewProfile;
viewProfile = function (id) {
  _origViewProfile(id);
  const p = PROFILES[id];
  if (p && p.avatarUrl) applyMentorAvatarUrl(id, p.avatarUrl);
};

const _origInjectFirestoreProfile = injectFirestoreProfile;
injectFirestoreProfile = function (uid, d) {
  const result = _origInjectFirestoreProfile(uid, d);
  if (PROFILES[uid] && d.avatarUrl) PROFILES[uid].avatarUrl = d.avatarUrl;
  return result;
};
