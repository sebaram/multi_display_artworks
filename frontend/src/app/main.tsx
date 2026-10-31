import React, { useEffect, useRef, useState, lazy, Suspense } from "react";
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
const ElementEntry = lazy(() => import("../features/element/ElementEntry"));
const Tools = lazy(() => import("../features/room/Tools"));
const ARCompanion = lazy(() => import("../features/room/ARCompanion"));
const GestureTool = lazy(() => import("../features/room/GestureTool"));
const WallEditor = lazy(() => import("../features/wall-editor/WallEditor"));
const Streams = lazy(() => import("../features/admin/Streams"));
const GazeLab = lazy(() => import("../features/avatar/GazeLab"));
import "./styles.css";
import { useI18n, translate as t } from "./i18n";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { displayError } from "./error-message";
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
  useI18n();
  const location = useLocation();
  const { session } = useSession();
  const room = ["/room", "/wall", "/element"].includes(location.pathname);
  return (
    <>
      <a className="skip-link" href="#main-content" tabIndex={0}>
        {t("본문으로 건너뛰기", "Skip to content")}
      </a>
      {!room && (
        <header className="site-header">
          <Link
            className="wordmark"
            to="/"
            aria-label={t("Meta Museum 홈", "Meta Museum home")}
          >
            <span className="brand-mark">M</span>META MUSEUM
          </Link>
          <nav aria-label={t("주 메뉴", "Main navigation")}>
            <Link to="/">{t("전시", "Exhibitions")}</Link>
            <Link to="/tools">{t("도구", "Tools")}</Link>
            {session.is_admin && (
              <Link to="/kwanri">{t("스튜디오", "Studio")}</Link>
            )}
            <Link
              className="nav-account"
              to={session.authenticated ? "/logout" : "/signin"}
            >
              {session.authenticated
                ? t("로그아웃", "Sign out")
                : t("로그인", "Sign in")}{" "}
              ↗
            </Link>
            <LanguageSwitcher />
          </nav>
        </header>
      )}
      <div id="main-content" tabIndex={-1}>
        <Suspense
          fallback={
            <div className="loading" role="status">
              {t("화면을 불러오는 중…", "Loading page…")}
            </div>
          }
        >
          <Routes>
            <Route path="/" element={<Gallery />} />
            <Route path="/room" element={<Room />} />
            <Route path="/wall" element={<Room mode="wall" />} />
            <Route path="/element" element={<ElementEntry />} />
            <Route path="/signin" element={<SignIn />} />
            <Route path="/logout" element={<Logout />} />
            <Route path="/kwanri/*" element={<Admin />} />
            <Route path="/tools" element={<Tools />} />
            <Route path="/tools/streams" element={<Streams />} />
            <Route path="/tools/gaze-lab" element={<GazeLab />} />
            <Route path="/tools/gaussian-avatar" element={<GazeLab native />} />
            <Route path="/ar-companion" element={<ARCompanion />} />
            <Route path="/gesture-mark/*" element={<GestureTool />} />
            <Route path="/wall-editor" element={<WallEditorEntry />} />
            <Route
              path="/register"
              element={
                <main className="page">
                  <h1>{t("신규 가입 안내", "Create an account")}</h1>
                  <p>
                    {t(
                      "현재 신규 가입은 운영자를 통해서만 가능합니다.",
                      "Contact the administrator to create an account.",
                    )}
                  </p>
                  <Link to="/signin">{t("로그인", "Sign in")}</Link>
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
                  <h1>{t("페이지를 찾을 수 없습니다.", "Page not found.")}</h1>
                  <Link to="/">
                    {t("전시 목록으로", "Back to exhibitions")}
                  </Link>
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
  useI18n();
  const { reload } = useSession();
  const nav = useNavigate();
  const [error, setError] = useState("");
  const request = useRef<Promise<void> | null>(null);
  useEffect(() => {
    let live = true;
    // Replayed effects must share the request that rotates the CSRF cookie.
    const signout = (request.current ??= write("/api/v1/auth/signout", "POST")
      .then(refreshCsrf)
      .then(reload));
    void signout
      .then(() => {
        if (live) nav("/");
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, []);
  return (
    <main className="page">
      <p role="status">
        {error ? displayError(error) : t("로그아웃 중…", "Signing out…")}
      </p>
    </main>
  );
}
function WallEditorEntry() {
  useI18n();
  const { session } = useSession();
  const [params] = useSearchParams();
  if (!session.authenticated)
    return (
      <main className="page">
        <h1>{t("월 디자인 스튜디오", "Wall design studio")}</h1>
        <Link
          className="button primary"
          to={`/signin?next=${encodeURIComponent(location.pathname + location.search)}`}
        >
          {t("관리자 로그인", "Administrator sign in")}
        </Link>
      </main>
    );
  if (session.is_admin)
    return <WallEditor wallId={params.get("wall_id") || undefined} />;
  return (
    <main className="page">
      <h1>{t("월 디자인 스튜디오", "Wall design studio")}</h1>
      <p>
        {t(
          "관리자 계정으로 로그인해야 월을 편집할 수 있습니다.",
          "Sign in with an administrator account to edit walls.",
        )}
      </p>
      <Link to="/">{t("전시로 돌아가기", "Back to exhibitions")}</Link>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
