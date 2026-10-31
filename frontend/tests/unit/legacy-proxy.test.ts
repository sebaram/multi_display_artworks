// @vitest-environment node
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ProxyOptions } from "vite";
import { expect, it } from "vitest";
import config from "../../vite.config";

it("proxies wall refresh HEAD requests while keeping gallery GETs in Vite", () => {
  const proxies = config.server?.proxy ?? {};
  const entry = Object.entries(proxies).find(
    ([pattern]) =>
      pattern.startsWith("^") &&
      new RegExp(pattern).test("/wall?wall_id=fixture"),
  );
  expect(entry).toBeDefined();
  const [pattern, options] = entry!;
  const proxy = options as ProxyOptions;
  expect(new RegExp(pattern).test("/wall")).toBe(true);
  expect(new RegExp(pattern).test("/wall-editor?wall_id=fixture")).toBe(false);
  expect(new RegExp(pattern).test("/wall/other")).toBe(false);
  const head = {
    method: "HEAD",
    url: "/wall?wall_id=fixture",
  } as IncomingMessage;
  const get = {
    method: "GET",
    url: "/wall?wall_id=fixture",
  } as IncomingMessage;
  expect(proxy.bypass?.(head, {} as ServerResponse, proxy)).toBeUndefined();
  expect(proxy.bypass?.(get, {} as ServerResponse, proxy)).toBe(
    "/wall?wall_id=fixture",
  );
});
