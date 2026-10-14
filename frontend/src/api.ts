export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init.method ?? "GET",
    headers: init.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? `Ошибка ${res.status}`);
  return data as T;
}

export type Role = "owner" | "admin" | "member";
export type TenderStatus = "new" | "reviewing" | "applying" | "submitted" | "rejected";
export type KeyType = "okpd2" | "ktru" | "region" | "customer";

export interface Me {
  user: { id: number; email: string; name: string };
  org: { id: number; name: string; role: Role } | null;
  orgs: { id: number; name: string; role: Role }[];
}

export interface TenderRow {
  id: number;
  regNumber: string;
  law: "44" | "223";
  title: string;
  procedureType: string | null;
  customerName: string | null;
  customerInn: string | null;
  regionCode: string | null;
  maxPrice: string | null;
  currency: string | null;
  publishedAt: string | null;
  submissionDeadline: string | null;
  url: string;
  favorite: boolean;
  status: TenderStatus;
}

export interface TenderList {
  items: TenderRow[];
  total: number;
  noKeys: boolean;
  page: number;
  pageSize: number;
}

export interface TenderDetail {
  tender: TenderRow & {
    stage: string | null;
    okpd2Codes: string[];
    ktruCodes: string[];
    details: Record<string, string> | null;
    sourceUpdatedAt: string | null;
    detailsFetchedAt: string | null;
    updatedAt: string;
    regionName: string | null;
  };
  state: { favorite: boolean; status: TenderStatus; note: string | null; assigneeId: number | null };
  matchesKeys: boolean;
}

export interface FilterKey {
  id: number;
  type: KeyType;
  value: string;
  label: string | null;
}

export interface Members {
  members: { userId: number; name: string; email: string; role: Role }[];
  invitations: { id: number; email: string; role: Role; link: string }[];
  myRole: Role;
  myUserId: number;
}

export interface Region {
  code: string;
  name: string;
}

export const STATUS_LABELS: Record<TenderStatus, string> = {
  new: "Новая",
  reviewing: "Изучаем",
  applying: "Готовим заявку",
  submitted: "Заявка подана",
  rejected: "Не участвуем",
};

export const ROLE_LABELS: Record<Role, string> = { owner: "Владелец", admin: "Администратор", member: "Сотрудник" };

export const KEY_LABELS: Record<KeyType, string> = {
  okpd2: "ОКПД2",
  ktru: "КТРУ",
  region: "Регион",
  customer: "Заказчик",
};

const money = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 2 });
export const formatPrice = (v: string | null) => (v ? money.format(Number(v)) : "—");

const dt = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Moscow",
});
export const formatDateTime = (v: string | null) => (v ? `${dt.format(new Date(v))} МСК` : "—");

const d = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Moscow" });
export const formatDate = (v: string | null) => (v ? d.format(new Date(v)) : "—");

export function daysLeft(deadline: string | null): number | null {
  if (!deadline) return null;
  return Math.ceil((new Date(deadline).getTime() - Date.now()) / 86_400_000);
}
