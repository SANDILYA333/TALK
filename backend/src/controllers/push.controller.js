import PushSubscription from "../models/push-subscription.model.js";
import { logger } from "../lib/logger.js";

/**
 * Subscribes user device to web push notifications.
 */
export async function subscribe(req, res) {
  try {
    const { subscription } = req.body;
    const userId = req.user._id;

    if (!subscription || !subscription.endpoint || !subscription.keys) {
      return res.status(400).json({ message: "Invalid push subscription object" });
    }

    const { endpoint, keys } = subscription;
    if (!keys.p256dh || !keys.auth) {
      return res.status(400).json({ message: "Subscription keys missing required parameters" });
    }

    // Upsert subscription
    await PushSubscription.findOneAndUpdate(
      { endpoint },
      { userId, endpoint, keys },
      { upsert: true, new: true }
    );

    res.status(200).json({ message: "Push subscription registered successfully" });
  } catch (error) {
    logger.error("push_subscribe_failed", "Error in push subscribe", { error: error.message });
    res.status(500).json({ message: "Internal server error" });
  }
}

/**
 * Unsubscribes user device from web push notifications.
 */
export async function unsubscribe(req, res) {
  try {
    const { endpoint } = req.body;

    if (!endpoint) {
      return res.status(400).json({ message: "Endpoint is required" });
    }

    await PushSubscription.findOneAndDelete({ endpoint });

    res.status(200).json({ message: "Push subscription removed successfully" });
  } catch (error) {
    logger.error("push_unsubscribe_failed", "Error in push unsubscribe", { error: error.message });
    res.status(500).json({ message: "Internal server error" });
  }
}
