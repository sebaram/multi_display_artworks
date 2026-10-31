import { useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { write, refreshCsrf, safeNext } from "../../api/client";
import { useSession } from "../../app/context";
import { useI18n, translate as t } from "../../app/i18n";
import { displayError } from "../../app/error-message";
export default function SignIn() {
  useI18n();
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [params] = useSearchParams();
  const nav = useNavigate();
  const { reload } = useSession();
  return (
    <main className="auth-page">
      <section className="auth-art">
        <div className="eyebrow">META MUSEUM / STUDIO</div>
        <h1>
          {t("새로운 전시를", "A place for")}
          <br />
          {t("시작하는 곳.", "your next exhibition.")}
        </h1>
        <p>
          {t("공간과 작품을 관리하고,", "Manage spaces and artworks,")}
          <br />
          {t(
            "관람객과 만나는 경험을 만드세요.",
            "and create experiences for your visitors.",
          )}
        </p>
      </section>
      <section className="auth-form">
        <div className="eyebrow">WELCOME BACK</div>
        <h2>{t("관리자 로그인", "Administrator sign in")}</h2>
        <p>
          {t(
            "등록된 계정으로 스튜디오에 입장하세요.",
            "Enter the studio with your registered account.",
          )}
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              await write("/api/v1/auth/signin", "POST", {
                email,
                password,
                next: safeNext(params.get("next")),
              });
              setPassword("");
              await refreshCsrf();
              await reload();
              nav(safeNext(params.get("next")));
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            {t("이메일", "Email")}
            <input
              autoComplete="username"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            {t("비밀번호", "Password")}
            <input
              autoComplete="current-password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && (
            <p role="alert" className="error">
              {displayError(error)}
            </p>
          )}
          <button className="primary" disabled={busy}>
            {busy ? t("로그인 중…", "Signing in…") : t("로그인 →", "Sign in →")}
          </button>
        </form>
        <p className="muted">
          {t(
            "신규 가입은 운영자에게 문의하세요.",
            "Contact the administrator for a new account.",
          )}
        </p>
        <Link to="/">{t("← 전시로 돌아가기", "← Back to exhibitions")}</Link>
      </section>
    </main>
  );
}
