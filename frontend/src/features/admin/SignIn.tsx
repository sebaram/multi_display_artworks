import { useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { write, refreshCsrf, safeNext } from "../../api/client";
import { useSession } from "../../app/context";
export default function SignIn() {
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
          새로운 전시를
          <br />
          시작하는 곳.
        </h1>
        <p>
          공간과 작품을 관리하고,
          <br />
          관람객과 만나는 경험을 만드세요.
        </p>
      </section>
      <section className="auth-form">
        <div className="eyebrow">WELCOME BACK</div>
        <h2>관리자 로그인</h2>
        <p>등록된 계정으로 스튜디오에 입장하세요.</p>
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
            이메일
            <input
              autoComplete="username"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            비밀번호
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
              {error}
            </p>
          )}
          <button className="primary" disabled={busy}>
            {busy ? "로그인 중…" : "로그인 →"}
          </button>
        </form>
        <p className="muted">신규 가입은 운영자에게 문의하세요.</p>
        <Link to="/">← 전시로 돌아가기</Link>
      </section>
    </main>
  );
}
