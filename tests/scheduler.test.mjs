import test from "node:test";
import assert from "node:assert/strict";
import { AsyncSemaphore } from "../lib/subagent-scheduler.mjs";

test("AsyncSemaphore basic acquire and release", async () => {
  const sem = new AsyncSemaphore(1);
  assert.equal(sem.current, 0);
  assert.equal(sem.capacity, 1);

  await sem.acquire();
  assert.equal(sem.current, 1);

  sem.release();
  assert.equal(sem.current, 0);
});

test("AsyncSemaphore enforces concurrency limit = 1", async () => {
  const sem = new AsyncSemaphore(1);
  const log = [];

  async function worker(id, delayMs) {
    await sem.acquire();
    log.push(`start-${id}`);
    await new Promise((r) => setTimeout(r, delayMs));
    log.push(`end-${id}`);
    sem.release();
  }

  await Promise.all([worker("A", 50), worker("B", 10), worker("C", 10)]);

  // With limit = 1, workers must execute serially: start-A -> end-A -> start-B -> end-B ...
  assert.deepEqual(log, [
    "start-A",
    "end-A",
    "start-B",
    "end-B",
    "start-C",
    "end-C",
  ]);
});

test("AsyncSemaphore capacity can be dynamically increased", async () => {
  const sem = new AsyncSemaphore(1);
  assert.equal(sem.capacity, 1);

  sem.setCapacity(3);
  assert.equal(sem.capacity, 3);

  await sem.acquire();
  await sem.acquire();
  await sem.acquire();
  assert.equal(sem.current, 3);

  sem.release();
  sem.release();
  sem.release();
  assert.equal(sem.current, 0);
});