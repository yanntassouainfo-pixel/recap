import { Badge } from "@/components/ui";

export const CONTACT_TYPES: Record<string, { label: string; tone: "info" | "good" | "neutral" }> = {
  prospect: { label: "Prospect", tone: "info" },
  client: { label: "Client", tone: "good" },
  supplier: { label: "Fournisseur", tone: "neutral" },
};

export function TypeBadge({ type, archived }: { type: string; archived?: boolean }) {
  if (archived) return <Badge tone="neutral">Archivé</Badge>;
  const t = CONTACT_TYPES[type] ?? { label: type, tone: "neutral" as const };
  return <Badge tone={t.tone} dot>{t.label}</Badge>;
}

export const EMAIL_STATUS: Record<string, { label: string; tone: "good" | "bad" | "neutral" | "info" }> = {
  draft: { label: "Brouillon (non envoyé)", tone: "neutral" },
  sending: { label: "Envoi en cours", tone: "info" },
  sent: { label: "Envoyé", tone: "good" },
  failed: { label: "Échec de l'envoi", tone: "bad" },
};

export function EmailStatusBadge({ status }: { status: string }) {
  const s = EMAIL_STATUS[status] ?? { label: status, tone: "neutral" as const };
  return <Badge tone={s.tone} dot>{s.label}</Badge>;
}
