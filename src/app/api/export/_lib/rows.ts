/** Construction des lignes d'export (pure, testable). */
import type { CashMovement, ExpenseRow, FinanceData } from "@/lib/finance/types";
import { toBase } from "@/lib/finance/engine";
import { EXPENSE_STATUS, assignmentOf, expenseStatus, isInternalExpense, referenceDate, type Lookup } from "@/components/expenses/logic";
import { movementCategory, movementTypeLabel, type MovementNames } from "@/components/transactions/logic";
import { csvAmount, toCsv } from "./csv";

export const TRANSACTION_HEADER = [
  "Date", "Type", "Libellé", "Structure", "Activité", "Catégorie", "Compte", "Montant", "Devise", "Montant en devise de base", "Flux interne",
];

export function transactionsCsv(movements: CashMovement[], names: MovementNames, baseCurrency: string): string {
  const rows = movements.map((m) => [
    m.date,
    movementTypeLabel(m),
    m.label,
    names.company(m.companyId) ?? "",
    names.activity(m.activityId) ?? "",
    movementCategory(m, names),
    names.account(m.accountId) ?? "",
    csvAmount(m.amount, m.currency),
    m.currency,
    m.amountBase == null ? "taux manquant" : csvAmount(m.amountBase, baseCurrency),
    m.internal,
  ]);
  return toCsv([...TRANSACTION_HEADER.slice(0, 9), `Montant en devise de base (${baseCurrency})`, TRANSACTION_HEADER[10]], rows);
}

export const EXPENSE_HEADER = [
  "Date", "Statut", "Libellé", "Fournisseur", "Structure", "Affectation", "Catégorie", "Nature", "Compte", "Montant", "Devise",
  "Montant en devise de base", "Échéance", "Date de paiement", "Récurrente", "Flux interne", "Justificatif joint", "Note",
];

export function expensesCsv(rows: (ExpenseRow & { note?: string | null; documentId?: string | null })[], data: FinanceData, lookup: Lookup): string {
  const out = rows.map((e) => {
    const st = expenseStatus(e, data.today);
    const conv = toBase(data, e.amount, e.currency, referenceDate(e));
    const cat = lookup.category(e.categoryId);
    const assignment = assignmentOf(e, lookup);
    const company = lookup.company(e.companyId);
    return [
      referenceDate(e),
      EXPENSE_STATUS[st].label,
      e.label,
      e.supplier ?? "",
      company ? (company.kind === "personal" ? "Espace personnel" : company.name) : "",
      assignment.detail ? `${assignment.label} (${assignment.detail})` : assignment.label,
      cat?.name ?? "Sans catégorie",
      cat ? (cat.nature === "fixed" ? "Charge fixe" : "Charge variable") : "",
      lookup.account(e.accountId)?.name ?? "",
      csvAmount(e.amount, e.currency),
      e.currency,
      conv.missing ? "taux manquant" : csvAmount(conv.value, data.baseCurrency),
      e.dueDate ?? "",
      e.paidDate ?? "",
      !!e.recurringId,
      isInternalExpense(data, e),
      !!e.documentId,
      e.note ?? "",
    ];
  });
  const header = [...EXPENSE_HEADER];
  header[11] = `Montant en devise de base (${data.baseCurrency})`;
  return toCsv(header, out);
}
