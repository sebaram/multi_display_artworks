import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Link, MemoryRouter, useNavigate } from "react-router-dom";
import { SessionContext } from "../../src/app/context";
import type { ResourceSpec } from "../../src/api/types";

const mocks = vi.hoisted(() => ({ api: vi.fn(), write: vi.fn() }));
vi.mock("../../src/api/client", () => ({ api: mocks.api, write: mocks.write }));
import Admin from "../../src/features/admin/Admin";

const resources: ResourceSpec[] = ["rooms", "images"].map((name) => ({
  name,
  label: name,
  fields: [
    {
      name: "name",
      label: "Name",
      type: "string",
      required: true,
      readonly: false,
    },
    {
      name: "description",
      label: "Description",
      type: "text",
      required: false,
      readonly: false,
      default: "Default description",
    },
  ],
}));
const saved = {
  id: "saved-room",
  name: "Saved room",
  description: "Saved description",
};
const session = { authenticated: true, is_admin: true };

function Back() {
  const navigate = useNavigate();
  return <button onClick={() => navigate(-1)}>Back</button>;
}

function mount(
  path: string,
  schema: Promise<{ resources: ResourceSpec[] }> = Promise.resolve({
    resources,
  }),
) {
  mocks.api.mockImplementation(async (url: string) => {
    if (url === "/api/v1/admin/schema") return schema;
    if (url === "/api/v1/admin/rooms/saved-room") return saved;
    if (url.startsWith("/api/v1/admin/rooms?"))
      return { items: [saved], total: 1 };
    if (url.startsWith("/api/v1/admin/images?")) return { items: [], total: 0 };
    throw new Error(`Unexpected API read: ${url}`);
  });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SessionContext.Provider value={{ session, reload: async () => {} }}>
        <Link to="/kwanri/room/new/">New room route</Link>
        <Back />
        <Admin />
      </SessionContext.Provider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("opens a legacy new route after its schema arrives and preserves the saved draft during list refresh", async () => {
  let resolve!: (value: { resources: ResourceSpec[] }) => void;
  const schema = new Promise<{ resources: ResourceSpec[] }>((done) => {
    resolve = done;
  });
  mount("/kwanri/room/new/", schema);
  expect(screen.queryByRole("heading", { name: "새 항목" })).toBeNull();
  await act(async () => resolve({ resources }));
  await screen.findByRole("heading", { name: "새 항목" });
  expect(screen.getByLabelText("Description")).toHaveValue(
    "Default description",
  );
  fireEvent.change(screen.getByLabelText("Name", { exact: false }), {
    target: { value: "My draft" },
  });
  expect(screen.getByLabelText("Name", { exact: false })).toHaveValue(
    "My draft",
  );
  mocks.write.mockResolvedValue({ ...saved, name: "My draft" });
  fireEvent.submit(
    screen.getByRole("button", { name: "변경 사항 저장" }).closest("form")!,
  );
  await screen.findByText("저장했습니다.");
  await waitFor(() =>
    expect(
      screen.getByRole("heading", { name: "항목 편집" }),
    ).toBeInTheDocument(),
  );
  expect(screen.getByLabelText("Name", { exact: false })).toHaveValue(
    "My draft",
  );
  expect(mocks.write).toHaveBeenCalledWith("/api/v1/admin/rooms", "POST", {
    name: "My draft",
    description: "Default description",
  });
});

it("keeps a closed create inspector closed and can open it on a fresh new-route navigation", async () => {
  mount("/kwanri/room/new/");
  await screen.findByRole("heading", { name: "새 항목" });
  fireEvent.click(screen.getByRole("button", { name: "편집 닫기" }));
  expect(screen.queryByLabelText("Name", { exact: false })).toBeNull();
  fireEvent.click(screen.getByRole("link", { name: "New room route" }));
  await screen.findByRole("heading", { name: "새 항목" });
});

it("preserves edit-id precedence and ordinary resource navigation from a new route", async () => {
  mount("/kwanri/room/new/?id=saved-room");
  await screen.findByRole("heading", { name: "항목 편집" });
  expect(screen.getByLabelText("Name", { exact: false })).toHaveValue(
    "Saved room",
  );
  fireEvent.click(screen.getByRole("link", { name: /images/ }));
  await screen.findByRole("heading", { name: "images" });
  expect(screen.queryByLabelText("Name", { exact: false })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "+ 새로 만들기" }));
  await screen.findByRole("heading", { name: "새 항목" });
  expect(screen.getByLabelText("Name", { exact: false })).toHaveValue("");
});

it("opens a new draft when history returns from another resource to its create route", async () => {
  mount("/kwanri/room/new/");
  await screen.findByRole("heading", { name: "새 항목" });
  fireEvent.click(screen.getByRole("link", { name: /images/ }));
  await screen.findByRole("heading", { name: "images" });
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  await screen.findByRole("heading", { name: "새 항목" });
  expect(screen.getByLabelText("Name", { exact: false })).toHaveValue("");
});
