/* global clients */
// TALK Service Worker — Silent Encrypted Push Notifications (Feature 10)
// Invariant: ZERO plaintext in push payload. Notifications display generic alerts only.

self.addEventListener("push", (event) => {
  let data = {
    title: "TALK",
    body: "New encrypted message received",
    tag: "talk-message",
    url: "/",
  };

  if (event.data) {
    try {
      const parsed = event.data.json();
      // Ensure no private key or raw decrypted message text was passed
      data.title = parsed.title || data.title;
      data.body = parsed.body || data.body;
      if (parsed.tag) data.tag = parsed.tag;
      if (parsed.url) data.url = parsed.url;
    } catch {
      // Fallback to default generic text if not json
    }
  }

  const options = {
    body: data.body,
    icon: "/logo.png",
    badge: "/logo.png",
    tag: data.tag,
    renotify: true,
    data: {
      url: data.url,
    },
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url || "/";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      // Focus existing open tab if available
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          return client.focus();
        }
      }
      // Otherwise open a new window
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
