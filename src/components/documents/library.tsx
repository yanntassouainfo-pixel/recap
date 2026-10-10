"use client";

import { useActionState, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Download, Eye, History, Pencil, UploadCloud, X } from "lucide-react";
import { addVersion, archiveDocument, updateDocument, uploadDocuments } from "@/app/actions/documents";
import { Field, Input, Select, Textarea, buttonClass, cx } from "@/components/ui";
import { FormMessage, SubmitButton } from "@/components/form-bits";
import { Modal } from "@/components/modal";
import { useToast } from "@/components/toast";
import { initialState, type ActionState } from "@/lib/action-state";
import { formatBytes } from "@/lib/templating";
import { ActionButton, FormDialog } from "@/components/crm/dialog";

export interface DocRefs {
  types: Record<string, string>;
  usages: Record<string, string>;
  companies: { id: string; name: string }[];
  activities: { id: string; companyId: string; name: string }[];
  contacts: { id: string; name: string }[];
}

export interface DocLite {
  id: string;
  name: string;
  type: string;
  usage: string;
  companyId: string | null;
  activityId: string | null;
  contactId: string | null;
  description: string | null;
  tags: string | null;
  currentVersion: number;
  archived: boolean;
}

export interface VersionLite {
  version: number;
  fileName: string;
  mimeType: string;
  size: number;
  note: string | null;
  createdAt: string;
}

const MAX_BYTES = 15 * 1024 * 1024;
const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.gif,.svg,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.csv,.zip";
export const PREVIEWABLE = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif", "text/plain"]);

/* ───────── Classement (champs communs) ───────── */

function MetaFields({ refs, values, doc, errors, defaults }: {
  refs: DocRefs;
  values?: Record<string, string>;
  doc?: DocLite;
  errors?: Record<string, string[] | undefined>;
  defaults?: Partial<Record<"usage" | "contactId" | "companyId", string>>;
}) {
  const v = (k: keyof DocLite) => values?.[k] ?? (doc ? String(doc[k] ?? "") : "");
  const [companyId, setCompanyId] = useState(values?.companyId ?? doc?.companyId ?? defaults?.companyId ?? (refs.companies.length === 1 ? refs.companies[0].id : ""));
  const [usage, setUsage] = useState(values?.usage ?? doc?.usage ?? defaults?.usage ?? "reusable");
  const activities = companyId ? refs.activities.filter((a) => a.companyId === companyId) : refs.activities;
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Type de document" htmlFor="doc-type">
          <Select id="doc-type" name="type" defaultValue={v("type") || "other"}>
            {Object.entries(refs.types).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
        </Field>
        <Field label="Usage" htmlFor="doc-usage" hint={usage === "reusable" ? "Proposé dans le composeur d'emails." : usage === "client" ? "Rattaché à la fiche d'un client." : "Pièce justificative de vos comptes."}>
          <Select id="doc-usage" name="usage" value={usage} onChange={(e) => setUsage(e.target.value)}>
            {Object.entries(refs.usages).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
        </Field>
        {refs.companies.length > 1 ? (
          <Field label="Structure" htmlFor="doc-company" optional>
            <Select id="doc-company" name="companyId" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
              <option value="">Toutes mes structures</option>
              {refs.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
        ) : <input type="hidden" name="companyId" value={companyId} />}
        {activities.length > 0 && (
          <Field label="Activité" htmlFor="doc-activity" optional>
            <Select id="doc-activity" name="activityId" defaultValue={v("activityId")}>
              <option value="">—</option>
              {activities.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </Field>
        )}
        <Field label="Client / prospect" htmlFor="doc-contact" optional={usage !== "client"} error={errors?.contactId}>
          <Select id="doc-contact" name="contactId" defaultValue={values?.contactId ?? doc?.contactId ?? defaults?.contactId ?? ""}>
            <option value="">—</option>
            {refs.contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Mots-clés" htmlFor="doc-tags" optional hint="Séparés par des virgules.">
          <Input id="doc-tags" name="tags" defaultValue={v("tags")} placeholder="tarifs 2026, coaching" />
        </Field>
      </div>
      <Field label="Description" htmlFor="doc-desc" optional>
        <Textarea id="doc-desc" name="description" rows={2} defaultValue={v("description")} />
      </Field>
    </>
  );
}

/* ───────── Zone de dépôt ───────── */

function Dropzone({ files, setFiles, multiple = true, inputName = "file" }: { files: File[]; setFiles: (f: File[]) => void; multiple?: boolean; inputName?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  // Garde l'<input type=file> synchronisé avec la sélection (glisser-déposer compris) : c'est lui qui est soumis.
  useEffect(() => {
    if (!input.current) return;
    const dt = new DataTransfer();
    for (const f of files) dt.items.add(f);
    input.current.files = dt.files;
  }, [files]);
  const tooBig = files.filter((f) => f.size > MAX_BYTES);
  return (
    <div>
      <label
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const dropped = [...e.dataTransfer.files];
          if (dropped.length) setFiles(multiple ? [...files, ...dropped] : dropped.slice(0, 1));
        }}
        className={cx("flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors",
          over ? "border-accent bg-accent-soft/40" : "border-line-2 hover:border-ink-3/50 hover:bg-surface-2")}>
        <UploadCloud size={22} className="text-ink-3" aria-hidden />
        <span className="text-[13px] font-medium">Glissez vos fichiers ici ou <span className="underline">parcourez</span></span>
        <span className="text-[12px] text-ink-3">PDF, images, Word, PowerPoint, Excel, texte, CSV, ZIP · 15 Mo maximum par fichier</span>
        <input ref={input} type="file" name={inputName} multiple={multiple} accept={ACCEPT} className="sr-only"
          onChange={(e) => setFiles(multiple ? [...files, ...(e.target.files ? [...e.target.files] : [])].filter((f, i, a) => a.findIndex((x) => x.name === f.name && x.size === f.size) === i) : (e.target.files ? [...e.target.files].slice(0, 1) : []))} />
      </label>
      {files.length > 0 && (
        <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center gap-2 px-3 py-2 text-[12.5px]">
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              <span className={cx("shrink-0 tabular", f.size > MAX_BYTES ? "text-bad" : "text-ink-3")}>{formatBytes(f.size)}{f.size > MAX_BYTES ? " · trop lourd" : ""}</span>
              <button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))} className="rounded p-1 text-ink-3 hover:bg-surface-3 hover:text-ink" aria-label={`Retirer ${f.name}`}><X size={13} /></button>
            </li>
          ))}
        </ul>
      )}
      {tooBig.length > 0 && <p className="mt-1.5 text-[12px] text-bad" role="alert">Retirez les fichiers de plus de 15 Mo avant d&apos;enregistrer.</p>}
    </div>
  );
}

/* ───────── Téléversement ───────── */

function useDone(state: ActionState, onDone: () => void) {
  const toast = useToast();
  const router = useRouter();
  const handled = useRef<ActionState | null>(null);
  useEffect(() => {
    if (state.ok && handled.current !== state) {
      handled.current = state;
      toast(state.message ?? "Enregistré.");
      router.refresh();
      onDone();
    }
  }, [state, toast, router, onDone]);
}

function UploadForm({ refs, initialFiles, defaults, onDone }: { refs: DocRefs; initialFiles: File[]; defaults?: Partial<Record<"usage" | "contactId" | "companyId", string>>; onDone: () => void }) {
  const [state, action] = useActionState(uploadDocuments, initialState);
  const [files, setFiles] = useState<File[]>(initialFiles);
  useDone(state, onDone);
  const blocked = files.length === 0 || files.some((f) => f.size > MAX_BYTES);
  return (
    <form action={action} className="grid gap-4">
      <FormMessage state={state} />
      <Dropzone files={files} setFiles={setFiles} />
      {files.length <= 1 && (
        <Field label="Nom du document" htmlFor="doc-name" optional hint="Par défaut, le nom du fichier.">
          <Input id="doc-name" name="name" defaultValue={state.values?.name} placeholder="Ex. Proposition commerciale — Coaching" />
        </Field>
      )}
      {files.length > 1 && <p className="text-[12.5px] text-ink-3">{files.length} fichiers : chacun devient un document, nommé d&apos;après son fichier, avec le classement ci-dessous.</p>}
      <MetaFields refs={refs} values={state.values} defaults={defaults} errors={state.fieldErrors} />
      <div className="flex justify-end">
        <SubmitButton pendingLabel="Téléversement…" disabled={blocked}>{files.length > 1 ? `Ajouter ${files.length} documents` : "Ajouter le document"}</SubmitButton>
      </div>
    </form>
  );
}

/** Bibliothèque : bouton « Ajouter » + dépôt de fichiers n'importe où sur la zone enveloppée. */
export function UploadArea({ refs, defaults, children, label = "Ajouter des documents", button = true }: { refs: DocRefs; defaults?: Partial<Record<"usage" | "contactId" | "companyId", string>>; children?: ReactNode; label?: string; button?: boolean }) {
  const [open, setOpen] = useState<{ files: File[]; key: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const close = useCallback(() => setOpen(null), []);
  const hasFiles = (e: React.DragEvent) => [...e.dataTransfer.types].includes("Files");
  return (
    <>
      {button && (
        <button type="button" onClick={() => setOpen({ files: [], key: Date.now() })} className={buttonClass("primary", "md")}>
          <UploadCloud size={15} aria-hidden /> {label}
        </button>
      )}
      {children !== undefined && (
        <div
          onDragEnter={(e) => { if (!hasFiles(e)) return; depth.current++; setDragging(true); }}
          onDragLeave={() => { depth.current = Math.max(0, depth.current - 1); if (depth.current === 0) setDragging(false); }}
          onDragOver={(e) => { if (hasFiles(e)) e.preventDefault(); }}
          onDrop={(e) => {
            if (!hasFiles(e)) return;
            e.preventDefault();
            depth.current = 0;
            setDragging(false);
            setOpen({ files: [...e.dataTransfer.files], key: Date.now() });
          }}
          className="relative">
          {children}
          {dragging && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-2xl border-2 border-dashed border-accent bg-accent-soft/60 text-[14px] font-medium text-ink">
              Déposez vos fichiers pour les ajouter à la bibliothèque
            </div>
          )}
        </div>
      )}
      <Modal open={!!open} onClose={close} title="Ajouter des documents" description="Les fichiers sont stockés dans votre espace privé. Chaque nouvelle version conserve l'historique." size="lg">
        {open && <UploadForm key={open.key} refs={refs} initialFiles={open.files} defaults={defaults} onDone={close} />}
      </Modal>
    </>
  );
}

/* ───────── Actions par document ───────── */

export function EditDocumentDialog({ doc, refs }: { doc: DocLite; refs: DocRefs }) {
  return (
    <FormDialog title="Modifier le document" description="Renommer ou reclasser. Le fichier et ses versions ne changent pas." action={updateDocument} size="lg"
      triggerClassName={buttonClass("ghost", "sm", "h-7 px-2")} ariaLabel={`Modifier ${doc.name}`} trigger={<><Pencil size={13} aria-hidden /><span className="sr-only md:not-sr-only">Modifier</span></>}>
      {(s) => (
        <>
          <input type="hidden" name="id" value={doc.id} />
          <Field label="Nom" htmlFor="doc-ename" error={s.fieldErrors?.name}>
            <Input id="doc-ename" name="name" defaultValue={s.values?.name ?? doc.name} required />
          </Field>
          <MetaFields refs={refs} values={s.values} doc={doc} errors={s.fieldErrors} />
          <div className="flex justify-end"><SubmitButton pendingLabel="Enregistrement…">Enregistrer</SubmitButton></div>
        </>
      )}
    </FormDialog>
  );
}

export function VersionsDialog({ doc, versions }: { doc: DocLite; versions: VersionLite[] }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={buttonClass("ghost", "sm", "h-7 px-2")} aria-label={`Versions de ${doc.name}`}>
        <History size={13} aria-hidden /><span className="sr-only md:not-sr-only">v{doc.currentVersion}</span>
      </button>
      <Modal open={open} onClose={close} title={`Versions — ${doc.name}`} description="Chaque version reste consultable. Un email envoyé garde la version exacte qu'il contenait." size="lg">
        {open && (
          <div className="grid gap-5">
            <ul className="divide-y divide-line rounded-xl border border-line">
              {versions.map((v) => (
                <li key={v.version} className="flex flex-col gap-1.5 px-3.5 py-2.5 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-[13px] font-medium">
                      Version {v.version}
                      {v.version === doc.currentVersion && <span className="rounded-full bg-good-soft px-1.5 text-[11px] font-medium text-good">Actuelle</span>}
                    </div>
                    <div className="truncate text-[12px] text-ink-3">{v.fileName} · {formatBytes(v.size)} · {new Date(v.createdAt).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })}{v.note ? ` · ${v.note}` : ""}</div>
                  </div>
                  <div className="flex gap-1">
                    {PREVIEWABLE.has(v.mimeType) && <a href={`/api/documents/${doc.id}?v=${v.version}&inline=1`} target="_blank" rel="noopener" className={buttonClass("ghost", "sm", "h-7 px-2")}><Eye size={13} aria-hidden /> Voir</a>}
                    <a href={`/api/documents/${doc.id}?v=${v.version}`} className={buttonClass("ghost", "sm", "h-7 px-2")}><Download size={13} aria-hidden /> Télécharger</a>
                  </div>
                </li>
              ))}
            </ul>
            {!doc.archived && <NewVersionForm id={doc.id} onDone={close} />}
          </div>
        )}
      </Modal>
    </>
  );
}

function NewVersionForm({ id, onDone }: { id: string; onDone: () => void }) {
  const [state, action] = useActionState(addVersion, initialState);
  const [files, setFiles] = useState<File[]>([]);
  useDone(state, onDone);
  return (
    <form action={action} className="grid gap-3 rounded-xl bg-surface-2 p-4">
      <h3 className="text-[13.5px] font-semibold">Déposer une nouvelle version</h3>
      <FormMessage state={state} />
      <input type="hidden" name="id" value={id} />
      <Dropzone files={files} setFiles={setFiles} multiple={false} />
      <Field label="Ce qui change" htmlFor="v-note" optional>
        <Input id="v-note" name="note" placeholder="Ex. Tarifs 2026 mis à jour" />
      </Field>
      <div className="flex justify-end"><SubmitButton size="sm" pendingLabel="Enregistrement…" disabled={files.length === 0 || files[0].size > MAX_BYTES}>Enregistrer la version</SubmitButton></div>
    </form>
  );
}

export function PreviewButton({ doc, mimeType, fileName }: { doc: { id: string; name: string; currentVersion: number }; mimeType: string; fileName: string }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  if (!PREVIEWABLE.has(mimeType)) return null;
  const src = `/api/documents/${doc.id}?v=${doc.currentVersion}&inline=1`;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={buttonClass("ghost", "sm", "h-7 px-2")} aria-label={`Aperçu de ${doc.name}`}>
        <Eye size={13} aria-hidden /><span className="sr-only md:not-sr-only">Aperçu</span>
      </button>
      <Modal open={open} onClose={close} title={doc.name} description={fileName} size="xl">
        {open && (
          <div className="grid gap-3">
            {mimeType.startsWith("image/") ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={src} alt={`Aperçu de ${doc.name}`} className="mx-auto max-h-[70dvh] rounded-lg border border-line object-contain" />
            ) : (
              <iframe src={src} title={`Aperçu de ${doc.name}`} className="h-[70dvh] w-full rounded-lg border border-line bg-white" />
            )}
            <div className="flex justify-end gap-2">
              <a href={src} target="_blank" rel="noopener" className={buttonClass("ghost", "sm")}>Ouvrir dans un onglet</a>
              <a href={`/api/documents/${doc.id}?v=${doc.currentVersion}`} className={buttonClass("secondary", "sm")}><Download size={14} aria-hidden /> Télécharger</a>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

export function ArchiveDocumentButton({ id, archived }: { id: string; archived: boolean }) {
  return (
    <ActionButton className={buttonClass("ghost", "sm", "h-7 px-2")} title={archived ? "Restaurer" : "Archiver"}
      confirm={archived ? undefined : "Archiver ce document ? Il ne sera plus proposé dans le composeur, mais reste consultable (et les emails déjà envoyés gardent leur pièce jointe)."}
      run={() => archiveDocument(id, !archived)}>
      {archived ? <ArchiveRestore size={13} aria-hidden /> : <Archive size={13} aria-hidden />}
      <span className="sr-only md:not-sr-only">{archived ? "Restaurer" : "Archiver"}</span>
    </ActionButton>
  );
}
