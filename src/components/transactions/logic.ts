/**
 * Logique pure du module « Transactions » : filtres d'URL, filtrage des mouvements réels du moteur,
 * regroupement par jour, libellés. Aucun accès à la base.
 */
import { formatDate, startOfMonth, type ISODate } from "@/lib/dates";
import { TRANSFER_LABELS } from "@/lib/finance/engine";
import type { CashMovement, FinanceData } from "@/lib/finance/types";
import { matchesQuery } from "@/components/expenses/logic";

export type TxType = "all" | "income" | "expense" | "transfer";

export const TX_TYPES: { key: TxType; label: string }[] = [
  { key: "all", label: "Tout" },
  { key: "income", label: "Entrées" },
  { key: "expense", label: "Sorties" },
  { key: "transfer", label: "Transferts" },
];

export const PAGE_SIZE = 100;

export interface TxFilters {
  type: TxType;
  from: ISODate;
  to: ISODate;
  accountId: string;
  companyId: string;
  activityId: string;
  q: string;
  page: number;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Par défaut : du 1er du mois à aujourd'hui (comme la période « Mois » du tableau de bord). */
export function parseTxFilters(sp: Record<string, string | undefined>, today: ISODate): TxFilters {
  const type = (["all", "income", "expense", "transfer"].includes(sp.type ?? "") ? sp.type : "all") as TxType;
  let from = sp.du && ISO.test(sp.du) ? sp.du : startOfMonth(today);
  let to = sp.au && ISO.test(sp.au) ? sp.au : today;
  if (to < from) [from, to] = [to, from];
  return {
    type, from, to,
    accountId: sp.compte ?? "",
    companyId: sp.structure ?? "",
    activityId: sp.activite ?? "",
    q: (sp.q ?? "").trim().slice(0, 100),
    page: Math.max(1, Math.floor(Number(sp.page) || 1)),
  };
}

/** Paramètres d'URL équivalents (pour les liens, la pagination et l'export). */
export function txParams(f: TxFilters): Record<string, string> {
  const p: Record<string, string> = { du: f.from, au: f.to };
  if (f.type !== "all") p.type = f.type;
  if (f.accountId) p.compte = f.accountId;
  if (f.companyId) p.structure = f.companyId;
  if (f.activityId) p.activite = f.activityId;
  if (f.q) p.q = f.q;
  return p;
}

export interface MovementNames {
  category: (id: string | null) => string | null;
  activity: (id: string | null) => string | null;
  account: (id: string | null) => string | null;
  company: (id: string | null) => string | null;
}

export function movementNames(data: FinanceData): MovementNames {
  const cats = new Map(data.categories.map((c) => [c.id, c.name]));
  const acts = new Map(data.activities.map((a) => [a.id, a.name]));
  const accs = new Map(data.accounts.map((a) => [a.id, a.name]));
  const cos = new Map(data.companies.map((c) => [c.id, c.kind === "personal" ? "Espace personnel" : c.name]));
  return {
    category: (id) => (id ? cats.get(id) ?? null : null),
    activity: (id) => (id ? acts.get(id) ?? null : null),
    account: (id) => (id ? accs.get(id) ?? null : null),
    company: (id) => (id ? cos.get(id) ?? null : null),
  };
}

export function matchesType(m: Pick<CashMovement, "kind">, type: TxType): boolean {
  if (type === "all") return true;
  if (type === "transfer") return m.kind === "transfer_in" || m.kind === "transfer_out";
  return m.kind === type;
}

/** Catégorie lisible d'un mouvement (les paiements de factures et transferts n'ont pas de catégorie saisie). */
export function movementCategory(m: Pick<CashMovement, "source" | "categoryId" | "transferNature">, names: Pick<MovementNames, "category">): string {
  if (m.source === "fee") return "Frais sur encaissement";
  if (m.source === "transfer") return TRANSFER_LABELS[m.transferNature ?? "internal"] ?? "Transfert";
  const c = names.category(m.categoryId);
  if (c) return c;
  if (m.source === "payment") return "Paiement de facture";
  if (m.source === "income") return "Recette directe";
  return "Sans catégorie";
}

export function movementTypeLabel(m: Pick<CashMovement, "kind" | "source">): string {
  if (m.source === "fee") return "Frais";
  switch (m.kind) {
    case "income": return "Entrée";
    case "expense": return "Sortie";
    case "transfer_in": return "Transfert entrant";
    default: return "Transfert sortant";
  }
}

/** Filtre les mouvements (déjà limités à la portée par le moteur) et les trie du plus récent au plus ancien. */
export function filterMovements(movements: CashMovement[], f: TxFilters, names: MovementNames): CashMovement[] {
  const out = movements.filter((m) => {
    if (m.date < f.from || m.date > f.to) return false;
    if (!matchesType(m, f.type)) return false;
    if (f.accountId && m.accountId !== f.accountId) return false;
    if (f.companyId && m.companyId !== f.companyId) return false;
    if (f.activityId && m.activityId !== f.activityId) return false;
    if (f.q && !matchesQuery(f.q, [m.label, movementCategory(m, names), names.activity(m.activityId), names.account(m.accountId)])) return false;
    return true;
  });
  return out.sort((a, b) => (a.date === b.date ? b.id.localeCompare(a.id) : a.date < b.date ? 1 : -1));
}

/**
 * Variation nette de trésorerie (devise de base) : flux internes neutralisés, montants sans taux ignorés.
 * Les transferts vers l'extérieur de la portée (ex. rémunération vers le compte perso en vue pro) comptent.
 */
export function netChange(list: Pick<CashMovement, "amountBase" | "internal">[]): number {
  let s = 0;
  for (const m of list) if (!m.internal && m.amountBase != null) s += m.amountBase;
  return s;
}

export interface DayGroup<T> { date: ISODate; items: T[] }

/** Regroupe une liste déjà triée par date en conservant l'ordre. */
export function groupByDay<T extends { date: ISODate }>(list: T[]): DayGroup<T>[] {
  const out: DayGroup<T>[] = [];
  for (const m of list) {
    const last = out[out.length - 1];
    if (last && last.date === m.date) last.items.push(m);
    else out.push({ date: m.date, items: [m] });
  }
  return out;
}

const WEEKDAYS = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];

export function dayLabel(iso: ISODate, today: ISODate): string {
  const [y, m, d] = iso.split("-").map(Number);
  const wd = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const prefix = iso === today ? "Aujourd'hui · " : "";
  return `${prefix}${wd} ${formatDate(iso, "long")}`;
}
