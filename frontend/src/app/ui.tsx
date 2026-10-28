import { useEffect, useState } from "react";
import { api } from "../api/client";
export function useApi<T>(path: string | undefined) {
  const [state, set] = useState<{ data?: T; error?: string; loading: boolean }>(
    { loading: true },
  );
  const [revision, refresh] = useState(0);
  useEffect(() => {
    if (!path) return;
    let live = true;
    set({ loading: true });
    api<T>(path)
      .then((data) => {
        if (live) set({ data, loading: false });
      })
      .catch((error) => {
        if (live) set({ error: error.message, loading: false });
      });
    return () => {
      live = false;
    };
  }, [path, revision]);
  return { ...state, refresh: () => refresh((n) => n + 1) };
}
export function Status({
  error,
  loading,
}: {
  error?: string;
  loading?: boolean;
}) {
  return error ? (
    <div role="alert" className="notice error">
      {error}
    </div>
  ) : loading ? (
    <div role="status" className="loading">
      불러오는 중…
    </div>
  ) : null;
}
export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty">{children}</div>;
}
