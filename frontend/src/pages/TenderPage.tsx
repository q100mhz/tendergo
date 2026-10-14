import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import {
  api,
  daysLeft,
  formatDateTime,
  formatPrice,
  STATUS_LABELS,
  type Members,
  type TenderDetail,
  type TenderStatus,
} from "../api";

export function TenderPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const { data, error, isLoading } = useQuery({
    queryKey: ["tender", id],
    queryFn: () => api<TenderDetail>(`/tenders/${id}`),
  });
  const members = useQuery({ queryKey: ["members"], queryFn: () => api<Members>("/orgs/current/members") });
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => setNote(data?.state.note ?? ""), [data?.state.note]);

  if (isLoading) return <p className="muted">Загрузка…</p>;
  if (error || !data) return <p className="error">{(error as Error)?.message ?? "Не найдено"}</p>;

  const { tender: t, state } = data;
  const left = daysLeft(t.submissionDeadline);

  const save = async (patch: Partial<TenderDetail["state"]>) => {
    await api(`/tenders/${t.id}/state`, { method: "PUT", body: patch });
    await qc.invalidateQueries({ queryKey: ["tender", id] });
    qc.invalidateQueries({ queryKey: ["tenders"] });
  };
  const saveNote = async () => {
    await save({ note: note.trim() || null });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const details = Object.entries(t.details ?? {});

  return (
    <div className="detail">
      <Link to="/" className="muted small back">
        ← К списку закупок
      </Link>
      <div className="detail-head">
        <div className="tender-meta">
          <span className={`law law-${t.law}`}>{t.law}-ФЗ</span>
          <span className="muted">№ {t.regNumber}</span>
          {t.procedureType && <span className="muted">· {t.procedureType}</span>}
          {t.stage && <span className="muted">· {t.stage}</span>}
          {data.matchesKeys && <span className="chip">подходит под ключи</span>}
        </div>
        <h1>{t.title}</h1>
      </div>

      <div className="detail-grid">
        <div className="card">
          <dl className="facts">
            <dt>Начальная цена</dt>
            <dd className="big">{formatPrice(t.maxPrice)}</dd>
            <dt>Окончание приёма заявок</dt>
            <dd>
              {formatDateTime(t.submissionDeadline)}
              {left !== null && left >= 0 && <span className={left <= 2 ? "urgent" : "muted"}> · осталось {left} дн.</span>}
            </dd>
            <dt>Заказчик</dt>
            <dd>
              {t.customerName ?? "—"}
              {t.customerInn && <div className="muted small">ИНН {t.customerInn}</div>}
            </dd>
            <dt>Регион</dt>
            <dd>{t.regionName ?? "—"}</dd>
            <dt>Размещено</dt>
            <dd>{formatDateTime(t.publishedAt)}</dd>
            {t.okpd2Codes.length > 0 && (
              <>
                <dt>ОКПД2</dt>
                <dd className="codes">
                  {t.okpd2Codes.map((c) => (
                    <code key={c}>{c}</code>
                  ))}
                </dd>
              </>
            )}
            {t.ktruCodes.length > 0 && (
              <>
                <dt>КТРУ</dt>
                <dd className="codes">
                  {t.ktruCodes.map((c) => (
                    <code key={c}>{c}</code>
                  ))}
                </dd>
              </>
            )}
          </dl>
          <a className="btn" href={t.url} target="_blank" rel="noreferrer noopener">
            Открыть в ЕИС ↗
          </a>
        </div>

        <div className="card work">
          <h3>Работа с закупкой</h3>
          <label className="check">
            <input type="checkbox" checked={state.favorite} onChange={(e) => save({ favorite: e.target.checked })} />В
            избранном
          </label>
          <label>
            Статус
            <select value={state.status} onChange={(e) => save({ status: e.target.value as TenderStatus })}>
              {Object.entries(STATUS_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label>
            Ответственный
            <select
              value={state.assigneeId ?? ""}
              onChange={(e) => save({ assigneeId: e.target.value ? Number(e.target.value) : null })}
            >
              <option value="">Не назначен</option>
              {members.data?.members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Заметка для команды
            <textarea rows={5} value={note} onChange={(e) => setNote(e.target.value)} maxLength={5000} />
          </label>
          <div className="row">
            <button className="btn btn-primary btn-sm" onClick={saveNote} disabled={note === (state.note ?? "")}>
              Сохранить заметку
            </button>
            {saved && <span className="muted small">Сохранено</span>}
          </div>
          <p className="muted small">Статус, заметки и ответственный видны только вашей организации.</p>
        </div>
      </div>

      {details.length > 0 && (
        <div className="card">
          <h3>Сведения из извещения</h3>
          <dl className="details">
            {details.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          <p className="muted small">Обновлено из ЕИС: {formatDateTime(t.detailsFetchedAt ?? t.updatedAt)}</p>
        </div>
      )}
    </div>
  );
}
