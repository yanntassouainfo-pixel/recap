"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, FileText, Paperclip, Search, Send, UploadCloud, X } from "lucide-react";
import { submitEmail } from "@/app/actions/emails";
import { Field, Input, Notice, Select, Textarea, buttonClass, cx } from "@/components/ui";
import { FormMessage, SubmitButton } from "@/components/form-bits";
import { useToast } from "@/components/toast";
import { initialState } from "@/lib/action-state";
import {
  TEMPLATE_VARIABLES, buildTemplateVars, formatBytes, normalizeVarName, parseAddressList, renderTemplate, unresolvedVariables,
} from "@/lib/templating";

export interface ComposerData {
  mailerConfigured: boolean;
  companies: { id: string; name: string; legalName: string | null; phone: string | null; website: string | null }[];
  identities: { id: string; companyId: string; fromName: string; fromEmail: string; authorized: boolean }[];
  contacts: { id: string; name: string; organization: string | null; email: string | null; activityId: string | null; companyId: string | null }[];
  activities: { id: string; companyId: string; name: string }[];
  templates: { id: string; purpose: string; purposeLabel: string; name: string; subject: string; body: string; companyId: string | null; activityId: string | null; defaultDocumentIds: string[] }[];
  documents: { id: string; name: string; typeLabel: string; usage: string; companyId: string | null; contactId: string | null; currentVersion: number; versions: { version: number; size: number; fileName: string }[] }[];
  invoices: { id: string; label: string; docType: string; contactId: string | null; companyId: string; number: string; totalLabel: string; remainingLabel: string | null; dueDateLabel: string }[];
}

export interface ComposerInitial {
  emailId?: string;
  companyId: string;
  senderIdentityId: string;
  contactId: string;
  activityId: string;
  templateId: string;
  invoiceId: string;
  to: string;
  cc: string;
  subject: string;
  body: string;
  docs: Record<string, number>;
  includeInvoicePdf: boolean;
  /** Le modèle doit être appliqué à l'ouverture (nouveau message). */
  applyTemplate: boolean;
}

const MAX_FILE = 15 * 1024 * 1024;
const MAX_TOTAL = 20 * 1024 * 1024;
const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.gif,.svg,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.csv,.zip";
const INVOICE_PURPOSES = new Set(["invoice", "quote", "invoice_reminder"]);

export function Composer({ data, initial }: { data: ComposerData; initial: ComposerInitial }) {
  const router = useRouter();
  const toast = useToast();
  const [state, action] = useActionState(submitEmail, initialState);

  const [companyId, setCompanyId] = useState(initial.companyId);
  const [identityId, setIdentityId] = useState(initial.senderIdentityId);
  const [contactId, setContactId] = useState(initial.contactId);
  const [activityId, setActivityId] = useState(initial.activityId);
  const [templateId, setTemplateId] = useState(initial.templateId);
  const [invoiceId, setInvoiceId] = useState(initial.invoiceId);
  const [includePdf, setIncludePdf] = useState(initial.includeInvoicePdf);
  const [to, setTo] = useState(initial.to);
  const [cc, setCc] = useState(initial.cc);
  const [docs, setDocs] = useState<Record<string, number>>(initial.docs);
  const [files, setFiles] = useState<File[]>([]);
  const [docQuery, setDocQuery] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const company = data.companies.find((c) => c.id === companyId);
  const identities = data.identities.filter((i) => i.companyId === companyId);
  const identity = data.identities.find((i) => i.id === identityId && i.companyId === companyId);
  const contact = data.contacts.find((c) => c.id === contactId);
  const activities = data.activities.filter((a) => a.companyId === companyId);
  const template = data.templates.find((t) => t.id === templateId);
  const invoices = data.invoices.filter((i) => i.companyId === companyId && (!contactId || i.contactId === contactId));
  const invoice = data.invoices.find((i) => i.id === invoiceId);

  const vars = useMemo(() => buildTemplateVars({
    contact: contact ? { name: contact.name, organization: contact.organization } : null,
    activityName: data.activities.find((a) => a.id === activityId)?.name ?? null,
    invoice: invoice ? {
      number: invoice.number,
      amountLabel: template?.purpose === "invoice_reminder" && invoice.remainingLabel ? invoice.remainingLabel : invoice.totalLabel,
      dueDateLabel: invoice.dueDateLabel,
    } : null,
    sender: identity ? { fromName: identity.fromName, companyName: company?.legalName || company?.name, email: identity.fromEmail, phone: company?.phone, website: company?.website } : null,
  }), [contact, activityId, invoice, identity, company, template?.purpose, data.activities]);

  // Texte : tant que l'utilisateur n'a pas retouché le message, il suit le modèle (et ses variables).
  const initialRender = () => {
    if (initial.applyTemplate && template) {
      return { subject: renderTemplate(template.subject, vars).text, body: renderTemplate(template.body, vars).text };
    }
    return { subject: initial.subject, body: initial.body };
  };
  const [text, setText] = useState(initialRender);
  const [edited, setEdited] = useState(!initial.applyTemplate);
  useEffect(() => {
    if (edited || !template) return;
    setText({ subject: renderTemplate(template.subject, vars).text, body: renderTemplate(template.body, vars).text });
  }, [vars, template, edited]);

  const applyTemplate = (id: string) => {
    const t = data.templates.find((x) => x.id === id);
    if (edited && (text.subject || text.body) && t && !window.confirm("Remplacer l'objet et le message actuels par ce modèle ?")) return;
    setTemplateId(id);
    if (!t) return;
    setEdited(false);
    if (t.defaultDocumentIds.length) {
      const next = { ...docs };
      for (const d of t.defaultDocumentIds) {
        const doc = data.documents.find((x) => x.id === d);
        if (doc && !(d in next)) next[d] = doc.currentVersion;
      }
      setDocs(next);
    }
    if (INVOICE_PURPOSES.has(t.purpose) && !invoiceId && invoices.length === 1) {
      setInvoiceId(invoices[0].id);
      setIncludePdf(true);
    }
    if (t.activityId && !activityId) setActivityId(t.activityId);
  };

  const chooseContact = (id: string) => {
    const prevEmail = contact?.email?.toLowerCase() ?? "";
    const next = data.contacts.find((c) => c.id === id);
    setContactId(id);
    if (!to.trim() || to.trim().toLowerCase() === prevEmail) setTo(next?.email ?? "");
    if (next?.activityId && !activityId && data.activities.some((a) => a.id === next.activityId && a.companyId === companyId)) setActivityId(next.activityId);
    if (invoiceId && data.invoices.find((i) => i.id === invoiceId)?.contactId !== id) { setInvoiceId(""); setIncludePdf(false); }
  };

  const chooseCompany = (id: string) => {
    setCompanyId(id);
    const ids = data.identities.filter((i) => i.companyId === id);
    setIdentityId((ids.find((i) => i.authorized) ?? ids[0])?.id ?? "");
    if (activityId && !data.activities.some((a) => a.id === activityId && a.companyId === id)) setActivityId("");
    if (invoiceId && data.invoices.find((i) => i.id === invoiceId)?.companyId !== id) { setInvoiceId(""); setIncludePdf(false); }
  };

  // Le champ fichier reste synchronisé avec la liste (c'est lui qui est soumis).
  useEffect(() => {
    if (!fileInput.current) return;
    const dt = new DataTransfer();
    for (const f of files) dt.items.add(f);
    fileInput.current.files = dt.files;
  }, [files]);

  // Après enregistrement : on ouvre l'email (son statut y est affiché tel que confirmé par le serveur).
  const handled = useRef<typeof state | null>(null);
  useEffect(() => {
    if (handled.current === state || !state.id) return;
    handled.current = state;
    if (state.ok) toast(state.warning ?? state.message ?? "Enregistré.", state.warning ? "warn" : "good");
    else if (state.error) toast(state.error, "bad");
    router.push(`/emails/${state.id}`);
    router.refresh();
  }, [state, toast, router]);

  const docRows = data.documents.filter((d) => d.usage === "reusable" || (contactId && d.contactId === contactId) || d.id in docs);
  const q = docQuery.trim().toLowerCase();
  const visibleDocs = docRows
    .filter((d) => !d.companyId || d.companyId === companyId || d.id in docs)
    .filter((d) => !q || d.name.toLowerCase().includes(q) || d.typeLabel.toLowerCase().includes(q));
  const docSize = Object.entries(docs).reduce((s, [id, v]) => s + (data.documents.find((d) => d.id === id)?.versions.find((x) => x.version === v)?.size ?? 0), 0);
  const fileSize = files.reduce((s, f) => s + f.size, 0);
  const total = docSize + fileSize;
  const attachCount = Object.keys(docs).length + files.length + (invoiceId && includePdf ? 1 : 0);

  const unresolved = [...new Set([...unresolvedVariables(text.subject), ...unresolvedVariables(text.body)])];
  const missingLabels = unresolved.map((v) => TEMPLATE_VARIABLES[normalizeVarName(v)] ? `{{${v}}} (${TEMPLATE_VARIABLES[normalizeVarName(v)].toLowerCase()})` : `{{${v}}} (variable inconnue)`);
  const toParsed = parseAddressList(to);
  const ccParsed = parseAddressList(cc);

  const sendBlockers: string[] = [];
  if (!data.mailerConfigured) sendBlockers.push("l'envoi d'emails n'est pas configuré sur le serveur");
  if (!identity) sendBlockers.push("aucune adresse d'expédition n'est choisie");
  else if (!identity.authorized) sendBlockers.push(`l'adresse ${identity.fromEmail} n'est pas encore autorisée`);
  if (!toParsed.valid.length) sendBlockers.push("aucun destinataire valide");
  if (total > MAX_TOTAL) sendBlockers.push("les pièces jointes dépassent 20 Mo");
  if (files.some((f) => f.size > MAX_FILE)) sendBlockers.push("un fichier dépasse 15 Mo");

  return (
    <form action={action} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      {initial.emailId && <input type="hidden" name="emailId" value={initial.emailId} />}
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="senderIdentityId" value={identity?.id ?? ""} />
      <input type="hidden" name="contactId" value={contactId} />
      <input type="hidden" name="activityId" value={activityId} />
      <input type="hidden" name="templateId" value={templateId} />
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <input type="hidden" name="includeInvoicePdf" value={invoiceId && includePdf ? "1" : "0"} />
      {Object.entries(docs).map(([id, v]) => <input key={id} type="hidden" name="doc" value={`${id}:${v}`} />)}

      <div className="min-w-0 space-y-5">
        <FormMessage state={state} />
        {!data.mailerConfigured && (
          <Notice tone="warn" title="Envoi non configuré">
            Aucun serveur d&apos;envoi (SMTP) n&apos;est configuré : vous pouvez préparer et enregistrer ce message en brouillon, mais il ne sera pas envoyé. <Link href="/parametres#emails" className="underline">Voir les paramètres</Link>
          </Notice>
        )}
        {data.mailerConfigured && identity && !identity.authorized && (
          <Notice tone="warn" title="Adresse d'expédition non autorisée">
            Autorisez {identity.fromEmail} dans <Link href="/parametres#emails" className="underline">Paramètres → Emails</Link> pour pouvoir envoyer. En attendant, enregistrez un brouillon.
          </Notice>
        )}

        <div className="card space-y-4 p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            {data.companies.length > 1 ? (
              <Field label="Structure expéditrice" htmlFor="em-company" error={state.fieldErrors?.companyId}>
                <Select id="em-company" value={companyId} onChange={(e) => chooseCompany(e.target.value)}>
                  {data.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
            ) : null}
            <Field label="De" htmlFor="em-from" error={state.fieldErrors?.senderIdentityId}
              hint={identities.length === 0 ? <>Aucune adresse pour cette structure. <Link href="/parametres#emails" className="underline">En ajouter une</Link></> : undefined}>
              <Select id="em-from" value={identity?.id ?? ""} onChange={(e) => setIdentityId(e.target.value)} disabled={identities.length === 0}>
                {identities.length === 0 && <option value="">Aucune adresse d&apos;expédition</option>}
                {identities.map((i) => <option key={i.id} value={i.id}>{i.fromName} &lt;{i.fromEmail}&gt;{i.authorized ? "" : " — non autorisée"}</option>)}
              </Select>
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Client / prospect" htmlFor="em-contact" optional>
              <Select id="em-contact" value={contactId} onChange={(e) => chooseContact(e.target.value)}>
                <option value="">— Aucun —</option>
                {data.contacts.map((c) => <option key={c.id} value={c.id}>{c.name}{c.organization ? ` — ${c.organization}` : ""}{c.email ? "" : " (sans email)"}</option>)}
              </Select>
            </Field>
            <Field label="Modèle" htmlFor="em-template" optional>
              <Select id="em-template" value={templateId} onChange={(e) => applyTemplate(e.target.value)}>
                <option value="">— Message libre —</option>
                {data.templates.filter((t) => !t.companyId || t.companyId === companyId).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            </Field>
          </div>

          <Field label="À" htmlFor="em-to" error={state.fieldErrors?.to ?? (toParsed.invalid.length ? `Adresse invalide : ${toParsed.invalid.join(", ")}` : undefined)} hint="Plusieurs adresses : séparez-les par une virgule.">
            <Input id="em-to" name="to" value={to} onChange={(e) => setTo(e.target.value)} placeholder="client@exemple.ci" autoComplete="off" />
          </Field>
          <Field label="Cc" htmlFor="em-cc" optional error={state.fieldErrors?.cc ?? (ccParsed.invalid.length ? `Adresse invalide : ${ccParsed.invalid.join(", ")}` : undefined)}>
            <Input id="em-cc" name="cc" value={cc} onChange={(e) => setCc(e.target.value)} autoComplete="off" />
          </Field>
          <Field label="Objet" htmlFor="em-subject" error={state.fieldErrors?.subject}>
            <Input id="em-subject" name="subject" value={text.subject} onChange={(e) => { setEdited(true); setText((t) => ({ ...t, subject: e.target.value })); }} />
          </Field>
          <Field label="Message" htmlFor="em-body" error={state.fieldErrors?.body}>
            <Textarea id="em-body" name="body" rows={14} value={text.body} onChange={(e) => { setEdited(true); setText((t) => ({ ...t, body: e.target.value })); }} className="font-[inherit] leading-relaxed" />
          </Field>
          {missingLabels.length > 0 && (
            <div className="flex gap-2.5 rounded-xl bg-warn-soft/70 px-3.5 py-2.5 text-[12.5px] text-ink-2" role="status">
              <AlertTriangle size={15} className="mt-0.5 shrink-0 text-warn" aria-hidden />
              <div>
                <span className="font-medium text-ink">Informations manquantes dans le texte : </span>{missingLabels.join(", ")}.
                <span className="block text-ink-3">Elles resteront telles quelles si vous envoyez. Choisissez le contact, la facture ou l&apos;activité concernés, ou complétez le texte à la main.</span>
              </div>
            </div>
          )}
          {template && edited && (
            <button type="button" onClick={() => { setEdited(false); }} className={buttonClass("ghost", "sm", "-ml-3")}>Réappliquer le modèle « {template.name} »</button>
          )}
        </div>
      </div>

      <aside className="space-y-5">
        <div className="card p-5">
          <h2 className="mb-3 flex items-center justify-between text-[14px] font-semibold">
            <span className="flex items-center gap-2"><Paperclip size={15} aria-hidden /> Pièces jointes</span>
            <span className={cx("text-[12px] font-normal tabular", total > MAX_TOTAL ? "text-bad" : "text-ink-3")}>{attachCount} · {formatBytes(total)} / 20 Mo</span>
          </h2>

          {activities.length > 0 && (
            <Field label="Activité concernée" htmlFor="em-activity" optional className="mb-3">
              <Select id="em-activity" value={activityId} onChange={(e) => setActivityId(e.target.value)}>
                <option value="">—</option>
                {activities.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </Select>
            </Field>
          )}

          <Field label="Facture ou devis" htmlFor="em-invoice" optional className="mb-3"
            hint={invoices.length === 0 ? (contactId ? "Aucune facture ni devis pour ce contact dans cette structure." : "Choisissez un contact pour voir ses factures.") : undefined}>
            <Select id="em-invoice" value={invoiceId} onChange={(e) => { setInvoiceId(e.target.value); setIncludePdf(!!e.target.value); }} disabled={invoices.length === 0 && !invoiceId}>
              <option value="">—</option>
              {invoices.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
            </Select>
          </Field>
          {invoice && (
            <label className="mb-4 flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={includePdf} onChange={(e) => setIncludePdf(e.target.checked)} className="size-4 accent-[var(--ink)]" />
              Joindre le PDF {invoice.docType === "quote" ? "du devis" : "de la facture"} {invoice.number}
            </label>
          )}

          <div className="mb-2 text-[12.5px] font-medium text-ink-2">Depuis la bibliothèque</div>
          {docRows.length > 6 && (
            <div className="relative mb-2">
              <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" aria-hidden />
              <input value={docQuery} onChange={(e) => setDocQuery(e.target.value)} placeholder="Filtrer les documents…" aria-label="Filtrer les documents" className="field-input h-8 pl-8 text-[12.5px]" />
            </div>
          )}
          {visibleDocs.length === 0 ? (
            <p className="text-[12.5px] text-ink-3">Aucun document disponible. <Link href="/documents" className="underline">Alimentez votre bibliothèque</Link> pour joindre vos fichiers en un clic.</p>
          ) : (
            <ul className="max-h-[300px] space-y-1 overflow-y-auto pr-1">
              {visibleDocs.map((d) => {
                const checked = d.id in docs;
                const v = docs[d.id] ?? d.currentVersion;
                const size = d.versions.find((x) => x.version === v)?.size ?? 0;
                return (
                  <li key={d.id} className={cx("rounded-lg px-2 py-1.5", checked && "bg-surface-2")}>
                    <label className="flex items-start gap-2 text-[13px]">
                      <input type="checkbox" checked={checked} className="mt-0.5 size-4 shrink-0 accent-[var(--ink)]"
                        onChange={(e) => {
                          const next = { ...docs };
                          if (e.target.checked) next[d.id] = d.currentVersion; else delete next[d.id];
                          setDocs(next);
                        }} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{d.name}</span>
                        <span className="text-[11.5px] text-ink-3">{d.typeLabel} · {formatBytes(size)}</span>
                      </span>
                    </label>
                    {checked && d.versions.length > 1 && (
                      <select value={v} onChange={(e) => setDocs({ ...docs, [d.id]: Number(e.target.value) })} aria-label={`Version de ${d.name}`}
                        className="field-input ml-6 mt-1 h-7 w-auto py-0 text-[12px]">
                        {d.versions.map((x) => <option key={x.version} value={x.version}>Version {x.version}{x.version === d.currentVersion ? " (actuelle)" : ""}</option>)}
                      </select>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          <div className="mb-2 mt-4 text-[12.5px] font-medium text-ink-2">Depuis l&apos;ordinateur</div>
          <label
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); setFiles([...files, ...e.dataTransfer.files]); }}
            className="flex cursor-pointer items-center gap-2 rounded-xl border-2 border-dashed border-line-2 px-3 py-3 text-[12.5px] text-ink-2 hover:border-ink-3/50 hover:bg-surface-2">
            <UploadCloud size={16} className="text-ink-3" aria-hidden />
            Glissez un fichier ou <span className="underline">parcourez</span>
            <input ref={fileInput} type="file" name="file" multiple accept={ACCEPT} className="sr-only"
              onChange={(e) => setFiles([...files, ...(e.target.files ? [...e.target.files] : [])].filter((f, i, a) => a.findIndex((x) => x.name === f.name && x.size === f.size) === i))} />
          </label>
          {files.length > 0 && (
            <ul className="mt-2 space-y-1">
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex items-center gap-2 text-[12.5px]">
                  <FileText size={13} className="shrink-0 text-ink-3" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{f.name}</span>
                  <span className={cx("tabular", f.size > MAX_FILE ? "text-bad" : "text-ink-3")}>{formatBytes(f.size)}</span>
                  <button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))} className="rounded p-0.5 text-ink-3 hover:text-ink" aria-label={`Retirer ${f.name}`}><X size={13} /></button>
                </li>
              ))}
            </ul>
          )}
          {files.length > 0 && <p className="mt-2 text-[11.5px] text-ink-3">Ces fichiers seront aussi classés dans vos documents{contact ? `, sur la fiche de ${contact.name}` : ""}.</p>}
        </div>

        <div className="card space-y-3 p-5">
          {sendBlockers.length > 0 && (
            <p className="text-[12.5px] text-ink-3">Envoi impossible pour l&apos;instant : {sendBlockers.join(" ; ")}.</p>
          )}
          <SubmitButton name="intent" value="send" pendingLabel="Envoi en cours…" disabled={sendBlockers.length > 0} className="w-full">
            <Send size={15} aria-hidden /> Envoyer
          </SubmitButton>
          <SubmitButton name="intent" value="draft" variant="secondary" pendingLabel="Enregistrement…" className="w-full" disabled={total > MAX_TOTAL || files.some((f) => f.size > MAX_FILE)}>
            Enregistrer le brouillon
          </SubmitButton>
          <p className="text-[11.5px] text-ink-3">Un email n&apos;est marqué « envoyé » qu&apos;après confirmation du serveur d&apos;envoi. Les pièces jointes sont figées à la version choisie.</p>
        </div>
      </aside>
    </form>
  );
}
