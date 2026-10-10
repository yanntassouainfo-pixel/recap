"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { ArrowUp, BookOpen, Bot, Loader2, Sparkles } from "lucide-react";
import { ask } from "@/app/actions/assistant";
import type { AssistantAnswer } from "@/lib/assistant/engine";
import { cx } from "@/components/ui";

type Turn = { role: "user"; text: string } | { role: "assistant"; answer: AssistantAnswer };

export function AssistantChat({ suggestions, aiEnabled, initialQuestion }: { suggestions: string[]; aiEnabled: boolean; initialQuestion?: string }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [pending, start] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  const send = (text: string) => {
    const q = text.trim();
    if (!q || pending) return;
    const history = turns.map((t) => (t.role === "user" ? { role: "user" as const, content: t.text } : { role: "assistant" as const, content: t.answer.text }));
    setTurns((t) => [...t, { role: "user", text: q }]);
    setInput("");
    start(async () => {
      try {
        const a = await ask(q, history);
        setTurns((t) => [...t, { role: "assistant", answer: a }]);
      } catch {
        setTurns((t) => [...t, { role: "assistant", answer: { intent: "error", text: "La réponse n'a pas pu être calculée. Réessayez dans un instant.", facts: [], estimates: [], hypotheses: [], actions: [], source: "moteur" } }]);
      }
    });
  };

  useEffect(() => {
    if (initialQuestion && !started.current) { started.current = true; send(initialQuestion); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuestion]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [turns, pending]);

  return (
    <div className="flex min-h-[60vh] flex-col">
      {turns.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center py-10 text-center">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-ink text-bg"><Sparkles size={22} /></div>
          <h2 className="mt-4 text-[20px] font-semibold tracking-[-0.01em]">Posez une question sur vos finances</h2>
          <p className="mt-1.5 max-w-md text-[13.5px] text-ink-3">Les réponses s&apos;appuient uniquement sur vos données enregistrées. Les faits, les estimations et les hypothèses sont toujours distingués.</p>
          <div className="mt-6 flex max-w-2xl flex-wrap justify-center gap-2">
            {suggestions.map((s) => (
              <button key={s} onClick={() => send(s)} className="rounded-full border border-line bg-surface px-3.5 py-1.5 text-[13px] text-ink-2 shadow-card transition hover:border-line-2 hover:text-ink">{s}</button>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex-1 space-y-5 pb-6">
          {turns.map((t, i) => t.role === "user" ? (
            <div key={i} className="flex justify-end"><div className="max-w-[85%] rounded-2xl rounded-br-md bg-ink px-4 py-2.5 text-[14px] text-bg">{t.text}</div></div>
          ) : (
            <AnswerCard key={i} a={t.answer} />
          ))}
          {pending && <div className="flex items-center gap-2 text-[13px] text-ink-3"><Loader2 size={15} className="animate-spin" /> Analyse de vos données…</div>}
          <div ref={endRef} />
          {!pending && turns.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-2">
              {suggestions.filter((s) => !turns.some((t) => t.role === "user" && t.text === s)).slice(0, 4).map((s) => (
                <button key={s} onClick={() => send(s)} className="rounded-full border border-line bg-surface px-3 py-1 text-[12.5px] text-ink-2 hover:border-line-2 hover:text-ink">{s}</button>
              ))}
            </div>
          )}
        </div>
      )}
      <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="sticky bottom-20 z-10 mt-2 lg:bottom-4">
        <div className="flex items-end gap-2 rounded-2xl border border-line-2 bg-surface p-2 shadow-pop">
          <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={1} placeholder="Ex. Puis-je absorber une dépense de 800 000 F ce mois-ci ?"
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
            className="max-h-40 min-h-[40px] flex-1 resize-none bg-transparent px-2.5 py-2 text-[14.5px] outline-none placeholder:text-ink-3" aria-label="Votre question" />
          <button type="submit" disabled={!input.trim() || pending} className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-ink text-bg disabled:opacity-30" aria-label="Envoyer"><ArrowUp size={18} /></button>
        </div>
        <p className="mt-1.5 px-2 text-[11.5px] text-ink-3">{aiEnabled ? "Rédaction par Claude à partir des calculs de Recap ; aucun chiffre n'est généré par l'IA." : "Réponses calculées par le moteur de Recap. Ajoutez une clé ANTHROPIC_API_KEY pour des réponses rédigées en langage naturel."} Ne remplace pas un conseil comptable, fiscal ou financier.</p>
      </form>
    </div>
  );
}

function AnswerCard({ a }: { a: AssistantAnswer }) {
  return (
    <div className="flex gap-3">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-surface-3 text-ink-2"><Bot size={16} /></div>
      <div className="min-w-0 flex-1 rounded-2xl rounded-tl-md bg-surface p-4 shadow-card animate-fade-up">
        <p className="whitespace-pre-line text-[14px] leading-relaxed text-ink">{a.text}</p>
        {a.table && a.table.rows.length > 0 && (
          <div className="mt-3 overflow-x-auto rounded-xl border border-line">
            <table className="w-full text-[12.5px]">
              <thead><tr>{a.table.headers.map((h, i) => <th key={h} className={cx("border-b border-line bg-surface-2 px-3 py-2 font-medium text-ink-3", i > 0 ? "text-right" : "text-left")}>{h}</th>)}</tr></thead>
              <tbody>{a.table.rows.map((r, i) => <tr key={i} className="border-b border-line last:border-0">{r.map((c, j) => <td key={j} className={cx("px-3 py-2", j > 0 ? "text-right tabular" : "")}>{c}</td>)}</tr>)}</tbody>
            </table>
          </div>
        )}
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {([["Faits", a.facts, "bg-good-soft/50"], ["Estimations", a.estimates, "bg-info-soft/50"], ["Hypothèses", a.hypotheses, "bg-warn-soft/50"]] as const).map(([title, items, bg]) => items.length > 0 && (
            <div key={title} className={cx("rounded-xl px-3 py-2.5", bg, items.length > 2 && "sm:col-span-3")}>
              <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">{title}</div>
              <ul className="mt-1 space-y-1 text-[12.5px] text-ink-2">{items.map((f) => <li key={f}>{f}</li>)}</ul>
            </div>
          ))}
        </div>
        {(a.actions.length > 0 || a.learnMore) && (
          <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-line pt-3">
            {a.actions.map((x) => <Link key={x.href} href={x.href} className="text-[13px] font-medium text-accent hover:underline underline-offset-4">{x.label} →</Link>)}
            {a.learnMore && <Link href={`/assistant/ressources#${a.learnMore}`} className="inline-flex items-center gap-1 text-[12.5px] text-ink-3 hover:text-ink"><BookOpen size={13} /> Comprendre</Link>}
            <span className="ml-auto text-[11px] text-ink-3">{a.source === "claude" ? "Rédigé par l'IA · chiffres du moteur" : "Calculé par le moteur"}</span>
          </div>
        )}
      </div>
    </div>
  );
}
