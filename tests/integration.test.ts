import { test } from "node:test";
import assert from "node:assert/strict";
import { bearerKey, hashIntegrationKey, issueIntegrationKey } from "../lib/integration";

test("integration key generation, hashing and bearer parsing", () => {
  const a = issueIntegrationKey(), b = issueIntegrationKey();
  assert.notEqual(a, b);
  assert.ok(a.length >= 40, "key should be long enough to be unguessable");
  assert.match(a, /^[A-Za-z0-9_-]+$/, "key must be URL-safe");
  assert.match(hashIntegrationKey(a), /^[a-f0-9]{64}$/, "hash must be a hex SHA-256");
  assert.equal(hashIntegrationKey(a), hashIntegrationKey(a), "hashing is deterministic");
  assert.notEqual(hashIntegrationKey(a), hashIntegrationKey(b), "different keys hash differently");
  assert.equal(bearerKey("Bearer " + a), a);
  assert.equal(bearerKey("bearer " + a), a, "scheme is case-insensitive");
  assert.equal(bearerKey("Basic " + a), "");
  assert.equal(bearerKey(""), "");
  assert.equal(bearerKey(null), "");
  assert.equal(bearerKey(undefined), "");
});
