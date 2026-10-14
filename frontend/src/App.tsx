import { useQueryClient } from "@tanstack/react-query";
import { Navigate, NavLink, Outlet, Route, Routes, useNavigate } from "react-router";
import { api, ROLE_LABELS } from "./api";
import { AuthPage } from "./pages/AuthPage";
import { KeysPage } from "./pages/KeysPage";
import { TeamPage } from "./pages/TeamPage";
import { TenderPage } from "./pages/TenderPage";
import { TendersPage } from "./pages/TendersPage";
import { useMe } from "./useMe";

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<AuthPage mode="login" />} />
      <Route path="/register" element={<AuthPage mode="register" />} />
      <Route element={<Layout />}>
        <Route index element={<TendersPage />} />
        <Route path="tenders/:id" element={<TenderPage />} />
        <Route path="keys" element={<KeysPage />} />
        <Route path="team" element={<TeamPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function Layout() {
  const { data: me, isLoading, error } = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();

  if (isLoading) return <div className="center muted">Загрузка…</div>;
  if (error) return <div className="center error">Сервер недоступен: {String((error as Error).message)}</div>;
  if (!me) return <Navigate to="/login" replace />;

  const switchOrg = async (orgId: number) => {
    await api("/orgs/switch", { method: "POST", body: { orgId } });
    qc.clear();
    navigate("/");
  };
  const logout = async () => {
    await api("/auth/logout", { method: "POST" });
    qc.clear();
    navigate("/login");
  };
  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <NavLink to="/" className="brand">
            <span className="brand-mark">T</span>TenderGo
          </NavLink>
          <nav className="nav">
            <NavLink to="/" end>
              Закупки
            </NavLink>
            <NavLink to="/keys">Ключи</NavLink>
            <NavLink to="/team">Команда</NavLink>
          </nav>
          <div className="topbar-right">
            {me.orgs.length > 0 && (
              <select
                className="org-select"
                value={me.org?.id ?? ""}
                onChange={(e) => switchOrg(Number(e.target.value))}
                title="Рабочее пространство"
              >
                {me.orgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name} · {ROLE_LABELS[o.role]}
                  </option>
                ))}
              </select>
            )}
            <span className="muted user-name" title={me.user.email}>
              {me.user.name}
            </span>
            <button className="btn btn-ghost" onClick={logout}>
              Выйти
            </button>
          </div>
        </div>
      </header>
      <main className="main">
        {me.org ? <Outlet context={me} /> : <NoOrg />}
      </main>
    </div>
  );
}

function NoOrg() {
  return (
    <div className="card narrow">
      <h2>Нет рабочего пространства</h2>
      <p className="muted">
        Вас удалили из организации. Создайте своё пространство или откройте ссылку-приглашение, которую прислал
        руководитель.
      </p>
      <TeamPage createOnly />
    </div>
  );
}
