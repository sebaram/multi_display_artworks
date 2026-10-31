import { Suspense } from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { Link, MemoryRouter } from "react-router-dom";
import ElementEntry from "../../src/features/element/ElementEntry";

const artwork = {
  id: "art",
  wall: "w",
  wall_element_type: "image",
  name: "Blue sky",
  description: "",
  position_x: 0,
  position_y: 0,
  scale_x: 1,
  scale_y: 1,
  scale_z: 1,
  width: 2,
  height: 1,
  image_url: "/static/sky.png",
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });

function open(query = "wall_element_id=art&type=image") {
  return render(
    <MemoryRouter initialEntries={[`/element?${query}`]}>
      <Link to="/element?wall_element_id=next&type=image">Next image</Link>
      <Suspense fallback={<p role="status">Loading viewer</p>}>
        <ElementEntry />
      </Suspense>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("defaults an omitted element type to an image and uses its name as alt text", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => json(artwork)),
  );
  open("wall_element_id=art");
  expect(screen.getByRole("status")).toBeInTheDocument();
  expect(await screen.findByRole("img", { name: "Blue sky" })).toHaveAttribute(
    "src",
    "http://localhost:3000/static/sky.png",
  );
  expect(screen.queryByRole("status")).toBeNull();
});

it.each([
  ["https://media.example/sky.png", "https://media.example/sky.png"],
  ["http://media.example/sky.png", "http://media.example/sky.png"],
  ["static/sky.png", "http://localhost:3000/static/sky.png"],
])(
  "preserves HTTP(S) and relative image sources: %s",
  async (source, expected) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ ...artwork, image_url: source })),
    );
    open();
    expect(
      await screen.findByRole("img", { name: "Blue sky" }),
    ).toHaveAttribute("src", expected);
  },
);

it.each([
  "javascript:alert(1)",
  "data:image/png;base64,YQ==",
  "file:///sky.png",
  "",
])(
  "rejects an unusable image source without installing an image: %s",
  async (image_url) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ ...artwork, image_url })),
    );
    open();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "이미지 주소가 올바르지 않습니다.",
    );
    expect(screen.queryByRole("img")).toBeNull();
  },
);

it("reports a missing element selection without making a request", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  open("type=image");
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "작품을 선택하세요.",
  );
  expect(fetch).not.toHaveBeenCalled();
});

it("surfaces an element API failure", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => json({ detail: "Artwork not found" }, 404)),
  );
  open();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Artwork not found",
  );
  expect(screen.queryByRole("img")).toBeNull();
});

it("reports an image decode or download failure", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => json(artwork)),
  );
  open();
  fireEvent.error(await screen.findByRole("img", { name: "Blue sky" }));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "이미지를 불러오지 못했습니다.",
  );
  expect(screen.queryByRole("img")).toBeNull();
});

it("cancels a pending request on navigation and ignores its late result", async () => {
  let finish!: (response: Response) => void;
  let signal!: AbortSignal;
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string, init: RequestInit) => {
      if (input === "/api/v1/elements/image/art") {
        signal = init.signal as AbortSignal;
        return new Promise<Response>((resolve) => {
          finish = resolve;
        });
      }
      if (input === "/api/v1/elements/image/next")
        return Promise.resolve(
          json({
            ...artwork,
            id: "next",
            name: "Next artwork",
            image_url: "/next.png",
          }),
        );
      throw Error(`Unexpected request: ${input}`);
    }),
  );
  open();
  fireEvent.click(screen.getByRole("link", { name: "Next image" }));
  expect(
    await screen.findByRole("img", { name: "Next artwork" }),
  ).toHaveAttribute("src", "http://localhost:3000/next.png");
  expect(signal.aborted).toBe(true);
  await act(async () => finish(json(artwork)));
  expect(screen.getByRole("img", { name: "Next artwork" })).toBeInTheDocument();
  expect(screen.queryByRole("img", { name: "Blue sky" })).toBeNull();
});

it("cancels a pending image request when its display is unmounted", () => {
  let signal!: AbortSignal;
  vi.stubGlobal(
    "fetch",
    vi.fn((_input: string, init: RequestInit) => {
      signal = init.signal as AbortSignal;
      return new Promise<Response>(() => {});
    }),
  );
  const view = open();
  view.unmount();
  expect(signal.aborted).toBe(true);
});

it.each([
  ["image&display_type=aframe", "image"],
  ["gltf", "gltf"],
  ["webpage", "webpage"],
  ["gaussian_splat", "gaussian_splat"],
])(
  "keeps the room viewer for an explicit scene or non-image type: %s",
  async (query, type) => {
    const requests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        requests.push(input);
        return json({ detail: "Requested scene element" }, 404);
      }),
    );
    open(`wall_element_id=art&type=${query}`);
    expect(
      await screen.findByRole("alert", {}, { timeout: 5000 }),
    ).toHaveTextContent("Requested scene element");
    expect(requests).toContain(`/api/v1/elements/${type}/art`);
    expect(document.querySelector(".room-view")).not.toBeNull();
    expect(document.querySelector(".element-image-view")).toBeNull();
  },
);
