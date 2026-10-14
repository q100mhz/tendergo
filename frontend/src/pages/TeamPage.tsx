import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useOutletContext } from "react-router";
import { api, ROLE_LABELS, type Me, type Members, type Role } from "../api";

export function TeamPage({ createOnly = false }: { createOnly?: boolean }) {
  if (createOnly) return <CreateOrg />;
  return <Team />;
}

function Team() {
  const me = useOutletContext<Me>();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data } = useQuery({ queryKey: ["members"], queryFn: () => api<Members>("/orgs/current/members") });
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [error, setError] = useState<string | null>(null);
  const [lastLink, setLastLink] = useState<string | null>(null);
  const [orgName, setOrgName] = useState(me.org?.name ?? "");

  const canManage = data && data.myRole !== "member";
  const refresh = () => qc.invalidateQueries({ queryKey: ["members"] });

  const invite = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const r = await api<{ link: string }>("/orgs/current/invitations", { method: "POST", body: { email, role } });
      setLastLink(r.link);
      setEmail("");
      refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const leave = async () => {
    if (!data || !confirm("Покинуть организацию?")) return;
    await act(() => api(`/orgs/current/members/${data.myUserId}`, { method: "DELETE" }));
    qc.clear();
    navigate("/");
  };
  const rename = (e: FormEvent) => {
    e.preventDefault();
    act(async () => {
      await api("/orgs/current", { method: "PATCH", body: { name: orgName } });
      qc.invalidateQueries({ queryKey: ["me"] });
    });
  };

  return (
    <div className="narrow-page">
      <h1>Команда</h1>
      {canManage && (
        <form className="card row" onSubmit={rename}>
          <label className="grow">
            Название организации
            <input value={orgName} onChange={(e) => setOrgName(e.target.value)} required minLength={2} />
          </label>
          <button className="btn" disabled={orgName === me.org?.name}>
            Сохранить
          </button>
        </form>
      )}

      <div className="card">
        <h3>Сотрудники</h3>
        <table className="simple">
          <tbody>
            {data?.members.map((m) => (
              <tr key={m.userId}>
                <td>
                  {m.name} {m.userId === data.myUserId && <span className="muted">(вы)</span>}
                  <div className="muted small">{m.email}</div>
                </td>
                <td>
                  {data.myRole === "owner" && m.role !== "owner" ? (
                    <select
                      value={m.role}
                      onChange={(e) =>
                        act(() => api(`/orgs/current/members/${m.userId}`, { method: "PATCH", body: { role: e.target.value } }))
                      }
                    >
                      <option value="admin">{ROLE_LABELS.admin}</option>
                      <option value="member">{ROLE_LABELS.member}</option>
                    </select>
                  ) : (
                    ROLE_LABELS[m.role]
                  )}
                </td>
                <td className="right">
                  {m.role !== "owner" &&
                    m.userId !== data.myUserId &&
                    (data.myRole === "owner" || (data.myRole === "admin" && m.role === "member")) && (
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() =>
                          confirm(`Удалить ${m.name} из организации?`) &&
                          act(() => api(`/orgs/current/members/${m.userId}`, { method: "DELETE" }))
                        }
                      >
                        Удалить
                      </button>
                    )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && data.myRole !== "owner" && (
          <button className="btn btn-ghost btn-sm" onClick={leave}>
            Покинуть организацию
          </button>
        )}
      </div>

      {canManage && (
        <div className="card">
          <h3>Пригласить сотрудника</h3>
          <form className="row" onSubmit={invite}>
            <input
              className="grow"
              type="email"
              required
              placeholder="email сотрудника"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
              <option value="member">{ROLE_LABELS.member}</option>
              <option value="admin">{ROLE_LABELS.admin}</option>
            </select>
            <button className="btn btn-primary">Пригласить</button>
          </form>
          <p className="muted small">
            Отправьте сотруднику ссылку-приглашение любым удобным способом. По ней он зарегистрируется (или войдёт, если
            аккаунт уже есть) с указанным email и попадёт в ваше пространство. Без ссылки вступить нельзя.
          </p>
          {lastLink && <CopyLink link={lastLink} />}
          {data && data.invitations.length > 0 && (
            <>
              <h4>Ожидают регистрации</h4>
              <table className="simple">
                <tbody>
                  {data.invitations.map((i) => (
                    <tr key={i.id}>
                      <td>{i.email}</td>
                      <td>{ROLE_LABELS[i.role]}</td>
                      <td className="right nowrap">
                        <button className="btn btn-ghost btn-sm" onClick={() => navigator.clipboard.writeText(i.link)}>
                          Копировать ссылку
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => act(() => api(`/orgs/current/invitations/${i.id}`, { method: "DELETE" }))}
                        >
                          Отозвать
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}
      {error && <p className="error">{error}</p>}

      <div className="card">
        <h3>Другое рабочее пространство</h3>
        <p className="muted small">
          Можно создать отдельную организацию со своими ключами и командой. Переключаться между ними — в шапке сайта.
        </p>
        <CreateOrg />
      </div>
    </div>
  );
}

function CopyLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="row copy-link">
      <input readOnly value={link} className="grow" onFocus={(e) => e.target.select()} />
      <button
        className="btn btn-sm"
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(link);
          setCopied(true);
        }}
      >
        {copied ? "Скопировано" : "Копировать"}
      </button>
    </div>
  );
}

function CreateOrg() {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api("/orgs", { method: "POST", body: { name } });
      qc.clear();
      navigate("/keys");
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <form className="row" onSubmit={submit}>
      <input className="grow" required minLength={2} placeholder="Название организации" value={name} onChange={(e) => setName(e.target.value)} />
      <button className="btn">Создать</button>
      {error && <span className="error">{error}</span>}
    </form>
  );
}
