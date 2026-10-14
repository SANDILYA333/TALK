import { axiosInstance } from "../axios.js";

/**
 * Checks if Push Notifications and Service Workers are supported in the current browser.
 * @returns {boolean}
 */
export function isPushSupported() {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/**
 * Registers the service worker script.
 * @returns {Promise<ServiceWorkerRegistration | null>}
 */
export async function registerServiceWorker() {
  if (!isPushSupported()) return null;
  try {
    const registration = await navigator.serviceWorker.register("/sw.js");
    return registration;
  } catch (err) {
    console.warn("Service worker registration failed:", err);
    return null;
  }
}

/**
 * Helper to convert Base64 URL to Uint8Array for VAPID key.
 */
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Subscribes user to push notifications and syncs subscription with the backend.
 *
 * @param {string} [vapidPublicKey]
 * @returns {Promise<{ success: boolean, subscription?: PushSubscription, error?: string }>}
 */
export async function subscribeToPushNotifications(vapidPublicKey) {
  if (!isPushSupported()) {
    return { success: false, error: "Push notifications not supported on this platform" };
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return { success: false, error: "Notification permission denied" };
  }

  const registration = await registerServiceWorker();
  if (!registration) {
    return { success: false, error: "Could not register service worker" };
  }

  try {
    const key = vapidPublicKey || import.meta.env.VITE_VAPID_PUBLIC_KEY;
    const subscribeOptions = {
      userVisibleOnly: true,
      ...(key ? { applicationServerKey: urlBase64ToUint8Array(key) } : {}),
    };

    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe(subscribeOptions);
    }

    // Sync subscription with backend
    await axiosInstance.post("/push/subscribe", {
      subscription: subscription.toJSON(),
    });

    return { success: true, subscription };
  } catch (err) {
    return { success: false, error: err.message || "Failed to subscribe to push notifications" };
  }
}

/**
 * Unsubscribes user from push notifications.
 */
export async function unsubscribeFromPushNotifications() {
  if (!isPushSupported()) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      await subscription.unsubscribe();
      await axiosInstance.post("/push/unsubscribe", {
        endpoint: subscription.endpoint,
      });
    }
  } catch (err) {
    console.warn("Error unsubscribing from push notifications:", err);
  }
}
