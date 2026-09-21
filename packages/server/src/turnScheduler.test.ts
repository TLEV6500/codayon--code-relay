import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test";
import {
  scheduleTurnExpiry,
  startTurnTicks,
  cancelTurnTimers,
  getTimersForRoom,
  clearAllTimers,
} from "./turnScheduler";

// Get jest for fake timers
const { jest } = require("bun:test");

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  clearAllTimers();
  jest.useRealTimers();
});

describe("turnScheduler (FEAT-003 Task 1)", () => {
  test("scheduleTurnExpiry fires exactly once at the correct delay", () => {
    const onExpiry = mock(() => {});
    const durationMs = 5000;

    scheduleTurnExpiry("room1", durationMs, onExpiry);
    expect(onExpiry).not.toHaveBeenCalled();

    // Advance time by less than the duration
    jest.advanceTimersByTime(4999);
    expect(onExpiry).not.toHaveBeenCalled();

    // Advance past the duration
    jest.advanceTimersByTime(1);
    expect(onExpiry).toHaveBeenCalledTimes(1);

    // Advance more time; expiry should not fire again
    jest.advanceTimersByTime(1000);
    expect(onExpiry).toHaveBeenCalledTimes(1);
  });

  test("scheduleTurnExpiry clears timers record when fired", () => {
    const onExpiry = mock(() => {});
    const durationMs = 1000;

    scheduleTurnExpiry("room1", durationMs, onExpiry);
    expect(getTimersForRoom("room1")).toBeDefined();

    jest.advanceTimersByTime(1001);
    expect(getTimersForRoom("room1")).toBeUndefined();
  });

  test("cancelTurnTimers prevents expiry from firing", () => {
    const onExpiry = mock(() => {});
    const durationMs = 5000;

    scheduleTurnExpiry("room1", durationMs, onExpiry);
    jest.advanceTimersByTime(2000);

    // Cancel before expiry
    cancelTurnTimers("room1");
    expect(getTimersForRoom("room1")).toBeUndefined();

    // Advance past original expiry time
    jest.advanceTimersByTime(4000);
    expect(onExpiry).not.toHaveBeenCalled();
  });

  test("cancelTurnTimers is idempotent", () => {
    const onExpiry = mock(() => {});

    scheduleTurnExpiry("room1", 5000, onExpiry);
    cancelTurnTimers("room1");
    cancelTurnTimers("room1"); // should not throw
    cancelTurnTimers("room1"); // should not throw

    expect(getTimersForRoom("room1")).toBeUndefined();
  });

  test("timer replacement doesn't leak old timers", () => {
    const onExpiry1 = mock(() => {});
    const onExpiry2 = mock(() => {});

    scheduleTurnExpiry("room1", 5000, onExpiry1);
    const timers1 = getTimersForRoom("room1");
    expect(timers1).toBeDefined();

    // Schedule a new timer for the same room (should cancel the old one)
    scheduleTurnExpiry("room1", 3000, onExpiry2);
    const timers2 = getTimersForRoom("room1");
    expect(timers2).toBeDefined();

    // The old timer should not be the same object
    expect(timers1!.expiryTimeoutId).not.toBe(timers2!.expiryTimeoutId);

    // Advance to the OLD timer's expiry time
    jest.advanceTimersByTime(5001);

    // Only the NEW timer's callback should have fired
    expect(onExpiry1).not.toHaveBeenCalled();
    expect(onExpiry2).toHaveBeenCalledTimes(1);
  });

  test("startTurnTicks broadcasts every 1 second", () => {
    const onExpiry = mock(() => {});
    const onTick = mock(() => {});
    const durationMs = 10000;

    scheduleTurnExpiry("room1", durationMs, onExpiry);
    startTurnTicks("room1", onTick);

    // No tick before 1 second
    expect(onTick).not.toHaveBeenCalled();

    // Tick at 1 second
    jest.advanceTimersByTime(1000);
    expect(onTick).toHaveBeenCalledTimes(1);
    expect(onTick.mock.calls[0][0]).toBe(9000); // 10000 - 1000

    // Tick at 2 seconds
    jest.advanceTimersByTime(1000);
    expect(onTick).toHaveBeenCalledTimes(2);
    expect(onTick.mock.calls[1][0]).toBe(8000);

    // Tick at 3 seconds
    jest.advanceTimersByTime(1000);
    expect(onTick).toHaveBeenCalledTimes(3);
    expect(onTick.mock.calls[2][0]).toBe(7000);
  });

  test("ticks send remaining time correctly", () => {
    const onExpiry = mock(() => {});
    const onTick = mock(() => {});
    const durationMs = 5000;

    scheduleTurnExpiry("room1", durationMs, onExpiry);
    startTurnTicks("room1", onTick);

    jest.advanceTimersByTime(1000);
    expect(onTick.mock.calls[0][0]).toBeCloseTo(4000, 100);

    jest.advanceTimersByTime(1000);
    expect(onTick.mock.calls[1][0]).toBeCloseTo(3000, 100);

    jest.advanceTimersByTime(1000);
    expect(onTick.mock.calls[2][0]).toBeCloseTo(2000, 100);
  });

  test("ticks stop after cancellation", () => {
    const onExpiry = mock(() => {});
    const onTick = mock(() => {});
    const durationMs = 10000;

    scheduleTurnExpiry("room1", durationMs, onExpiry);
    startTurnTicks("room1", onTick);

    jest.advanceTimersByTime(1000);
    expect(onTick).toHaveBeenCalledTimes(1);

    // Cancel all timers
    cancelTurnTimers("room1");

    // Advance time further
    jest.advanceTimersByTime(2000);

    // No new ticks should have fired
    expect(onTick).toHaveBeenCalledTimes(1);
    expect(onExpiry).not.toHaveBeenCalled();
  });

  test("ticks stop when time reaches zero", () => {
    const onExpiry = mock(() => {});
    const onTick = mock(() => {});
    const durationMs = 3000;

    scheduleTurnExpiry("room1", durationMs, onExpiry);
    startTurnTicks("room1", onTick);

    jest.advanceTimersByTime(1000);
    expect(onTick).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(1000);
    expect(onTick).toHaveBeenCalledTimes(2);

    jest.advanceTimersByTime(1000);
    expect(onTick).toHaveBeenCalledTimes(3);
    expect(onTick.mock.calls[2][0]).toBe(0);

    // Expiry should have fired and ticks should stop
    expect(onExpiry).toHaveBeenCalledTimes(1);

    // Advance more time; no new ticks
    jest.advanceTimersByTime(1000);
    expect(onTick).toHaveBeenCalledTimes(3);
  });

  test("startTurnTicks is idempotent", () => {
    const onExpiry = mock(() => {});
    const onTick = mock(() => {});
    const durationMs = 10000;

    scheduleTurnExpiry("room1", durationMs, onExpiry);
    startTurnTicks("room1", onTick);
    const timers1 = getTimersForRoom("room1");

    // Try to start ticks again
    startTurnTicks("room1", onTick);
    const timers2 = getTimersForRoom("room1");

    // Should be the same interval (no new one created)
    expect(timers1!.tickIntervalId).toBe(timers2!.tickIntervalId);

    // Only one tick per second
    jest.advanceTimersByTime(1000);
    expect(onTick).toHaveBeenCalledTimes(1);
  });

  test("multiple rooms can have independent timers", () => {
    const onExpiry1 = mock(() => {});
    const onExpiry2 = mock(() => {});

    scheduleTurnExpiry("room1", 5000, onExpiry1);
    scheduleTurnExpiry("room2", 3000, onExpiry2);

    jest.advanceTimersByTime(3001);
    expect(onExpiry1).not.toHaveBeenCalled();
    expect(onExpiry2).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(2000);
    expect(onExpiry1).toHaveBeenCalledTimes(1);
    expect(onExpiry2).toHaveBeenCalledTimes(1);
  });

  test("clearAllTimers cleans up all rooms", () => {
    const onExpiry1 = mock(() => {});
    const onExpiry2 = mock(() => {});

    scheduleTurnExpiry("room1", 5000, onExpiry1);
    scheduleTurnExpiry("room2", 3000, onExpiry2);

    expect(getTimersForRoom("room1")).toBeDefined();
    expect(getTimersForRoom("room2")).toBeDefined();

    clearAllTimers();

    expect(getTimersForRoom("room1")).toBeUndefined();
    expect(getTimersForRoom("room2")).toBeUndefined();

    // Advance time; no callbacks should fire
    jest.advanceTimersByTime(5001);
    expect(onExpiry1).not.toHaveBeenCalled();
    expect(onExpiry2).not.toHaveBeenCalled();
  });

  test("timers record is populated and cleared correctly", () => {
    const onExpiry = mock(() => {});

    expect(getTimersForRoom("room1")).toBeUndefined();

    const timers = scheduleTurnExpiry("room1", 5000, onExpiry);
    expect(timers.expiryTimeoutId).not.toBeNull();
    expect(timers.tickIntervalId).toBeNull();
    expect(timers.durationMs).toBe(5000);
    expect(getTimersForRoom("room1")).toBeDefined();

    startTurnTicks("room1", () => {});
    const tickTimers = getTimersForRoom("room1");
    expect(tickTimers!.tickIntervalId).not.toBeNull();

    cancelTurnTimers("room1");
    expect(getTimersForRoom("room1")).toBeUndefined();
  });
});
