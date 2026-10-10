"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, BellRing, CalendarPlus, Loader2, Pencil, UserCheck } from "lucide-react";
import { addInteraction, archiveContact, convertToClient, setFollowUp, updateContact } from "@/app/actions/crm";
import { Field, Input, Select, Textarea, buttonClass, cx } from "@/components/ui";
import { SubmitButton } from "@/components/form-bits";
import { useToast } from "@/components/toast";
import { INTERACTION_TYPES } from "@/lib/labels";
import { ActionButton, FormDialog } from "./dialog";

export interface ContactLite {
  id: string;
  type: string;
  name: string;
  organization: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  companyId: string | null;
  brandId: string | null;
  activityId: string | null;
  needs: string | null;
  notes: string | null;
  source: string | null;
  nextFollowUpAt: string | null;
  archived: boolean;
}

export interface RefOptions {
  companies: { id: string; name: string }[];
  brands: { id: string; companyId: string; name: string }[];
  activities: { id: string; companyId: string; name: string }[];
}

export function ConvertButton({ id }: { id: string }) {
  return (
    <ActionButton className={buttonClass("secondary", "sm")} pendingLabel="Conversion…"
      confirm="Transformer ce prospect en client ? L'événement sera inscrit dans l'historique."
      run={async () => { await convertToClient(id); return { ok: true, message: "La fiche est désormais une fiche client." }; }}>
      <UserCheck size={14} aria-hidden /> Transformer en client
    </ActionButton>
  );
}

export function ArchiveButton({ id, archived }: { id: string; archived: boolean }) {
  return (
    <ActionButton className={buttonClass(archived ? "secondary" : "ghost", "sm")}
      confirm={archived ? undefined : "Archiver cette fiche ? Elle n'apparaîtra plus dans les listes, mais son historique est conservé."}
      run={async () => { await archiveContact(id, !archived); return { ok: true, message: archived ? "Fiche restaurée." : "Fiche archivée. Retrouvez-la dans le filtre « Archivés »." }; }}>
      {archived ? <><ArchiveRestore size={14} aria-hidden /> Restaurer</> : <><Archive size={14} aria-hidden /> Archiver</>}
    </ActionButton>
  );
}

/** Programmer / modifier / retirer la prochaine relance. */
export function FollowUpControl({ id, current, today }: { id: string; current: string | null; today: string }) {
  const [date, setDate] = useState(current ?? "");
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const save = (value: string | null) => start(async () => {
    await setFollowUp(id, value);
    toast(value ? "Relance programmée." : "Relance retirée.");
    router.refresh();
  });
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (/^\d{4}-\d{2}-\d{2}$/.test(date)) save(date); }}>
      <label className="grid gap-1 text-[12px] font-medium text-ink-2">
        Prochaine relance
        <Input type="date" value={date} min={today} onChange={(e) => setDate(e.target.value)} className="h-8 w-[150px] text-[13px]" aria-label="Date de la prochaine relance" />
      </label>
      <button type="submit" disabled={pending || !date || date === current} className={buttonClass("secondary", "sm")}>
        {pending ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <BellRing size={14} aria-hidden />} Programmer
      </button>
      {current && (
        <button type="button" disabled={pending} onClick={() => { setDate(""); save(null); }} className={buttonClass("ghost", "sm")}>Retirer</button>
      )}
    </form>
  );
}

const EVENT_TYPES = Object.entries(INTERACTION_TYPES).filter(([k]) => k !== "converted" && k !== "email_sent");

export function InteractionDialog({ contactId, today }: { contactId: string; today: string }) {
  return (
    <FormDialog title="Ajouter un événement" description="Rendez-vous, appel, contrat signé… L'historique de la relation reste complet."
      action={addInteraction} triggerClassName={buttonClass("secondary", "sm")} trigger={<><CalendarPlus size={14} aria-hidden /> Ajouter un événement</>}>
      {(s) => {
        const v = s.values ?? {};
        return (
          <>
            <input type="hidden" name="contactId" value={contactId} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Type d'événement" htmlFor="ix-type">
                <Select id="ix-type" name="type" defaultValue={v.type ?? "meeting"}>
                  {EVENT_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </Select>
              </Field>
              <Field label="Date" htmlFor="ix-date">
                <Input id="ix-date" name="date" type="date" defaultValue={v.date ?? today} required />
              </Field>
            </div>
            <Field label="Titre" htmlFor="ix-title" optional hint="Par défaut, le type d'événement.">
              <Input id="ix-title" name="title" defaultValue={v.title} placeholder="Ex. Rendez-vous de cadrage" />
            </Field>
            <Field label="Détails" htmlFor="ix-details" optional>
              <Textarea id="ix-details" name="details" rows={3} defaultValue={v.details} placeholder="Ce qui a été dit, décidé, promis…" />
            </Field>
            <Field label="Prochaine relance" htmlFor="ix-follow" optional hint="Laissez vide pour conserver la relance actuelle.">
              <Input id="ix-follow" name="nextFollowUpAt" type="date" defaultValue={v.nextFollowUpAt} min={today} />
            </Field>
            <div className="flex justify-end"><SubmitButton pendingLabel="Enregistrement…">Ajouter à l&apos;historique</SubmitButton></div>
          </>
        );
      }}
    </FormDialog>
  );
}

/** Champs masqués reprenant toute la fiche : updateContact relit chaque champ. */
function HiddenContact({ c, except }: { c: ContactLite; except: string[] }) {
  const fields: [string, string | null][] = [
    ["type", c.type], ["name", c.name], ["organization", c.organization], ["email", c.email], ["phone", c.phone], ["address", c.address],
    ["companyId", c.companyId], ["brandId", c.brandId], ["activityId", c.activityId], ["needs", c.needs], ["notes", c.notes], ["source", c.source],
    ["nextFollowUpAt", c.nextFollowUpAt],
  ];
  return <>{fields.filter(([k]) => !except.includes(k)).map(([k, v]) => <input key={k} type="hidden" name={k} value={v ?? ""} />)}</>;
}

export function EditContactDialog({ contact, refs }: { contact: ContactLite; refs: RefOptions }) {
  return (
    <FormDialog title="Modifier la fiche" action={updateContact} size="lg" triggerClassName={buttonClass("ghost", "sm")} trigger={<><Pencil size={14} aria-hidden /> Modifier la fiche</>}>
      {(s) => <EditContactFields contact={contact} refs={refs} values={s.values} errors={s.fieldErrors} />}
    </FormDialog>
  );
}

function EditContactFields({ contact, refs, values, errors }: { contact: ContactLite; refs: RefOptions; values?: Record<string, string>; errors?: Record<string, string[] | undefined> }) {
  const v = values ?? Object.fromEntries(Object.entries(contact).map(([k, x]) => [k, x == null ? "" : String(x)]));
  const [companyId, setCompanyId] = useState(v.companyId ?? "");
  const activities = companyId ? refs.activities.filter((a) => a.companyId === companyId) : refs.activities;
  const brands = companyId ? refs.brands.filter((b) => b.companyId === companyId) : refs.brands;
  return (
    <>
      <input type="hidden" name="id" value={contact.id} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Type de fiche" htmlFor="ct-type" hint={contact.type === "client" ? "Un client ne redevient pas prospect." : undefined}>
          <Select id="ct-type" name="type" defaultValue={v.type}>
            <option value="prospect" disabled={contact.type === "client"}>Prospect</option>
            <option value="client">Client</option>
            <option value="supplier">Fournisseur</option>
          </Select>
        </Field>
        <Field label="Nom ou raison sociale" htmlFor="ct-name" error={errors?.name}>
          <Input id="ct-name" name="name" defaultValue={v.name} required />
        </Field>
        <Field label="Organisation" htmlFor="ct-org" optional><Input id="ct-org" name="organization" defaultValue={v.organization} /></Field>
        <Field label="Email" htmlFor="ct-email" optional error={errors?.email}><Input id="ct-email" name="email" type="email" defaultValue={v.email} /></Field>
        <Field label="Téléphone" htmlFor="ct-phone" optional><Input id="ct-phone" name="phone" type="tel" defaultValue={v.phone} /></Field>
        <Field label="Adresse" htmlFor="ct-address" optional><Input id="ct-address" name="address" defaultValue={v.address} /></Field>
        {refs.companies.length > 0 && (
          <Field label="Structure concernée" htmlFor="ct-company" optional>
            <Select id="ct-company" name="companyId" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
              <option value="">—</option>
              {refs.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
        )}
        {brands.length > 0 && (
          <Field label="Enseigne" htmlFor="ct-brand" optional>
            <Select id="ct-brand" name="brandId" defaultValue={v.brandId}>
              <option value="">—</option>
              {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          </Field>
        )}
        {activities.length > 0 && (
          <Field label="Activité / prestation" htmlFor="ct-activity" optional>
            <Select id="ct-activity" name="activityId" defaultValue={v.activityId}>
              <option value="">—</option>
              {activities.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </Field>
        )}
        <Field label="Origine du contact" htmlFor="ct-source" optional><Input id="ct-source" name="source" defaultValue={v.source} /></Field>
        <Field label="Prochaine relance" htmlFor="ct-follow" optional><Input id="ct-follow" name="nextFollowUpAt" type="date" defaultValue={v.nextFollowUpAt} /></Field>
      </div>
      <Field label="Besoins exprimés" htmlFor="ct-needs" optional><Textarea id="ct-needs" name="needs" rows={3} defaultValue={v.needs} /></Field>
      <Field label="Notes internes" htmlFor="ct-notes" optional hint="Visibles uniquement par vous."><Textarea id="ct-notes" name="notes" rows={3} defaultValue={v.notes} /></Field>
      <div className="flex justify-end"><SubmitButton pendingLabel="Enregistrement…">Enregistrer la fiche</SubmitButton></div>
    </>
  );
}

/** Notes internes modifiables sur place. */
export function NotesEditor({ contact }: { contact: ContactLite }) {
  const [editing, setEditing] = useState(false);
  if (!editing) {
    return (
      <div>
        {contact.notes ? <p className="whitespace-pre-wrap text-[13.5px] text-ink-2">{contact.notes}</p> : <p className="text-[13px] text-ink-3">Aucune note. Consignez ici le contexte utile : interlocuteurs, préférences, points d&apos;attention.</p>}
        <button type="button" onClick={() => setEditing(true)} className={cx(buttonClass("ghost", "sm"), "mt-2 -ml-3")}><Pencil size={13} aria-hidden /> {contact.notes ? "Modifier les notes" : "Ajouter une note"}</button>
      </div>
    );
  }
  return <NotesForm contact={contact} onDone={() => setEditing(false)} />;
}

function NotesForm({ contact, onDone }: { contact: ContactLite; onDone: () => void }) {
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  return (
    <form className="grid gap-2" onSubmit={(e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      start(async () => {
        const r = await updateContact({}, fd);
        if (r.ok) { toast("Notes enregistrées."); router.refresh(); onDone(); }
        else setError(r.error ?? Object.values(r.fieldErrors ?? {})[0]?.[0] ?? "Enregistrement impossible.");
      });
    }}>
      <input type="hidden" name="id" value={contact.id} />
      <HiddenContact c={contact} except={["notes"]} />
      <Textarea name="notes" rows={5} defaultValue={contact.notes ?? ""} autoFocus aria-label="Notes internes" />
      {error && <p className="text-[12px] text-bad" role="alert">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className={buttonClass("primary", "sm")}>{pending && <Loader2 size={14} className="animate-spin" />} Enregistrer</button>
        <button type="button" onClick={onDone} className={buttonClass("ghost", "sm")}>Annuler</button>
      </div>
    </form>
  );
}
