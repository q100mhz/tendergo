import { useEffect, useRef, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import {
  api,
  daysLeft,
  formatDate,
  formatDateTime,
  formatPrice,
  STATUS_LABELS,
  type TenderList,
  type TenderRow,
  type TenderStatus,
} from "../api";

const DEFAULTS: Record<string, string> = {
  scope: "keys",
  activeOnly: "true",
  sort: "deadline",
  order: "asc",
  page: "1",
};

export function TendersPage() {
  const [params, setParams] = useSearchParams();
  // The debounced search runs a closure from an earlier render; reading params through a ref keeps it from
  // overwriting filters changed in the meantime.
  const latestParams = useRef(params);
  latestParams.current = params;
  const get = (k: string) => params.get(k) ?? DEFAULTS[k] ?? "";
  const update = (patch: Record<string, string>) => {
    const next = new URLSearchParams(latestParams.current);
    for (const [k, v] of Object.entries(patch)) {
      if (!v || v === DEFAULTS[k]) next.delete(k);
      else next.set(k, v);
    }
    if (!("page" in patch)) next.delete("page");
    setParams(next, { replace: true });
  };

  const [q, setQ] = useState(get("q"));
  useEffect(() => {
    const t = setTimeout(() => q !== get("q") && update({ q }), 400);
    return () => clearTimeout(t);
  }, [q]);

  const query = new URLSearchParams({ ...DEFAULTS, ...Object.fromEntries(params) });
  const { data, isFetching, error } = useQuery({
    queryKey: ["tenders", query.toString()],
    queryFn: () => api<TenderList>(`/tenders?${query}`),
    placeholderData: keepPreviousData,
  });

  const page = Number(get("page"));
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const sortBy = (col: string) =>
    update({ sort: col, order: get("sort") === col && get("order") === "asc" ? "desc" : "asc" });
  const arrow = (col: string) => (get("sort") === col ? (get("order") === "asc" ? " ↑" : " ↓") : "");

  return (
    <div>
      <div className="page-head">
        <h1>Закупки</h1>
        <div className="segmented">
          <button className={get("scope") === "keys" ? "active" : ""} onClick={() => update({ scope: "keys" })}>
            По ключам организации
          </button>
          <button className={get("scope") === "all" ? "active" : ""} onClick={() => update({ scope: "all" })}>
            Все в базе
          </button>
        </div>
      </div>

      <div className="filters card">
        <input
          className="grow"
          placeholder="Поиск: название, заказчик, номер закупки"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select value={get("law")} onChange={(e) => update({ law: e.target.value })}>
          <option value="">44-ФЗ и 223-ФЗ</option>
          <option value="44">44-ФЗ</option>
          <option value="223">223-ФЗ</option>
        </select>
        <select value={get("status")} onChange={(e) => update({ status: e.target.value })}>
          <option value="">Любой статус</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <PriceInput placeholder="Цена от, ₽" value={get("priceMin")} onCommit={(v) => update({ priceMin: v })} />
        <PriceInput placeholder="Цена до, ₽" value={get("priceMax")} onCommit={(v) => update({ priceMax: v })} />
        <label className="check">
          <input
            type="checkbox"
            checked={get("activeOnly") === "true"}
            onChange={(e) => update({ activeOnly: String(e.target.checked) })}
          />
          Только с открытым приёмом заявок
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={get("favorite") === "true"}
            onChange={(e) => update({ favorite: e.target.checked ? "true" : "" })}
          />
          Избранное
        </label>
      </div>

      {error && <p className="error">{(error as Error).message}</p>}

      {data?.noKeys ? (
        <div className="card empty">
          <h3>Ключи фильтрации не настроены</h3>
          <p className="muted">
            Добавьте коды ОКПД2/КТРУ, регионы или заказчиков — и здесь появятся подходящие закупки. Пока можно посмотреть
            все закупки в базе.
          </p>
          <div className="row">
            <Link className="btn btn-primary" to="/keys">
              Настроить ключи
            </Link>
            <button className="btn" onClick={() => update({ scope: "all" })}>
              Показать все
            </button>
          </div>
        </div>
      ) : (
        <div className={`card table-card ${isFetching ? "loading" : ""}`}>
          <div className="table-meta muted">
            {data ? `Найдено: ${data.total.toLocaleString("ru-RU")}` : "Загрузка…"}
          </div>
          <div className="table-scroll">
            <table className="tenders">
              <thead>
                <tr>
                  <th className="col-fav" />
                  <th>Закупка</th>
                  <th>Заказчик</th>
                  <th className="sortable num" onClick={() => sortBy("price")}>
                    Начальная цена{arrow("price")}
                  </th>
                  <th className="sortable" onClick={() => sortBy("deadline")}>
                    Окончание приёма{arrow("deadline")}
                  </th>
                  <th className="sortable" onClick={() => sortBy("published")}>
                    Размещено{arrow("published")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {data?.items.map((t) => <Row key={t.id} t={t} />)}
                {data && data.items.length === 0 && (
                  <tr>
                    <td colSpan={6} className="muted empty-row">
                      Ничего не найдено. Попробуйте ослабить фильтры.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <div className="pager">
              <button className="btn btn-sm" disabled={page <= 1} onClick={() => update({ page: String(page - 1) })}>
                ← Назад
              </button>
              <span className="muted">
                Стр. {page} из {pages}
              </span>
              <button className="btn btn-sm" disabled={page >= pages} onClick={() => update({ page: String(page + 1) })}>
                Вперёд →
              </button>
            </div>
          )}
        </div>
      )}
      <IngestStatus />
    </div>
  );
}

function PriceInput(props: { placeholder: string; value: string; onCommit: (v: string) => void }) {
  const [v, setV] = useState(props.value);
  useEffect(() => setV(props.value), [props.value]);
  const commit = () => v !== props.value && props.onCommit(v.replace(/\D/g, ""));
  return (
    <input
      className="price-input"
      inputMode="numeric"
      placeholder={props.placeholder}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
    />
  );
}

function Row({ t }: { t: TenderRow }) {
  const qc = useQueryClient();
  const left = daysLeft(t.submissionDeadline);
  const toggleFav = async () => {
    await api(`/tenders/${t.id}/state`, { method: "PUT", body: { favorite: !t.favorite } });
    qc.invalidateQueries({ queryKey: ["tenders"] });
  };
  return (
    <tr>
      <td className="col-fav">
        <button
          className={`star ${t.favorite ? "on" : ""}`}
          onClick={toggleFav}
          title={t.favorite ? "Убрать из избранного" : "В избранное"}
          aria-label="Избранное"
        >
          ★
        </button>
      </td>
      <td>
        <div className="tender-meta">
          <span className={`law law-${t.law}`}>{t.law}-ФЗ</span>
          <span className="muted small">№ {t.regNumber}</span>
          {t.status !== "new" && <StatusBadge status={t.status} />}
        </div>
        <Link to={`/tenders/${t.id}`} className="tender-title">
          {t.title}
        </Link>
        {t.procedureType && <div className="muted small">{t.procedureType}</div>}
      </td>
      <td className="customer">{t.customerName ?? "—"}</td>
      <td className="num nowrap">{formatPrice(t.maxPrice)}</td>
      <td className="nowrap">
        <div>{formatDateTime(t.submissionDeadline)}</div>
        {left !== null && (
          <div className={`small ${left < 0 ? "muted" : left <= 2 ? "urgent" : "muted"}`}>
            {left < 0 ? "приём завершён" : left === 0 ? "сегодня" : `осталось ${left} дн.`}
          </div>
        )}
      </td>
      <td className="nowrap muted">{formatDate(t.publishedAt)}</td>
    </tr>
  );
}

export function StatusBadge({ status }: { status: TenderStatus }) {
  return <span className={`status status-${status}`}>{STATUS_LABELS[status]}</span>;
}

function IngestStatus() {
  const { data } = useQuery({
    queryKey: ["ingest"],
    queryFn: () =>
      api<{ runs: { id: number; status: string; startedAt: string; finishedAt: string | null; upserted: number; error: string | null }[] }>(
        "/ingest/status",
      ),
    refetchInterval: 60_000,
  });
  const last = data?.runs[0];
  if (!last) return <p className="muted small footer-note">Загрузка из ЕИС ещё не запускалась.</p>;
  const lastOk = data.runs.find((r) => r.status === "ok");
  return (
    <p className="muted small footer-note">
      {last.status === "running"
        ? "Идёт обновление данных из ЕИС…"
        : last.status === "failed"
          ? `Последнее обновление из ЕИС не удалось (${formatDateTime(last.startedAt)}): ${last.error ?? ""}`
          : null}
      {lastOk && ` Данные обновлены ${formatDateTime(lastOk.finishedAt ?? lastOk.startedAt)}.`}
    </p>
  );
}
