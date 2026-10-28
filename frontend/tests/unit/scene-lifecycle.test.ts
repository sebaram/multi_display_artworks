import { it, expect, vi } from "vitest";
import { createLifetime } from "../../src/scene/lifetime";
it("disposes resources exactly once across StrictMode cycles", () => {
  const first = createLifetime(),
    second = createLifetime(),
    a = vi.fn(),
    b = vi.fn();
  first.add(a);
  first.dispose();
  first.dispose();
  second.add(b);
  expect(a).toHaveBeenCalledTimes(1);
  expect(b).not.toHaveBeenCalled();
  second.dispose();
  expect(b).toHaveBeenCalledTimes(1);
});
