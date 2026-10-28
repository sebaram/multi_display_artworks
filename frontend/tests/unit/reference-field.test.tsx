import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
const api = vi.hoisted(() => vi.fn());
vi.mock("../../src/api/client", () => ({ api }));
import { Field } from "../../src/features/admin/Fields";
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("resolves a selected reference beyond page one and incrementally loads additional choices", async () => {
  api.mockImplementation(async (path: string) => {
    if (path.endsWith("/201")) return { id: "201", name: "Selected 201" };
    if (path.includes("offset=200"))
      return {
        items: [
          { id: "201", name: "Selected 201" },
          { id: "202", name: "Additional 202" },
        ],
        total: 202,
      };
    return {
      items: Array.from({ length: 200 }, (_, index) => ({
        id: String(index + 1),
        name: `Choice ${index + 1}`,
      })),
      total: 202,
    };
  });
  const change = vi.fn();
  render(
    <Field
      field={{
        name: "wall",
        label: "대상 월",
        type: "reference",
        reference: "walls",
        required: true,
        readonly: false,
      }}
      value="201"
      change={change}
      editing
    />,
  );
  await screen.findByRole("option", { name: "Selected 201" });
  expect(screen.getByLabelText("대상 월", { exact: false })).toHaveValue("201");
  expect(api).toHaveBeenCalledWith("/api/v1/admin/walls/201");
  fireEvent.click(screen.getByRole("button", { name: /선택지 더 불러오기/ }));
  await screen.findByRole("option", { name: "Additional 202" });
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: /선택지 더 불러오기/ }),
    ).toBeNull(),
  );
  fireEvent.change(screen.getByLabelText("대상 월", { exact: false }), {
    target: { value: "202" },
  });
  expect(change).toHaveBeenCalledWith("202");
  expect(api).toHaveBeenCalledTimes(3);
});
