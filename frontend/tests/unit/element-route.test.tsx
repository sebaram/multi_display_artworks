import { afterEach, expect, it, vi } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import type { Root } from "react-dom/client";

const roots = vi.hoisted(() => [] as Root[]);
vi.mock("react-dom/client", async (original) => {
  const client = await original<typeof import("react-dom/client")>();
  return {
    ...client,
    createRoot(...args: Parameters<typeof client.createRoot>) {
      const root = client.createRoot(...args);
      roots.push(root);
      return root;
    },
  };
});

afterEach(async () => {
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  document.body.innerHTML = "";
  document.head
    .querySelectorAll('script[src^="/vendor/"]')
    .forEach((node) => node.remove());
  vi.unstubAllGlobals();
});

it("opens an image element as a plain display without requesting its wall or room runtime", async () => {
  const requests: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      requests.push(input);
      if (input === "/api/v1/auth/session") {
        return new Response(
          JSON.stringify({ authenticated: false, is_admin: false }),
        );
      }
      if (input === "/api/v1/elements/image/art") {
        return new Response(
          JSON.stringify({
            id: "art",
            wall: "w",
            wall_element_type: "image",
            name: "Blue sky",
            description: "",
            image_url: "/static/sky.png",
            width: 2,
            height: 1,
          }),
        );
      }
      throw Error(`Unexpected request: ${input}`);
    }),
  );
  window.history.replaceState(
    {},
    "",
    "/element?wall_element_id=art&type=image",
  );
  document.body.innerHTML = '<div id="root"></div>';
  await act(async () => {
    await import("../../src/app/main");
  });

  await waitFor(
    () =>
      expect(screen.getByRole("img", { name: "Blue sky" })).toHaveAttribute(
        "src",
        "http://localhost:3000/static/sky.png",
      ),
    { timeout: 5000 },
  );
  expect(new Set(requests)).toEqual(
    new Set(["/api/v1/auth/session", "/api/v1/elements/image/art"]),
  );
  expect(
    document.querySelector("a-scene, canvas, .room-hud, .profile-panel"),
  ).toBeNull();
  expect(document.head.querySelector('script[src^="/vendor/"]')).toBeNull();
});
