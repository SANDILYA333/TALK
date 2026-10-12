import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { subscribe, unsubscribe } from "../push.controller.js";
import PushSubscription from "../../models/push-subscription.model.js";

function createMockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
  };
}

describe("Backend Push Subscription & Silent Notifications Suite (Feature 10)", () => {
  const aliceId = "660000000000000000000001";
  let savedSubscriptions = [];

  beforeEach(() => {
    savedSubscriptions = [];

    PushSubscription.findOneAndUpdate = async function (filter, update) {
      savedSubscriptions.push({ ...filter, ...update });
      return { ...filter, ...update };
    };

    PushSubscription.findOneAndDelete = async function (filter) {
      savedSubscriptions = savedSubscriptions.filter((s) => s.endpoint !== filter.endpoint);
      return { deleted: true };
    };
  });

  it("1. Successfully registers a valid Web Push subscription for user", async () => {
    const validSub = {
      endpoint: "https://fcm.googleapis.com/fcm/send/test-token-1234",
      keys: {
        p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QT9PkJE35PJpq5WvDan1DoNItf-1D4xLj1uUI2006oc6",
        auth: "tBHItJI5svbpez7KI4CCXg",
      },
    };

    const req = {
      user: { _id: aliceId },
      body: { subscription: validSub },
    };
    const res = createMockRes();

    await subscribe(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.message, "Push subscription registered successfully");
    assert.equal(savedSubscriptions.length, 1);
    assert.equal(savedSubscriptions[0].endpoint, validSub.endpoint);
    assert.equal(String(savedSubscriptions[0].userId), aliceId);
  });

  it("2. Rejects malformed push subscription objects (400 Bad Request)", async () => {
    const req = {
      user: { _id: aliceId },
      body: { subscription: { endpoint: "https://example.com" } }, // missing keys
    };
    const res = createMockRes();

    await subscribe(req, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.message, "Invalid push subscription object");
  });

  it("3. Successfully removes push subscription on unsubscribe", async () => {
    const req = {
      user: { _id: aliceId },
      body: { endpoint: "https://fcm.googleapis.com/fcm/send/test-token-1234" },
    };
    const res = createMockRes();

    await unsubscribe(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.message, "Push subscription removed successfully");
  });

  it("4. Rejects unsubscribe without endpoint", async () => {
    const req = {
      user: { _id: aliceId },
      body: {},
    };
    const res = createMockRes();

    await unsubscribe(req, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.message, "Endpoint is required");
  });
});
