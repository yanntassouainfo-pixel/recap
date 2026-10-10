import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getScope, loadFinanceData } from "@/lib/data";
import { cashMovements } from "@/lib/finance/engine";
import { filterMovements, movementNames, parseTxFilters } from "@/components/transactions/logic";
import { transactionsCsv } from "../_lib/rows";
import { csvResponse } from "../_lib/csv";

export const dynamic = "force-dynamic";

/** GET /api/export/transactions?du=&au=&type=&compte=&structure=&activite=&q= — mouvements réels de la portée courante. */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  try {
    const sp = Object.fromEntries(new URL(req.url).searchParams.entries());
    const scope = await getScope(user.id);
    const data = loadFinanceData(user.id, scope);
    const f = parseTxFilters(sp, data.today);
    const names = movementNames(data);
    const list = filterMovements(cashMovements(data), f, names).reverse(); // ordre chronologique dans le fichier
    return csvResponse(transactionsCsv(list, names, data.baseCurrency), `transactions_${f.from}_${f.to}.csv`);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "L'export a échoué." }, { status: 500 });
  }
}
