import { describe, expect, test } from "bun:test";
import { PROTOCOL_VERSION, PRODUCT_NAME, banner } from "./index";

describe("shared bootstrap", () => {
  test("exposes a protocol version", () => {
    expect(PROTOCOL_VERSION).toBe("0.1.0");
  });

  test("banner combines product name and protocol version", () => {
    expect(banner()).toBe(`${PRODUCT_NAME} relay protocol v${PROTOCOL_VERSION}`);
  });
});
