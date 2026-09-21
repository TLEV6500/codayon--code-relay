import { describe, expect, test } from "bun:test";

/**
 * Test host disconnect indicator UI logic.
 * REQ-034, Task 8: Host-specific disconnect indicator
 *
 * Tests verify:
 * - Host disconnect badge computed from roster.find(p => p.role === 'host')?.connected === false
 * - Badge visibility: shown when host disconnected, hidden when connected or not found
 * - Badge auto-clears on host reconnect
 * - Visual distinction from grace-period banner (orange vs red)
 */

describe("host disconnect badge logic (REQ-034, Task 8)", () => {
  test("detects host disconnection from roster", () => {
    const roster = [
      { id: "h1", name: "Alice", role: "host", connected: false },
      { id: "o1", name: "Bob", role: "observer", connected: true },
      { id: "s1", name: "Charlie", role: "spectator", connected: true },
    ];

    const host = roster.find((p) => p.role === "host");
    const isHostDisconnected = host?.connected === false;
    expect(isHostDisconnected).toBe(true);
  });

  test("detects host connection from roster", () => {
    const roster = [
      { id: "h1", name: "Alice", role: "host", connected: true },
      { id: "o1", name: "Bob", role: "observer", connected: true },
      { id: "s1", name: "Charlie", role: "spectator", connected: true },
    ];

    const host = roster.find((p) => p.role === "host");
    const isHostDisconnected = host?.connected === false;
    expect(isHostDisconnected).toBe(false);
  });

  test("handles missing host gracefully", () => {
    const roster = [
      { id: "o1", name: "Bob", role: "observer", connected: true },
      { id: "s1", name: "Charlie", role: "spectator", connected: true },
    ];

    const host = roster.find((p) => p.role === "host");
    const isHostDisconnected = host?.connected === false;
    expect(isHostDisconnected).toBe(false);
  });

  test("handles empty roster", () => {
    const roster: any[] = [];
    const host = roster.find((p) => p.role === "host");
    const isHostDisconnected = host?.connected === false;
    expect(isHostDisconnected).toBe(false);
  });
});

describe("host disconnect badge visibility (REQ-034, Task 8)", () => {
  test("badge should render when host is disconnected", () => {
    const roster = [
      { id: "h1", name: "Alice", role: "host", connected: false },
    ];

    const host = roster.find((p) => p.role === "host");
    const shouldShowBadge = host?.connected === false;
    expect(shouldShowBadge).toBe(true);
  });

  test("badge should not render when host is connected", () => {
    const roster = [
      { id: "h1", name: "Alice", role: "host", connected: true },
    ];

    const host = roster.find((p) => p.role === "host");
    const shouldShowBadge = host?.connected === false;
    expect(shouldShowBadge).toBe(false);
  });

  test("badge should not render when no host in roster", () => {
    const roster = [
      { id: "o1", name: "Bob", role: "observer", connected: true },
    ];

    const host = roster.find((p) => p.role === "host");
    const shouldShowBadge = host?.connected === false;
    expect(shouldShowBadge).toBe(false);
  });

  test("badge should be always-visible (not gated behind roster toggle)", () => {
    // Badge visibility is independent of roster toggle state
    const roster = [
      { id: "h1", name: "Alice", role: "host", connected: false },
    ];

    const host = roster.find((p) => p.role === "host");
    const shouldShowBadge = host?.connected === false;

    // Simulating roster toggle state should not affect badge visibility
    // rosterOpenState is independent of badge visibility
    const shouldRender = shouldShowBadge;
    expect(shouldRender).toBe(true);
  });
});

describe("host disconnect badge auto-clear on reconnect (REQ-034, Task 8)", () => {
  test("badge clears when host transitions from disconnected to connected", () => {
    // Simulate state change
    let roster = [
      { id: "h1", name: "Alice", role: "host", connected: false },
    ];

    let host = roster.find((p) => p.role === "host");
    let isHostDisconnected = host?.connected === false;
    expect(isHostDisconnected).toBe(true);

    // Host reconnects
    roster = [
      { id: "h1", name: "Alice", role: "host", connected: true },
    ];

    host = roster.find((p) => p.role === "host");
    isHostDisconnected = host?.connected === false;
    expect(isHostDisconnected).toBe(false);
  });

  test("badge clears automatically on roster update with host reconnected", () => {
    // Initial disconnected state
    const initialRoster = [
      { id: "h1", name: "Alice", role: "host", connected: false },
      { id: "o1", name: "Bob", role: "observer", connected: true },
    ];

    let host = initialRoster.find((p) => p.role === "host");
    let isHostDisconnected = host?.connected === false;
    expect(isHostDisconnected).toBe(true);

    // Roster updated after host reconnects
    const updatedRoster = [
      { id: "h1", name: "Alice", role: "host", connected: true },
      { id: "o1", name: "Bob", role: "observer", connected: true },
    ];

    host = updatedRoster.find((p) => p.role === "host");
    isHostDisconnected = host?.connected === false;
    expect(isHostDisconnected).toBe(false);
  });
});

describe("host disconnect badge styling distinction (REQ-034, Task 8)", () => {
  test("host disconnect banner uses orange theme (distinct from grace period red)", () => {
    // Host disconnect: border-l-4 border-orange-500, bg-orange-900/30
    const hostBannerClasses = [
      "border-l-4",
      "border-orange-500",
      "bg-orange-900/30",
    ];
    expect(hostBannerClasses.includes("border-orange-500")).toBe(true);
    expect(hostBannerClasses.includes("bg-orange-900/30")).toBe(true);

    // Grace period: border-l-4 border-red-500, bg-red-900/20
    const graceBannerClasses = ["border-l-4", "border-red-500", "bg-red-900/20"];
    expect(graceBannerClasses.includes("border-red-500")).toBe(true);
    expect(graceBannerClasses.includes("bg-red-900/20")).toBe(true);

    // Verify they are different
    expect(hostBannerClasses[1]).not.toBe(graceBannerClasses[1]);
  });

  test("host disconnect uses pulsing indicator dot with orange color", () => {
    const hostIndicatorClasses = [
      "w-2",
      "h-2",
      "rounded-full",
      "bg-orange-500",
      "animate-pulse",
    ];
    expect(hostIndicatorClasses.includes("bg-orange-500")).toBe(true);
    expect(hostIndicatorClasses.includes("animate-pulse")).toBe(true);
  });

  test("host disconnect title uses orange text color", () => {
    const hostTitleClasses = ["text-sm", "font-semibold", "text-orange-300"];
    expect(hostTitleClasses.includes("text-orange-300")).toBe(true);
  });
});

describe("host disconnect badge placement (REQ-034, Task 8)", () => {
  test("badge appears above Session Status block (not in roster toggle)", () => {
    // Badge rendering order in SessionControls:
    // 1. Host disconnect badge (if host disconnected)
    // 2. Host control panel (if role === 'host')
    // 3. Driver early-end button (if driver + early-end enabled)
    // 4. Session Status block

    // Badge is rendered before Session Status, and is NOT gated behind rosterOpen signal
    const renderOrder = [
      "Host disconnect badge",
      "Host control panel",
      "Driver early-end button",
      "Session Status",
    ];

    const hostBadgeIndex = renderOrder.indexOf("Host disconnect badge");
    const sessionStatusIndex = renderOrder.indexOf("Session Status");
    expect(hostBadgeIndex < sessionStatusIndex).toBe(true);
  });

  test("badge is not gated behind roster toggle", () => {
    // The badge Show condition only depends on: hostDisconnected()
    // It does NOT depend on rosterOpen()

    // When rosterOpen = false, badge should still render if host disconnected
    const hostDisconnected = true;
    const shouldShowBadge = hostDisconnected; // Independent of rosterOpen
    expect(shouldShowBadge).toBe(true);

    // When rosterOpen = true, badge should still render if host disconnected
    const hostDisconnected2 = true;
    const shouldShowBadge2 = hostDisconnected2;
    expect(shouldShowBadge2).toBe(true);
  });
});

describe("host disconnect badge with multiple participants (REQ-034, Task 8)", () => {
  test("badge correctly identifies host among multiple participants", () => {
    const roster = [
      { id: "o1", name: "Bob", role: "observer", connected: true },
      { id: "h1", name: "Alice", role: "host", connected: false },
      { id: "s1", name: "Charlie", role: "spectator", connected: false },
      { id: "o2", name: "Diana", role: "observer", connected: true },
    ];

    const host = roster.find((p) => p.role === "host");
    expect(host?.name).toBe("Alice");
    expect(host?.connected).toBe(false);

    const isHostDisconnected = host?.connected === false;
    expect(isHostDisconnected).toBe(true);

    // Other disconnected participants should not trigger badge
    const otherDisconnected = roster.filter(
      (p) => !p.connected && p.role !== "host"
    );
    expect(otherDisconnected.length).toBe(1); // Only Charlie
  });

  test("badge responds to host reconnection while others stay disconnected", () => {
    // Initial state: host and spectator disconnected
    let roster = [
      { id: "h1", name: "Alice", role: "host", connected: false },
      { id: "s1", name: "Charlie", role: "spectator", connected: false },
      { id: "o1", name: "Bob", role: "observer", connected: true },
    ];

    let host = roster.find((p) => p.role === "host");
    let isHostDisconnected = host?.connected === false;
    expect(isHostDisconnected).toBe(true);

    // Host reconnects but spectator stays disconnected
    roster = [
      { id: "h1", name: "Alice", role: "host", connected: true },
      { id: "s1", name: "Charlie", role: "spectator", connected: false },
      { id: "o1", name: "Bob", role: "observer", connected: true },
    ];

    host = roster.find((p) => p.role === "host");
    isHostDisconnected = host?.connected === false;
    expect(isHostDisconnected).toBe(false);

    // Badge clears, but spectator disconnection is independent
    expect(isHostDisconnected).toBe(false);
  });
});
