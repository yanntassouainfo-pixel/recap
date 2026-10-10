import Link from "next/link";
import { BookOpen } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { getSnapshot } from "@/lib/data";
import { computeRecommendations } from "@/lib/finance/insights";
import { SUGGESTED_QUESTIONS } from "@/lib/assistant/engine";
import { aiEnabled } from "@/lib/assistant/claude";
import { Card, CardHeader, PageHeader, buttonClass } from "@/components/ui";
import { AssistantChat } from "@/components/assistant/chat";

export const metadata = { title: "Assistant financier" };

export default async function AssistantPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const snap = await getSnapshot(user.id);
  const recs = computeRecommendations(snap);
  return (
    <div className="animate-fade-up">
      <PageHeader title="Assistant financier" description="Posez vos questions en langage courant. Les réponses sont chiffrées, vérifiables et accompagnées d'actions concrètes."
        actions={<Link href="/assistant/ressources" className={buttonClass("secondary", "md")}><BookOpen size={15} /> Centre de ressources</Link>} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <AssistantChat suggestions={SUGGESTED_QUESTIONS} aiEnabled={aiEnabled()} initialQuestion={sp.q} />
        <aside className="space-y-4">
          <Card>
            <CardHeader title="Recommandations du moment" description="Liées à vos données, jamais génériques" />
            {recs.length === 0 ? <p className="px-5 pb-5 text-[13px] text-ink-3">Rien à signaler pour l&apos;instant.</p> : (
              <ul className="divide-y divide-line">
                {recs.slice(0, 5).map((r) => (
                  <li key={r.key} className="px-5 py-3.5">
                    <div className="text-[13.5px] font-medium leading-snug">{r.title}</div>
                    <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">{r.body}</p>
                    <ul className="mt-1.5 space-y-0.5 text-[11.5px] text-ink-3">{r.facts.slice(0, 3).map((f) => <li key={f}>· {f}</li>)}</ul>
                    <div className="mt-2 flex gap-3">
                      {r.action && <Link href={r.action.href} className="text-[12.5px] font-medium text-accent hover:underline underline-offset-4">{r.action.label} →</Link>}
                      {r.learnMore && <Link href={`/assistant/ressources#${r.learnMore}`} className="text-[12px] text-ink-3 hover:text-ink">Comprendre</Link>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </aside>
      </div>
    </div>
  );
}
