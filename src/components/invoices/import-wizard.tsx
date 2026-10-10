"use client";

import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { CheckCircle2, FileUp, Loader2, RotateCcw, ScanText } from "lucide-react";
import { analyzeImport, confirmImport, type ImportAnalysis } from "@/app/actions/invoices";
import { initialState } from "@/lib/action-state";
import type { Confidence, ExtractedInvoice } from "@/lib/extract";
import { PAYMENT_METHOD_LABELS } from "@/lib/invoices";
import { CURRENCY_CODES, decimalsOf } from "@/lib/money";
import { Badge, Card, CardHeader, Field, Input, Notice, Select, buttonClass, cx } from "@/components/ui";
import { FormMessage, SubmitButton } from "@/components/form-bits";

export interface ImportOptions {
  defaultCompanyId: string | null;
  today: string;
  companies: { id: string; name: string; currency: string; kind: string }[];
  activities: { id: string; companyId: string; name: string }[];
  accounts: { id: string; companyId: string; name: string; currency: string }[];
  categories: { id: string; kind: string; name: string }[];
  contacts: { id: string; name: string; organization: string | null }[];
}

type Direction = "income" | "expense";

const CONFIDENCE: Record<Confidence, { label: string; tone: "good" | "info" | "warn" | "neutral" }> = {
  high: { label: "Fiable", tone: "good" },
  medium: { label: "À vérifier", tone: "info" },
  low: { label: "Incertain", tone: "warn" },
  none: { label: "Non trouvé", tone: "neutral" },
};

function ConfidenceBadge({ c }: { c: Confidence | undefined }) {
  const x = CONFIDENCE[c ?? "none"];
  return <Badge tone={x.tone} dot className="ml-1.5 align-middle">{x.label}</Badge>;
}

/** Unités majeures → champ de saisie à la française. */
function majorToField(v: number | null, currency: string): string {
  if (v == null) return "";
  const d = decimalsOf(currency);
  return v.toFixed(d).replace(".", ",");
}

export function ImportWizard({ options, initialDirection }: { options: ImportOptions; initialDirection: Direction }) {
  const [direction, setDirection] = useState<Direction>(initialDirection);
  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<ImportAnalysis | null>(null);
  const [manual, setManual] = useState(false);
  const [pending, start] = useTransition();
  const [phase, setPhase] = useState<"upload" | "extract">("upload");
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const reset = () => { setFile(null); setAnalysis(null); setManual(false); if (inputRef.current) inputRef.current.value = ""; };

  const analyze = (f: File) => {
    setAnalysis(null);
    setManual(false);
    const fd = new FormData();
    fd.set("file", f);
    fd.set("direction", direction);
    setPhase("upload");
    start(async () => {
      const t = setTimeout(() => setPhase("extract"), 700);
      try {
        setAnalysis(await analyzeImport(fd));
      } catch {
        setAnalysis({ error: "Le téléversement a échoué (connexion interrompue ou fichier trop volumineux). Réessayez.", code: "failed" });
      } finally {
        clearTimeout(t);
      }
    });
  };

  const pick = (f: File | undefined | null) => {
    if (!f) return;
    setFile(f);
    analyze(f);
  };

  const reviewing = file && !pending && (analysis?.ok || manual);

  if (reviewing) {
    return <Review key={`${direction}-${analysis?.sha256 ?? "manual"}`} file={file} direction={direction} analysis={analysis?.ok ? analysis : null} options={options} onRestart={reset} />;
  }

  return (
    <div className="grid gap-5">
      <Card>
        <CardHeader title="1. Que contient ce document ?" description="Le sens détermine où la facture sera enregistrée." />
        <div className="grid gap-3 px-5 pb-5 sm:grid-cols-2" role="radiogroup" aria-label="Sens de la facture">
          {([
            ["income", "Facture émise à un client", "Un revenu : elle rejoint vos factures à encaisser."],
            ["expense", "Facture fournisseur / justificatif", "Une dépense : elle est enregistrée « à payer » par défaut."],
          ] as const).map(([k, title, desc]) => (
            <button key={k} type="button" role="radio" aria-checked={direction === k} disabled={pending}
              onClick={() => setDirection(k)}
              className={cx("rounded-xl border p-4 text-left transition-colors", direction === k ? "border-ink bg-surface-2" : "border-line-2 hover:border-ink-3/40")}>
              <div className="flex items-center gap-2 text-[14px] font-medium text-ink">
                <span className={cx("size-3.5 rounded-full border-2", direction === k ? "border-ink bg-ink" : "border-line-2")} aria-hidden />
                {title}
              </div>
              <p className="mt-1 pl-5.5 text-[12.5px] text-ink-3">{desc}</p>
            </button>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader title="2. Déposez le fichier" description="PDF ou image (PNG, JPEG, WebP), 15 Mo maximum. Rien n'est enregistré avant votre validation." />
        <div className="px-5 pb-5">
          <label
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); if (!pending) pick(e.dataTransfer.files?.[0]); }}
            className={cx("flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors",
              dragOver ? "border-accent bg-accent-soft/40" : "border-line-2 hover:border-ink-3/50", pending && "pointer-events-none opacity-70")}>
            <input ref={inputRef} type="file" accept="application/pdf,image/png,image/jpeg,image/webp,image/gif" className="sr-only" disabled={pending}
              onChange={(e) => pick(e.target.files?.[0])} />
            {pending ? (
              <>
                <Loader2 size={26} className="animate-spin text-ink-3" aria-hidden />
                <p className="mt-3 text-[14px] font-medium text-ink" role="status">{phase === "upload" ? "Téléversement en cours…" : "Extraction des informations…"}</p>
                <p className="mt-1 text-[12.5px] text-ink-3">{file?.name}</p>
              </>
            ) : (
              <>
                <FileUp size={26} className="text-ink-3" aria-hidden />
                <p className="mt-3 text-[14px] font-medium text-ink">Glissez votre facture ici, ou <span className="text-accent underline underline-offset-4">choisissez un fichier</span></p>
                <p className="mt-1 text-[12.5px] text-ink-3">Les montants, dates, numéro et {direction === "income" ? "client" : "fournisseur"} seront proposés : vous vérifierez chaque champ.</p>
              </>
            )}
          </label>

          {analysis?.error && !pending && (
            <div className="mt-4">
              <Notice tone="bad" title="Importation impossible"
                action={<div className="flex flex-wrap gap-2">
                  {file && analysis.code !== "too_large" && analysis.code !== "unsupported" && (
                    <button type="button" className={buttonClass("secondary", "sm")} onClick={() => analyze(file)}><RotateCcw size={14} aria-hidden /> Réessayer</button>
                  )}
                  {file && analysis.code === "unreadable_pdf" && (
                    <button type="button" className={buttonClass("secondary", "sm")} onClick={() => setManual(true)}>Saisir manuellement</button>
                  )}
                  <button type="button" className={buttonClass("ghost", "sm")} onClick={reset}>Choisir un autre fichier</button>
                </div>}>
                {analysis.error}
              </Notice>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

/* ───────────────────────── Écran de vérification ───────────────────────── */

function Review({ file, direction, analysis, options, onRestart }: { file: File; direction: Direction; analysis: ImportAnalysis | null; options: ImportOptions; onRestart: () => void }) {
  const [state, dispatch] = useActionState(confirmImport, initialState);
  const fields: ExtractedInvoice | null = analysis?.extraction?.fields ?? null;
  const conf = (k: keyof ExtractedInvoice) => fields?.[k].confidence;

  const suggestedCompany = analysis?.suggestions?.companyId ?? options.defaultCompanyId ?? options.companies[0]?.id ?? "";
  const initialCurrency = fields?.currency.value && (CURRENCY_CODES as string[]).includes(fields.currency.value)
    ? fields.currency.value
    : options.companies.find((c) => c.id === suggestedCompany)?.currency ?? "XOF";

  const [v, setV] = useState(() => ({
    companyId: suggestedCompany,
    currency: initialCurrency,
    number: fields?.number.value ?? "",
    party: (direction === "income" ? fields?.recipient.value : fields?.issuer.value) ?? "",
    contactId: analysis?.suggestions?.contactId ?? "",
    issueDate: fields?.issueDate.value ?? "",
    dueDate: fields?.dueDate.value ?? "",
    total: majorToField(fields?.total.value ?? null, initialCurrency),
    subtotal: majorToField(fields?.subtotal.value ?? null, initialCurrency),
    tax: majorToField(fields?.tax.value ?? null, initialCurrency),
    description: fields?.description.value ?? "",
    activityId: "",
    categoryId: analysis?.suggestions?.categoryId ?? "",
    status: "sent",
    alreadyPaid: false,
    paidDate: options.today,
    accountId: "",
    method: "bank_transfer",
  }));
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setV((s) => ({ ...s, [k]: val }));
  const confirmDuplicate = state.values?.confirmDuplicate === "1" && !!state.warning;
  const fe = (k: string) => state.fieldErrors?.[k];

  const previewUrl = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(previewUrl), [previewUrl]);

  const activities = options.activities.filter((a) => a.companyId === v.companyId);
  const accounts = options.accounts.filter((a) => a.companyId === v.companyId && a.currency === v.currency);
  const categories = options.categories.filter((c) => c.kind === "expense");
  const isImage = file.type.startsWith("image/");

  if (state.ok) {
    return (
      <Card>
        <div className="flex flex-col items-center px-6 py-12 text-center">
          <CheckCircle2 size={34} className="text-good" aria-hidden />
          <h2 className="mt-3 text-[16px] font-semibold text-ink">{direction === "income" ? "Facture importée" : "Dépense enregistrée"}</h2>
          <p className="mt-1 max-w-md text-[13.5px] text-ink-2">{state.message}</p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {direction === "income" && state.id
              ? <Link href={`/revenus/${state.id}`} className={buttonClass("primary")}>Ouvrir la facture</Link>
              : <Link href="/depenses" className={buttonClass("primary")}>Voir mes dépenses</Link>}
            <button type="button" onClick={onRestart} className={buttonClass("secondary")}>Importer un autre document</button>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <form action={(fd) => { fd.set("file", file); dispatch(fd); }} className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
      <input type="hidden" name="direction" value={direction} />
      {confirmDuplicate && <input type="hidden" name="confirmDuplicate" value="1" />}

      <div className="grid min-w-0 content-start gap-5">
        <Notice tone="info" title="Vérifiez chaque champ avant de valider">
          {analysis?.extraction?.method === "ai" && "Valeurs proposées par l'extraction assistée. "}
          {analysis?.extraction?.method === "text" && "Valeurs proposées à partir du texte du document. "}
          {!analysis && "Saisie manuelle à partir de l'aperçu. "}
          {direction === "income" ? "La facture sera enregistrée comme à encaisser : rien n'est considéré comme payé." : "La dépense sera enregistrée « à payer », sauf si vous indiquez qu'elle est déjà réglée."}
        </Notice>
        {analysis?.extraction?.warnings.map((w) => <Notice key={w} tone="warn">{w}</Notice>)}
        {analysis?.fileDuplicate && (
          <Notice tone="warn" title="Ce fichier a déjà été importé">
            Il correspond exactement au document « {analysis.fileDuplicate.name} » de votre bibliothèque.
          </Notice>
        )}
        <FormMessage state={state} />

        <Card>
          <CardHeader title={direction === "income" ? "Facture émise" : "Facture fournisseur"} description={file.name} />
          <div className="grid gap-4 px-5 pb-5 sm:grid-cols-2">
            <Field label={direction === "income" ? "Structure qui a émis la facture" : "Structure qui doit payer"} error={fe("companyId")} htmlFor="companyId">
              <Select id="companyId" name="companyId" value={v.companyId} onChange={(e) => setV((s) => ({ ...s, companyId: e.target.value, activityId: "", accountId: "" }))}>
                {options.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
            <Field label={<>N° de facture<ConfidenceBadge c={conf("number")} /></>} error={fe("number")} htmlFor="number" optional={direction === "expense"}>
              <Input id="number" name="number" value={v.number} onChange={(e) => set("number", e.target.value)} maxLength={60} />
            </Field>

            {direction === "income" ? (
              <>
                <Field label="Client" htmlFor="contactId" hint="Choisissez la fiche existante, ou laissez « Nouveau client » pour la créer avec le nom ci-contre.">
                  <Select id="contactId" name="contactId" value={v.contactId} onChange={(e) => set("contactId", e.target.value)}>
                    <option value="">Nouveau client</option>
                    {options.contacts.map((c) => <option key={c.id} value={c.id}>{c.name}{c.organization ? ` — ${c.organization}` : ""}</option>)}
                  </Select>
                </Field>
                <Field label={<>Nom du client sur la facture<ConfidenceBadge c={conf("recipient")} /></>} error={fe("party")} htmlFor="party">
                  <Input id="party" name="party" value={v.party} onChange={(e) => set("party", e.target.value)} maxLength={200} disabled={!!v.contactId} />
                </Field>
              </>
            ) : (
              <Field label={<>Fournisseur<ConfidenceBadge c={conf("issuer")} /></>} error={fe("party")} htmlFor="party" className="sm:col-span-2">
                <Input id="party" name="party" value={v.party} onChange={(e) => set("party", e.target.value)} maxLength={200} />
              </Field>
            )}

            <Field label={<>{direction === "income" ? "Objet" : "Libellé"}<ConfidenceBadge c={conf("description")} /></>} optional className="sm:col-span-2" htmlFor="description">
              <Input id="description" name="description" value={v.description} onChange={(e) => set("description", e.target.value)} maxLength={200} />
            </Field>
            <Field label={<>Date de la facture<ConfidenceBadge c={conf("issueDate")} /></>} error={fe("issueDate")} htmlFor="issueDate">
              <Input id="issueDate" type="date" name="issueDate" value={v.issueDate} onChange={(e) => set("issueDate", e.target.value)} />
            </Field>
            <Field label={<>Échéance<ConfidenceBadge c={conf("dueDate")} /></>} optional error={fe("dueDate")} htmlFor="dueDate"
              hint={direction === "income" ? "Vide : calculée selon les conditions de paiement de la structure." : "Vide : la date de la facture."}>
              <Input id="dueDate" type="date" name="dueDate" value={v.dueDate} onChange={(e) => set("dueDate", e.target.value)} />
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader title="Montants" />
          <div className="grid gap-4 px-5 pb-5 sm:grid-cols-2">
            <Field label={<>Devise<ConfidenceBadge c={conf("currency")} /></>} error={fe("currency")} htmlFor="currency">
              <Select id="currency" name="currency" value={v.currency} onChange={(e) => set("currency", e.target.value)}>
                {CURRENCY_CODES.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </Field>
            <Field label={<>Total TTC<ConfidenceBadge c={conf("total")} /></>} error={fe("total")} htmlFor="total">
              <Input id="total" name="total" inputMode="decimal" className="tabular" value={v.total} onChange={(e) => set("total", e.target.value)} />
            </Field>
            {direction === "income" && (
              <>
                <Field label={<>Total HT<ConfidenceBadge c={conf("subtotal")} /></>} optional htmlFor="subtotal">
                  <Input id="subtotal" name="subtotal" inputMode="decimal" className="tabular" value={v.subtotal} onChange={(e) => set("subtotal", e.target.value)} />
                </Field>
                <Field label={<>TVA<ConfidenceBadge c={conf("tax")} /></>} optional htmlFor="tax">
                  <Input id="tax" name="tax" inputMode="decimal" className="tabular" value={v.tax} onChange={(e) => set("tax", e.target.value)} />
                </Field>
              </>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Classement" />
          <div className="grid gap-4 px-5 pb-5 sm:grid-cols-2">
            <Field label="Activité" optional htmlFor="activityId">
              <Select id="activityId" name="activityId" value={v.activityId} onChange={(e) => set("activityId", e.target.value)}>
                <option value="">Non affectée</option>
                {activities.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </Select>
            </Field>
            {direction === "income" ? (
              <Field label="Statut" htmlFor="status">
                <Select id="status" name="status" value={v.status} onChange={(e) => set("status", e.target.value)}>
                  <option value="sent">Envoyée au client (à encaisser)</option>
                  <option value="draft">Brouillon</option>
                </Select>
              </Field>
            ) : (
              <Field label={<>Catégorie<ConfidenceBadge c={conf("category")} /></>} optional htmlFor="categoryId">
                <Select id="categoryId" name="categoryId" value={v.categoryId} onChange={(e) => set("categoryId", e.target.value)}>
                  <option value="">Non classée</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
            )}
            {direction === "expense" && (
              <div className="grid gap-4 sm:col-span-2">
                <label className="flex items-center gap-2 text-[13px] text-ink-2">
                  <input type="checkbox" name="alreadyPaid" value="1" checked={v.alreadyPaid} onChange={(e) => set("alreadyPaid", e.target.checked)} className="size-4 accent-[var(--accent)]" />
                  Cette facture est déjà payée
                </label>
                {v.alreadyPaid && (
                  <div className="grid gap-4 sm:grid-cols-3">
                    <Field label="Payée le" error={fe("paidDate")} htmlFor="paidDate">
                      <Input id="paidDate" type="date" name="paidDate" value={v.paidDate} onChange={(e) => set("paidDate", e.target.value)} />
                    </Field>
                    <Field label="Compte débité" error={fe("accountId")} htmlFor="accountId" hint={!accounts.length ? `Aucun compte en ${v.currency} pour cette structure.` : undefined}>
                      <Select id="accountId" name="accountId" value={v.accountId} onChange={(e) => set("accountId", e.target.value)}>
                        <option value="">Choisir…</option>
                        {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                      </Select>
                    </Field>
                    <Field label="Mode" htmlFor="method">
                      <Select id="method" name="method" value={v.method} onChange={(e) => set("method", e.target.value)}>
                        {Object.entries(PAYMENT_METHOD_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                      </Select>
                    </Field>
                  </div>
                )}
              </div>
            )}
          </div>
        </Card>

        <div className="flex flex-wrap items-center gap-2">
          <SubmitButton pendingLabel="Enregistrement…">{confirmDuplicate ? "Confirmer malgré le doublon" : direction === "income" ? "Valider et enregistrer la facture" : "Valider et enregistrer la dépense"}</SubmitButton>
          <button type="button" onClick={onRestart} className={buttonClass("ghost")}>Recommencer avec un autre fichier</button>
        </div>
      </div>

      <aside className="min-w-0 lg:sticky lg:top-24 lg:self-start">
        <Card className="overflow-hidden">
          <CardHeader title="Aperçu du document" description="Comparez avec les champs à gauche." action={<ScanText size={16} className="text-ink-3" aria-hidden />} />
          <div className="border-t border-line bg-surface-2">
            {isImage
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={previewUrl} alt={`Aperçu de ${file.name}`} className="mx-auto max-h-[75vh] w-auto object-contain" />
              : <iframe src={previewUrl} title={`Aperçu de ${file.name}`} className="h-[75vh] w-full" />}
          </div>
        </Card>
      </aside>
    </form>
  );
}
