import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useOutletContext } from "react-router";
import { api, KEY_LABELS, type FilterKey, type KeyType, type Me, type Region } from "../api";

const HINTS: Record<KeyType, { placeholder: string; help: string }> = {
  okpd2: {
    placeholder: "26.20 или 26.20.15.000",
    help: "Совпадение по началу кода: 26.20 найдёт все закупки с кодами 26.20.*",
  },
  ktru: {
    placeholder: "26.20.15.000-00000027",
    help: "Полный код позиции КТРУ или его начало",
  },
  region: { placeholder: "", help: "Регион заказчика" },
  customer: {
    placeholder: "ИНН (10 или 12 цифр) или часть названия",
    help: "ИНН — точное совпадение, текст — поиск по названию заказчика",
  },
};

export function KeysPage() {
  const me = useOutletContext<Me>();
  const canEdit = me.org?.role !== "member";
  const qc = useQueryClient();
  const keys = useQuery({ queryKey: ["keys"], queryFn: () => api<FilterKey[]>("/keys") });
  const regions = useQuery({ queryKey: ["regions"], queryFn: () => api<Region[]>("/meta/regions"), staleTime: Infinity });
  const regionName = (code: string) => regions.data?.find((r) => r.code === code)?.name ?? code;

  const [type, setType] = useState<KeyType>("okpd2");
  const [value, setValue] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api("/keys", { method: "POST", body: { type, value: value.trim(), label: label.trim() || undefined } });
      setValue("");
      setLabel("");
      qc.invalidateQueries({ queryKey: ["keys"] });
      qc.invalidateQueries({ queryKey: ["tenders"] });
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const remove = async (id: number) => {
    await api(`/keys/${id}`, { method: "DELETE" });
    qc.invalidateQueries({ queryKey: ["keys"] });
    qc.invalidateQueries({ queryKey: ["tenders"] });
  };

  const groups = (["okpd2", "ktru", "region", "customer"] as KeyType[]).map((t) => ({
    type: t,
    items: keys.data?.filter((k) => k.type === t) ?? [],
  }));

  return (
    <div className="narrow-page">
      <h1>Ключи фильтрации</h1>
      <p className="muted">
        Ключи общие для всей организации. Закупка попадает в ваш список, если подходит под{" "}
        <b>любой из кодов ОКПД2/КТРУ</b> <i>и</i> <b>любой из регионов</b> <i>и</i> <b>любого из заказчиков</b>. Пустая
        группа не ограничивает выборку.
      </p>

      {canEdit ? (
        <form className="card key-form" onSubmit={add}>
          <select
            value={type}
            onChange={(e) => {
              setType(e.target.value as KeyType);
              setValue("");
            }}
          >
            {Object.entries(KEY_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          {type === "region" ? (
            <select className="grow" required value={value} onChange={(e) => setValue(e.target.value)}>
              <option value="">Выберите регион…</option>
              {regions.data?.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.code} — {r.name}
                </option>
              ))}
            </select>
          ) : (
            <input
              className="grow"
              required
              placeholder={HINTS[type].placeholder}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          )}
          {type !== "region" && (
            <input placeholder="Комментарий (необязательно)" value={label} onChange={(e) => setLabel(e.target.value)} />
          )}
          <button className="btn btn-primary">Добавить</button>
          <div className="muted small full">{HINTS[type].help}</div>
          {error && <div className="error full">{error}</div>}
        </form>
      ) : (
        <p className="notice">Изменять ключи могут владелец и администраторы организации.</p>
      )}

      <div className="key-groups">
        {groups.map((g) => (
          <div className="card" key={g.type}>
            <h3>
              {KEY_LABELS[g.type]} <span className="muted small">{g.items.length || "не ограничено"}</span>
            </h3>
            {g.items.length === 0 && <p className="muted small">Ключей нет</p>}
            <ul className="key-list">
              {g.items.map((k) => (
                <li key={k.id}>
                  <span>
                    <code>{k.value}</code>
                    {g.type === "region" && <span> {regionName(k.value)}</span>}
                    {k.label && <span className="muted"> — {k.label}</span>}
                  </span>
                  {canEdit && (
                    <button className="btn btn-ghost btn-sm" onClick={() => remove(k.id)} aria-label="Удалить">
                      ✕
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
