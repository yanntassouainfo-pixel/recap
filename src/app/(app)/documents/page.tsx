import Link from "next/link";
import { desc, eq, inArray } from "drizzle-orm";
import { Download, FolderOpen, Search } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { getActivities, getScope, visibleCompanies } from "@/lib/data";
import { formatDate } from "@/lib/dates";
import { DOCUMENT_TYPES, DOCUMENT_USAGES } from "@/lib/documents";
import { formatBytes } from "@/lib/templating";
import { Badge, ButtonLink, Card, EmptyState, PageHeader, Table, Tabs, Td, Th, buttonClass } from "@/components/ui";
import { ArchiveDocumentButton, EditDocumentDialog, PreviewButton, UploadArea, VersionsDialog, type DocLite, type DocRefs, type VersionLite } from "@/components/documents/library";

export const metadata = { title: "Documents" };

const TABS = [
  { key: "reusable", label: "Bibliothèque" },
  { key: "client", label: "Documents clients" },
  { key: "accounting", label: "Justificatifs" },
  { key: "archives", label: "Archives" },
];

function norm(s: string | null | undefined) {
  return (s ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
}

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const scope = await getScope(user.id);
  const usage = TABS.some((t) => t.key === sp.usage) ? sp.usage! : "reusable";
  const companies = visibleCompanies(user.id);
  const activities = getActivities(user.id).filter((a) => !a.archived && companies.some((c) => c.id === a.companyId));
  const contacts = db.select().from(schema.contacts).where(eq(schema.contacts.userId, user.id)).all();
  const contactName = new Map(contacts.map((c) => [c.id, c.name]));
  const companyName = new Map(companies.map((c) => [c.id, c.name]));
  const activityName = new Map(activities.map((a) => [a.id, a.name]));

  const docs = db.select().from(schema.documents).where(eq(schema.documents.userId, user.id)).orderBy(desc(schema.documents.updatedAt), desc(schema.documents.createdAt)).all();
  // Portée : une structure sélectionnée n'affiche que ses documents (et ceux communs à toutes les structures).
  const inScope = (d: typeof docs[number]) => scope.company === null || !d.companyId || d.companyId === scope.company.id;
  const scoped = docs.filter(inScope);
  const counts = {
    reusable: scoped.filter((d) => !d.archived && d.usage === "reusable").length,
    client: scoped.filter((d) => !d.archived && d.usage === "client").length,
    accounting: scoped.filter((d) => !d.archived && d.usage === "accounting").length,
    archives: scoped.filter((d) => d.archived).length,
  };

  const q = norm(sp.q);
  const typeFilter = sp.type && DOCUMENT_TYPES[sp.type] ? sp.type : "";
  const contactFilter = sp.contact && contactName.has(sp.contact) ? sp.contact : "";
  const list = scoped
    .filter((d) => (usage === "archives" ? d.archived : !d.archived && d.usage === usage))
    .filter((d) => !typeFilter || d.type === typeFilter)
    .filter((d) => !contactFilter || d.contactId === contactFilter)
    .filter((d) => !q || [d.name, d.description, d.tags, d.contactId ? contactName.get(d.contactId) : null].some((v) => norm(v).includes(q)));

  const versions = list.length
    ? db.select().from(schema.documentVersions).where(inArray(schema.documentVersions.documentId, list.map((d) => d.id))).orderBy(desc(schema.documentVersions.version)).all()
    : [];
  const versionsByDoc = new Map<string, typeof versions>();
  for (const v of versions) {
    const l = versionsByDoc.get(v.documentId) ?? [];
    l.push(v);
    versionsByDoc.set(v.documentId, l);
  }

  // Utilisation dans les emails envoyés (version exacte)
  const usedIn = new Map<string, number>();
  if (list.length) {
    const rows = db.select({ documentId: schema.emailAttachments.documentId })
      .from(schema.emailAttachments).innerJoin(schema.emails, eq(schema.emails.id, schema.emailAttachments.emailId))
      .where(eq(schema.emails.userId, user.id)).all();
    for (const r of rows) if (r.documentId) usedIn.set(r.documentId, (usedIn.get(r.documentId) ?? 0) + 1);
  }

  const refs: DocRefs = {
    types: DOCUMENT_TYPES,
    usages: DOCUMENT_USAGES,
    companies: companies.map((c) => ({ id: c.id, name: c.kind === "personal" ? "Espace personnel" : c.name })),
    activities: activities.map((a) => ({ id: a.id, companyId: a.companyId, name: a.name })),
    contacts: contacts.filter((c) => !c.archived).map((c) => ({ id: c.id, name: c.organization ? `${c.name} — ${c.organization}` : c.name })).sort((a, b) => a.name.localeCompare(b.name, "fr")),
  };
  const defaults = {
    usage: usage === "archives" ? "reusable" : usage,
    contactId: contactFilter || undefined,
    companyId: scope.company?.id,
  };
  const tabHref = (k: string) => `/documents?usage=${k}${contactFilter ? `&contact=${contactFilter}` : ""}`;
  const filtersActive = !!(q || typeFilter || contactFilter);

  const rows = list.map((d) => {
    const vs = versionsByDoc.get(d.id) ?? [];
    const current = vs.find((v) => v.version === d.currentVersion) ?? vs[0];
    const lite: DocLite = {
      id: d.id, name: d.name, type: d.type, usage: d.usage, companyId: d.companyId, activityId: d.activityId, contactId: d.contactId,
      description: d.description, tags: d.tags, currentVersion: d.currentVersion, archived: d.archived,
    };
    const vlite: VersionLite[] = vs.map((v) => ({ version: v.version, fileName: v.fileName, mimeType: v.mimeType, size: v.size, note: v.note, createdAt: v.createdAt }));
    const where = [d.companyId ? companyName.get(d.companyId) : "Toutes structures", d.activityId ? activityName.get(d.activityId) : null].filter(Boolean).join(" · ");
    return { d, current, lite, vlite, where };
  });

  const actions = (r: (typeof rows)[number]) => (
    <div className="flex items-center justify-end gap-0.5">
      {r.current && <PreviewButton doc={r.d} mimeType={r.current.mimeType} fileName={r.current.fileName} />}
      <a href={`/api/documents/${r.d.id}`} className={buttonClass("ghost", "sm", "h-7 px-2")} aria-label={`Télécharger ${r.d.name}`}><Download size={13} aria-hidden /><span className="sr-only md:not-sr-only">Télécharger</span></a>
      <VersionsDialog doc={r.lite} versions={r.vlite} />
      <EditDocumentDialog doc={r.lite} refs={refs} />
      <ArchiveDocumentButton id={r.d.id} archived={r.d.archived} />
    </div>
  );

  return (
    <>
      <PageHeader
        title="Documents"
        description="Les fichiers que vous envoyez le plus souvent, prêts à joindre à un email, avec l'historique de chaque version."
        actions={<UploadArea refs={refs} defaults={defaults} />}
      />

      <Tabs active={usage} items={TABS.map((t) => ({ key: t.key, label: t.label, href: tabHref(t.key), count: counts[t.key as keyof typeof counts] }))} />

      <form method="get" className="mb-4 flex flex-wrap items-center gap-2" role="search">
        <input type="hidden" name="usage" value={usage} />
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" aria-hidden />
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Nom, mot-clé, client…" aria-label="Rechercher un document" className="field-input h-8 w-[220px] pl-8 text-[12.5px]" />
        </div>
        <select name="type" defaultValue={typeFilter} aria-label="Filtrer par type" className="field-input h-8 w-auto py-0 text-[12.5px]">
          <option value="">Tous les types</option>
          {Object.entries(DOCUMENT_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        {(usage === "client" || contactFilter) && (
          <select name="contact" defaultValue={contactFilter} aria-label="Filtrer par client" className="field-input h-8 w-auto max-w-[220px] py-0 text-[12.5px]">
            <option value="">Tous les clients</option>
            {refs.contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        <button type="submit" className={buttonClass("secondary", "sm")}>Filtrer</button>
        {filtersActive && <Link href={`/documents?usage=${usage}`} className={buttonClass("ghost", "sm")}>Effacer les filtres</Link>}
        {contactFilter && <span className="text-[12.5px] text-ink-3">Client : <Link href={`/clients/${contactFilter}`} className="text-ink hover:underline">{contactName.get(contactFilter)}</Link></span>}
      </form>

      <UploadArea refs={refs} defaults={defaults} button={false}>
        <Card>
          {rows.length === 0 ? (
            filtersActive ? (
              <EmptyState compact title="Aucun document ne correspond" description="Modifiez la recherche ou les filtres." action={<ButtonLink href={`/documents?usage=${usage}`} size="sm">Effacer les filtres</ButtonLink>} />
            ) : (
              <EmptyState icon={<FolderOpen size={20} />}
                title={usage === "reusable" ? "Votre bibliothèque est vide" : usage === "client" ? "Aucun document client" : usage === "accounting" ? "Aucun justificatif" : "Aucun document archivé"}
                description={usage === "reusable"
                  ? "Déposez ici votre présentation, vos propositions types, vos conditions générales : vous les joindrez à vos emails en un clic."
                  : usage === "client" ? "Les fichiers échangés avec vos clients — y compris ceux joints depuis le composeur d'email — sont classés ici."
                    : usage === "accounting" ? "Factures fournisseurs, reçus, relevés : gardez vos pièces justificatives au même endroit."
                      : "Les documents archivés n'apparaissent plus dans le composeur mais restent consultables ici."}
                action={usage !== "archives" ? <span className="text-[12.5px] text-ink-3">Glissez des fichiers sur cette zone ou utilisez « Ajouter des documents ».</span> : undefined} />
            )
          ) : (
            <>
              <div className="hidden md:block">
                <Table>
                  <thead>
                    <tr>
                      <Th>Document</Th>
                      <Th>Type</Th>
                      <Th>{usage === "client" ? "Client" : "Rattachement"}</Th>
                      <Th>Mis à jour</Th>
                      <Th align="right"><span className="sr-only">Actions</span></Th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.d.id} className="hover:bg-surface-2/60">
                        <Td>
                          <div className="font-medium">{r.d.name}</div>
                          <div className="text-[12px] text-ink-3">
                            {r.current ? `${r.current.fileName} · ${formatBytes(r.current.size)}` : "Fichier manquant"}
                            {r.d.currentVersion > 1 && ` · version ${r.d.currentVersion}`}
                            {usedIn.get(r.d.id) ? ` · joint à ${usedIn.get(r.d.id)} email${usedIn.get(r.d.id)! > 1 ? "s" : ""}` : ""}
                          </div>
                          {r.d.tags && <div className="mt-1 flex flex-wrap gap-1">{r.d.tags.split(",").map((t) => <Badge key={t} tone="neutral" className="text-[11px]">{t.trim()}</Badge>)}</div>}
                        </Td>
                        <Td className="text-ink-2">{DOCUMENT_TYPES[r.d.type] ?? "Autre"}</Td>
                        <Td className="text-[12.5px] text-ink-2">
                          {r.d.contactId ? <Link href={`/clients/${r.d.contactId}`} className="hover:underline">{contactName.get(r.d.contactId) ?? "—"}</Link> : r.where}
                        </Td>
                        <Td className="text-[12.5px] text-ink-3">{formatDate((r.d.updatedAt ?? r.d.createdAt).slice(0, 10))}</Td>
                        <Td align="right">{actions(r)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
              <ul className="divide-y divide-line md:hidden">
                {rows.map((r) => (
                  <li key={r.d.id} className="px-4 py-3">
                    <div className="font-medium">{r.d.name}</div>
                    <div className="text-[12px] text-ink-3">
                      {DOCUMENT_TYPES[r.d.type] ?? "Autre"}{r.d.contactId ? ` · ${contactName.get(r.d.contactId) ?? ""}` : ` · ${r.where}`}
                      {r.current ? ` · ${formatBytes(r.current.size)}` : ""}{r.d.currentVersion > 1 ? ` · v${r.d.currentVersion}` : ""}
                    </div>
                    <div className="-ml-2 mt-1.5">{actions(r)}</div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </UploadArea>
    </>
  );
}
