import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { api } from "../api";
import { useMe } from "../useMe";

export function AuthPage({ mode }: { mode: "login" | "register" }) {
  const [params] = useSearchParams();
  const inviteToken = params.get("invite");
  const invite = useQuery({
    queryKey: ["invite", inviteToken],
    queryFn: () => api<{ email: string; orgName: string }>(`/invitations/${inviteToken}`),
    enabled: !!inviteToken,
    retry: false,
  });
  const me = useMe();
  const [form, setForm] = useState({ email: "", password: "", name: "", orgName: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const email = invite.data?.email ?? form.email;
  const isRegister = mode === "register";

  const acceptInvite = async () => {
    await api(`/invitations/${inviteToken}/accept`, { method: "POST" });
    qc.clear();
    navigate("/");
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (isRegister) {
        await api("/auth/register", {
          method: "POST",
          body: {
            email,
            password: form.password,
            name: form.name,
            orgName: inviteToken ? undefined : form.orgName || undefined,
            inviteToken: inviteToken ?? undefined,
          },
        });
      } else {
        await api("/auth/login", { method: "POST", body: { email, password: form.password } });
        if (inviteToken) {
          await qc.invalidateQueries({ queryKey: ["me"] });
          await acceptInvite();
          return;
        }
      }
      qc.clear();
      navigate("/");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    await api("/auth/logout", { method: "POST" });
    setError(null);
    await qc.invalidateQueries({ queryKey: ["me"] });
  };

  if (me.isLoading) return <div className="center muted">Загрузка…</div>;
  if (me.data && !inviteToken) return <Navigate to="/" replace />;

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });
  const suffix = inviteToken ? `?invite=${inviteToken}` : "";

  if (me.data && inviteToken) {
    return (
      <div className="auth">
        <div className="card auth-card">
          <div className="brand auth-brand">
            <span className="brand-mark">T</span>TenderGo
          </div>
          <h1>Приглашение</h1>
          {invite.data && (
            <p>
              Вас пригласили в организацию «{invite.data.orgName}». Вы вошли как <b>{me.data.user.email}</b>.
            </p>
          )}
          {invite.isError && <p className="error">{(invite.error as Error).message}</p>}
          {error && <p className="error">{error}</p>}
          {invite.data && (
            <button
              className="btn btn-primary btn-block"
              onClick={() => acceptInvite().catch((err: Error) => setError(err.message))}
            >
              Принять приглашение
            </button>
          )}
          <button className="btn btn-block" onClick={logout}>
            Войти под другим аккаунтом
          </button>
          <Link className="muted small" to="/">
            Перейти к закупкам
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="auth">
      <form className="card auth-card" onSubmit={submit}>
        <div className="brand auth-brand">
          <span className="brand-mark">T</span>TenderGo
        </div>
        <h1>{isRegister ? "Регистрация" : "Вход"}</h1>
        {invite.data && (
          <p className="notice">
            Приглашение в организацию «{invite.data.orgName}». После {isRegister ? "регистрации" : "входа"} вы попадёте в
            её рабочее пространство.
          </p>
        )}
        {invite.isError && <p className="error">{(invite.error as Error).message}</p>}

        {isRegister && (
          <label>
            Имя
            <input required value={form.name} onChange={set("name")} autoComplete="name" />
          </label>
        )}
        <label>
          Email
          <input
            type="email"
            required
            value={email}
            onChange={set("email")}
            disabled={!!invite.data}
            autoComplete="email"
          />
        </label>
        <label>
          Пароль
          <input
            type="password"
            required
            minLength={isRegister ? 8 : 1}
            value={form.password}
            onChange={set("password")}
            autoComplete={isRegister ? "new-password" : "current-password"}
          />
        </label>
        {isRegister && !inviteToken && (
          <label>
            Название организации
            <input value={form.orgName} onChange={set("orgName")} placeholder="ООО «Ромашка»" />
          </label>
        )}
        {error && <p className="error">{error}</p>}
        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? "…" : isRegister ? "Зарегистрироваться" : "Войти"}
        </button>
        <p className="muted small">
          {isRegister ? (
            <>
              Уже есть аккаунт? <Link to={`/login${suffix}`}>Войти</Link>
            </>
          ) : (
            <>
              Нет аккаунта? <Link to={`/register${suffix}`}>Зарегистрироваться</Link>
            </>
          )}
        </p>
      </form>
    </div>
  );
}
