import assert from "node:assert/strict";
import test from "node:test";
import { ResultTradesLoadLease } from "../../frontend/src/store/resultTradesLoadLease.js";

test("bootstrap success settles a superseded pending Reports request", () => {
  const lease = new ResultTradesLoadLease();
  const pendingRoute = lease.begin(true);
  const bootstrap = lease.begin(false);

  assert.equal(bootstrap.loadingOwner, null);
  assert.equal(lease.isCurrent(pendingRoute.version), false);
  assert.equal(lease.settle(pendingRoute.version), false);
});

test("stale completion cannot clear a newer Reports loading owner", () => {
  const lease = new ResultTradesLoadLease();
  const stale = lease.begin(true);
  const newer = lease.begin(true);

  assert.equal(lease.settle(stale.version), false);
  assert.equal(lease.isCurrent(newer.version), true);
  assert.equal(lease.settle(newer.version), true);
});
