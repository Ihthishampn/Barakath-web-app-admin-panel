/* eslint-disable */
/**
 * Barakath web push service worker.
 *
 * Registered by src/lib/push.ts, which appends the Firebase web config as query
 * parameters — a file under /public is static, so it cannot read the
 * NEXT_PUBLIC_* values that are inlined into the app bundle at build time, and
 * hard-coding them here would mean a second copy to keep in sync.
 *
 * Two jobs:
 *  1. Show a notification for a background push that carries only `data`.
 *     A push that carries a `notification` block is displayed by the FCM SDK
 *     itself — showing it again here would double every alert.
 *  2. Route the click through the SAME deep-link mapping the rest of the site
 *     uses. That mapping lives in src/lib/deepLink.ts; a service worker cannot
 *     import from the bundle, so `destinationFor` below is a deliberate copy —
 *     CHANGE BOTH TOGETHER.
 */

importScripts('https://www.gstatic.com/firebasejs/10.13.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.13.0/firebase-messaging-compat.js');

var params = new URL(self.location.href).searchParams;
var config = {
  apiKey: params.get('apiKey'),
  authDomain: params.get('authDomain'),
  projectId: params.get('projectId'),
  storageBucket: params.get('storageBucket'),
  messagingSenderId: params.get('messagingSenderId'),
  appId: params.get('appId'),
};

// A new worker must take over immediately: the old one keeps the previous
// deep-link mapping and would keep handling clicks until every tab is closed.
self.addEventListener('install', function () {
  self.skipWaiting();
});
self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});

/** Mirror of deepLinkDestination() in src/lib/deepLink.ts. */
function destinationFor(type, target) {
  var t = (target || '').trim();
  switch (type) {
    case 'product':
      return t ? '/product/' + encodeURIComponent(t) : null;
    case 'category':
      return t ? '/c/' + encodeURIComponent(t) : null;
    case 'home':
      return '/';
    case 'url':
      // http(s) only — same guard the function applies when it accepts the link.
      try {
        var u = new URL(t);
        return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
      } catch (e) {
        return null;
      }
    default:
      return null;
  }
}

/**
 * The push's data payload, wherever it ended up.
 *
 * When the SDK displays the notification it stashes the whole message under
 * `FCM_MSG`; when we display it ourselves (data-only push) we put the data on
 * the notification directly.
 */
function dataOf(notification) {
  var d = (notification && notification.data) || {};
  if (d.FCM_MSG && d.FCM_MSG.data) return d.FCM_MSG.data;
  return d;
}

/**
 * Registered BEFORE firebase.messaging() below, so it runs first and
 * `stopImmediatePropagation` keeps the SDK's default handler — which only ever
 * opens the site root — from opening a second window.
 */
self.addEventListener('notificationclick', function (event) {
  event.stopImmediatePropagation();
  event.notification.close();

  var data = dataOf(event.notification);
  var dest = destinationFor(data.deepLinkType, data.deepLinkTarget);
  // No destination is still a click on OUR notification: land them on the inbox
  // rather than doing nothing at all.
  var url = new URL(dest || '/account/notifications', self.location.origin).href;
  var sameOrigin = url.indexOf(self.location.origin) === 0;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      if (sameOrigin) {
        for (var i = 0; i < list.length; i++) {
          var client = list[i];
          if (client.url.indexOf(self.location.origin) !== 0) continue;
          // Reuse the open tab: focus it and take it to the destination.
          return client.focus().then(function (c) {
            var target = c || client;
            return target.navigate ? target.navigate(url).catch(function () {}) : undefined;
          });
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});

// An unconfigured worker (registered without config, which should not happen)
// must not throw on every push — it simply does nothing.
if (config.apiKey && config.projectId && config.messagingSenderId && config.appId) {
  firebase.initializeApp(config);
  var messaging = firebase.messaging();

  messaging.onBackgroundMessage(function (payload) {
    // Already displayed by the SDK — see the file header.
    if (payload && payload.notification) return;
    var data = (payload && payload.data) || {};
    var title = data.title || 'Barakath';
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: '/images/logo.png',
      // Collapse repeats of the same broadcast into one entry.
      tag: data.notificationId || data.broadcastId || undefined,
      data: data,
    });
  });
}
