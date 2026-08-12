import test from "node:test";
import assert from "node:assert/strict";
import { testing } from "../src/worker.js";

test("admin token comparison rejects short and different values", () => {
  assert.equal(testing.constantTimeEqual("a".repeat(32), "a".repeat(32)), true);
  assert.equal(testing.constantTimeEqual("a".repeat(32), "b".repeat(32)), false);
  assert.equal(testing.constantTimeEqual("short", "shorter"), false);
});

test("push subscriptions require HTTPS and valid encryption keys", () => {
  const valid = { endpoint: "https://push.example.test/subscription", keys: { p256dh: "A".repeat(65), auth: "B".repeat(16) } };
  assert.deepEqual(testing.validateSubscription(valid), { ...valid, expirationTime: null });
  assert.equal(testing.validateSubscription({ ...valid, endpoint: "http://push.example.test" }), null);
  assert.equal(testing.validateSubscription({ ...valid, keys: { p256dh: "tiny", auth: "tiny" } }), null);
});

test("notification payloads are bounded and cannot choose an external URL", () => {
  const payload = testing.validateNotification({ title: "T".repeat(100), body: "安扭～", tag: "bad tag!", url: "https://evil.example" });
  assert.equal(payload.title.length, 80);
  assert.equal(payload.body, "安扭～");
  assert.equal(payload.tag, "badtag");
  assert.equal(payload.url, "./");
  assert.equal(testing.validateNotification({ body: "" }), null);
});

test("subscription counting follows KV pagination and stops at capacity", async () => {
  let calls = 0;
  const kv = {
    async list({ cursor }) {
      calls += 1;
      if (!cursor) return { keys: Array.from({ length: 1000 }, (_, index) => ({ name: `subscription:${index}` })), list_complete: false, cursor: "next" };
      return { keys: Array.from({ length: 600 }, (_, index) => ({ name: `subscription:next-${index}` })), list_complete: true };
    },
  };
  assert.equal(await testing.countSubscriptions({ SUBSCRIPTIONS: kv }, 5000), 1600);
  assert.equal(calls, 2);
});
