import React, { useEffect, useState, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import {
  createBrowserRouter,
  RouterProvider,
  Routes,
  Route,
  Link,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { api, write, refreshCsrf } from "../api/client";
import type { SessionRead } from "../api/types";
import { SessionContext, useSession } from "./context";
import Gallery from "../features/gallery/Gallery";
const Admin = lazy(() => import("../features/admin/Admin"));
const SignIn = lazy(() => import("../features/admin/SignIn"));
const Room = lazy(() => import("../features/room/Room"));
const Tools = lazy(() => import("../features/room/Tools"));
const ARCompanion = lazy(() => import("../features/room/ARCompanion"));
const GestureTool = lazy(() => import("../features/room/GestureTool"));
const WallEditor = lazy(() => import("../features/wall-editor/WallEditor"));
const Streams = lazy(() => import("../features/admin/Streams"));
import "./styles.css";
const router = createBrowserRouter([{ path: "*", element: <Layout /> }]);
function App() {
  const [session, setSession] = useState<SessionRead>({
    authenticated: false,
    is_admin: false,
  });
  async function reload() {
    try {
      setSession(await api("/api/v1/auth/session"));
    } catch {
      setSession({ authenticated: false, is_admin: false });
    }
  }
  useEffect(() => {
    void reload();
  }, []);
  return (
    <SessionContext.Provider value={{ session, reload }}>
      <RouterProvider router={router} />
    </SessionContext.Provider>
  );
}
function Layout() {
  const location = useLocation();
  const { session } = useSession();
  const room = ["/room", "/wall", "/element"].includes(location.pathname);
  return (
    <>
      <a className="skip-link" href="#main-content">
        본문으로 건너뛰기
      </a>
      {!room && (
        <header className="site-header">
          <Link className="wordmark" to="/" aria-label="Meta Museum 홈">
            <span className="brand-mark">M</span>META MUSEUM
          </Link>
          <nav aria-label="주 메뉴">
            <Link to="/">전시</Link>
            <Link to="/tools">도구</Link>
            {session.is_admin && <Link to="/kwanri">스튜디오</Link>}
            <Link
              className="nav-account"
              to={session.authenticated ? "/logout" : "/signin"}
            >
              {session.authenticated ? "로그아웃" : "로그인"} ↗
            </Link>
          </nav>
        </header>
      )}
      <div id="main-content">
        <Suspense
          fallback={
            <div className="loading" role="status">
              화면을 불러오는 중…
            </div>
          }
        >
          <Routes>
            <Route path="/" element={<Gallery />} />
            <Route path="/room" element={<Room />} />
            <Route path="/wall" element={<Room mode="wall" />} />
            <Route path="/element" element={<Room mode="element" />} />
            <Route path="/signin" element={<SignIn />} />
            <Route path="/logout" element={<Logout />} />
            <Route path="/kwanri/*" element={<Admin />} />
            <Route path="/tools" element={<Tools />} />
            <Route path="/tools/streams" element={<Streams />} />
            <Route path="/ar-companion" element={<ARCompanion />} />
            <Route path="/gesture-mark/*" element={<GestureTool />} />
            <Route path="/wall-editor" element={<WallEditorEntry />} />
            <Route
              path="/register"
              element={
                <main className="page">
                  <h1>신규 가입 안내</h1>
                  <p>현재 신규 가입은 운영자를 통해서만 가능합니다.</p>
                  <Link to="/signin">로그인</Link>
                </main>
              }
            />
            <Route
              path="/protected"
              element={session.authenticated ? <Gallery /> : <SignIn />}
            />
            <Route
              path="*"
              element={
                <main className="page">
                  <h1>페이지를 찾을 수 없습니다.</h1>
                  <Link to="/">전시 목록으로</Link>
                </main>
              }
            />
          </Routes>
        </Suspense>
      </div>
    </>
  );
}
function Logout() {
  const { reload } = useSession();
  const nav = useNavigate();
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    void write("/api/v1/auth/signout", "POST")
      .then(refreshCsrf)
      .then(reload)
      .then(() => {
        if (live) nav("/");
      })
      .catch((e) => setError(e.message));
    return () => {
      live = false;
    };
  }, []);
  return (
    <main className="page">
      <p role="status">{error || "로그아웃 중…"}</p>
    </main>
  );
}
function WallEditorEntry() {
  const { session } = useSession();
  const [params] = useSearchParams();
  if (!session.authenticated)
    return (
      <main className="page">
        <h1>월 디자인 스튜디오</h1>
        <Link
          className="button primary"
          to={`/signin?next=${encodeURIComponent(location.pathname + location.search)}`}
        >
          관리자 로그인
        </Link>
      </main>
    );
  if (session.is_admin)
    return <WallEditor wallId={params.get("wall_id") || undefined} />;
  return (
    <main className="page">
      <h1>월 디자인 스튜디오</h1>
      <p>관리자 계정으로 로그인해야 월을 편집할 수 있습니다.</p>
      <Link to="/">전시로 돌아가기</Link>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
