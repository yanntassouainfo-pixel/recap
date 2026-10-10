import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { getScope, loadFinanceData } from "@/lib/data";
import { db, schema } from "@/lib/db";
import { buildLookup, filterExpenses, parseExpenseFilters } from "@/components/expenses/logic";
import { expensesCsv } from "../_lib/rows";
import { csvResponse } from "../_lib/csv";

export const dynamic = "force-dynamic";

/** GET /api/export/expenses?mois=|du=&au=&structure=&activite=&categorie=&statut=&q= — mêmes filtres que /depenses. */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  try {
    const sp = Object.fromEntries(new URL(req.url).searchParams.entries());
    const scope = await getScope(user.id);
    const data = loadFinanceData(user.id, scope);
    const f = parseExpenseFilters(sp, data.today);
    const lookup = buildLookup(data);
    const rows = db.select().from(schema.expenses).where(eq(schema.expenses.userId, user.id)).all();
    const list = filterExpenses(rows, data, f, lookup).reverse();
    const name = f.month ? `depenses_${f.month}.csv` : `depenses_${f.from}_${f.to}.csv`;
    return csvResponse(expensesCsv(list, data, lookup), name);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "L'export a échoué." }, { status: 500 });
  }
}
