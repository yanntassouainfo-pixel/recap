"use client";

import { Pencil, Plus } from "lucide-react";
import { ActionDialog } from "@/components/action-dialog";
import { Field, Input, Select, Textarea, buttonClass } from "@/components/ui";
import { SubmitButton } from "@/components/form-bits";
import { saveAccount, saveActivity, saveBrand, saveCompany } from "@/app/actions/structures";
import { CURRENCIES, minorToInput } from "@/lib/money";
import { ACCOUNT_TYPES } from "@/lib/labels";

const PALETTE = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#4a3aa7", "#008300", "#e34948", "#7a6a58", "#141413"];

function ColorField({ name = "color", value }: { name?: string; value?: string }) {
  return (
    <Field label="Couleur" htmlFor={name} hint="Utilisée dans les graphiques et le sélecteur de vue.">
      <div className="flex flex-wrap gap-2" role="radiogroup">
        {PALETTE.map((c) => (
          <label key={c} className="relative cursor-pointer">
            <input type="radio" name={name} value={c} defaultChecked={(value ?? PALETTE[0]) === c} className="peer sr-only" />
            <span className="block size-7 rounded-full ring-offset-2 ring-offset-[var(--surface)] peer-checked:ring-2 peer-checked:ring-[var(--ink)] peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--accent)]" style={{ background: c }} />
            <span className="sr-only">{c}</span>
          </label>
        ))}
      </div>
    </Field>
  );
}

export interface CompanyData {
  id: string; name: string; legalName: string | null; description: string | null; email: string | null; phone: string | null;
  address: string | null; website: string | null; currency: string; taxId: string | null; billingDetails: string | null;
  invoicePrefix: string; quotePrefix: string; paymentTermsDays: number; color: string;
}

export function CompanyDialog({ company, variant }: { company?: CompanyData; variant?: "primary" | "icon" }) {
  const v0 = company;
  return (
    <ActionDialog
      title={company ? `Modifier « ${company.name} »` : "Nouvelle structure"}
      description="Ces informations sont réutilisées automatiquement dans vos devis, factures, propositions et emails."
      action={saveCompany} size="lg"
      triggerClassName={variant === "primary" ? buttonClass("primary", "md") : variant === "icon" ? "rounded-lg p-2 text-ink-3 hover:bg-surface-3 hover:text-ink" : undefined}
      ariaLabel={company ? `Modifier ${company.name}` : undefined}
      trigger={company ? (variant === "icon" ? <Pencil size={15} /> : <><Pencil size={14} /> Modifier</>) : <><Plus size={16} /> Nouvelle structure</>}>
      {(state) => {
        const v = { ...(v0 ?? {}), ...(state.values ?? {}) } as Record<string, string | number | null | undefined>;
        const fe = state.fieldErrors ?? {};
        const s = (k: string) => (v[k] == null ? "" : String(v[k]));
        return (
          <>
            {company && <input type="hidden" name="id" value={company.id} />}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nom" htmlFor="name" error={fe.name}><Input id="name" name="name" defaultValue={s("name")} required autoFocus /></Field>
              <Field label="Raison sociale" htmlFor="legalName" optional><Input id="legalName" name="legalName" defaultValue={s("legalName")} /></Field>
            </div>
            <Field label="Description de l'activité" htmlFor="description" optional><Textarea id="description" name="description" rows={2} defaultValue={s("description")} /></Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Email professionnel" htmlFor="email" optional error={fe.email}><Input id="email" name="email" type="email" defaultValue={s("email")} /></Field>
              <Field label="Téléphone" htmlFor="phone" optional><Input id="phone" name="phone" defaultValue={s("phone")} /></Field>
              <Field label="Site web" htmlFor="website" optional><Input id="website" name="website" defaultValue={s("website")} /></Field>
            </div>
            <Field label="Adresse" htmlFor="address" optional><Input id="address" name="address" defaultValue={s("address")} /></Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Devise principale" htmlFor="currency" error={fe.currency}>
                <Select id="currency" name="currency" defaultValue={s("currency") || "XOF"}>
                  {Object.values(CURRENCIES).map((c) => <option key={c.code} value={c.code}>{c.code} — {c.label}</option>)}
                </Select>
              </Field>
              <Field label="Identifiant fiscal" htmlFor="taxId" optional><Input id="taxId" name="taxId" defaultValue={s("taxId")} /></Field>
              <Field label="Délai de paiement (jours)" htmlFor="paymentTermsDays"><Input id="paymentTermsDays" name="paymentTermsDays" type="number" min={0} max={180} defaultValue={s("paymentTermsDays") || "30"} /></Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Préfixe des factures" htmlFor="invoicePrefix" hint="Ex. PP → PP-2026-001"><Input id="invoicePrefix" name="invoicePrefix" defaultValue={s("invoicePrefix") || "FAC"} /></Field>
              <Field label="Préfixe des devis" htmlFor="quotePrefix"><Input id="quotePrefix" name="quotePrefix" defaultValue={s("quotePrefix") || "DEV"} /></Field>
            </div>
            <Field label="Informations de paiement (affichées sur les factures)" htmlFor="billingDetails" optional hint="Banque, IBAN, numéro mobile money… Visible par vos clients sur les factures uniquement.">
              <Textarea id="billingDetails" name="billingDetails" rows={2} defaultValue={s("billingDetails")} />
            </Field>
            {!company && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Première activité" htmlFor="firstActivity" optional hint="Vous pourrez en ajouter d'autres."><Input id="firstActivity" name="firstActivity" /></Field>
                <Field label="Solde actuel du compte principal" htmlFor="openingBalance" optional><Input id="openingBalance" name="openingBalance" inputMode="decimal" placeholder="0" /></Field>
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <ColorField value={s("color")} />
              <Field label="Logo" htmlFor="logo" optional hint="PNG, JPG, SVG — 2 Mo max.">
                <input id="logo" name="logo" type="file" accept="image/*" className="text-[13px] text-ink-2 file:mr-3 file:rounded-lg file:border file:border-line-2 file:bg-surface file:px-3 file:py-1.5 file:text-[13px]" />
              </Field>
            </div>
            <div className="flex justify-end"><SubmitButton pendingLabel="Enregistrement…">{company ? "Enregistrer" : "Créer la structure"}</SubmitButton></div>
          </>
        );
      }}
    </ActionDialog>
  );
}

export interface ActivityData { id: string; companyId: string; name: string; category: string | null; description: string | null; color: string; brandId: string | null; monthlyRevenueTarget: number | null }

export function ActivityDialog({ companyId, currency, brands, activity }: { companyId: string; currency: string; brands: { id: string; name: string }[]; activity?: ActivityData }) {
  return (
    <ActionDialog
      title={activity ? `Modifier « ${activity.name} »` : "Nouvelle activité"}
      description="Une activité est un métier ou une ligne de revenus que vous voulez analyser séparément."
      action={saveActivity}
      triggerClassName={activity ? "rounded-lg p-1.5 text-ink-3 hover:bg-surface-3 hover:text-ink" : buttonClass("ghost", "sm")}
      ariaLabel={activity ? `Modifier ${activity.name}` : undefined}
      trigger={activity ? <Pencil size={14} /> : <><Plus size={14} /> Activité</>}>
      {(state) => {
        const v = { ...(activity ?? {}), ...(state.values ?? {}) } as Record<string, unknown>;
        const s = (k: string) => (v[k] == null ? "" : String(v[k]));
        return (
          <>
            {activity && <input type="hidden" name="id" value={activity.id} />}
            <input type="hidden" name="companyId" value={companyId} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nom" htmlFor="name" error={state.fieldErrors?.name}><Input id="name" name="name" defaultValue={s("name")} placeholder="Ex. Coaching individuel" required autoFocus /></Field>
              <Field label="Catégorie" htmlFor="category" optional><Input id="category" name="category" defaultValue={s("category")} placeholder="Formation, Conseil…" /></Field>
            </div>
            <Field label="Description" htmlFor="description" optional><Textarea id="description" name="description" rows={2} defaultValue={s("description")} /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              {brands.length > 0 && (
                <Field label="Enseigne" htmlFor="brandId" optional>
                  <Select id="brandId" name="brandId" defaultValue={s("brandId")}>
                    <option value="">Aucune</option>
                    {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </Select>
                </Field>
              )}
              <Field label={`Objectif de revenus mensuels (${CURRENCIES[currency as keyof typeof CURRENCIES]?.symbol ?? currency})`} htmlFor="monthlyRevenueTarget" optional>
                <Input id="monthlyRevenueTarget" name="monthlyRevenueTarget" inputMode="decimal" defaultValue={activity?.monthlyRevenueTarget != null && !state.values ? minorToInput(activity.monthlyRevenueTarget, currency) : s("monthlyRevenueTarget")} />
              </Field>
            </div>
            <ColorField value={s("color")} />
            <div className="flex justify-end"><SubmitButton>{activity ? "Enregistrer" : "Créer l'activité"}</SubmitButton></div>
          </>
        );
      }}
    </ActionDialog>
  );
}

export function BrandDialog({ companyId, brand }: { companyId: string; brand?: { id: string; name: string; description: string | null } }) {
  return (
    <ActionDialog
      title={brand ? `Modifier l'enseigne « ${brand.name} »` : "Nouvelle enseigne"}
      description="Le nom commercial sous lequel une activité est exercée."
      action={saveBrand} size="sm"
      triggerClassName={brand ? "rounded-lg p-1 text-ink-3 hover:bg-surface-3 hover:text-ink" : buttonClass("ghost", "sm")}
      ariaLabel={brand ? `Modifier ${brand.name}` : undefined}
      trigger={brand ? <Pencil size={13} /> : <><Plus size={14} /> Enseigne</>}>
      {(state) => (
        <>
          {brand && <input type="hidden" name="id" value={brand.id} />}
          <input type="hidden" name="companyId" value={companyId} />
          <Field label="Nom de l'enseigne" htmlFor="name" error={state.fieldErrors?.name}><Input id="name" name="name" defaultValue={state.values?.name ?? brand?.name} required autoFocus /></Field>
          <Field label="Description" htmlFor="description" optional><Input id="description" name="description" defaultValue={state.values?.description ?? brand?.description ?? ""} /></Field>
          <div className="flex justify-end"><SubmitButton>Enregistrer</SubmitButton></div>
        </>
      )}
    </ActionDialog>
  );
}

export interface AccountData { id: string; companyId: string; name: string; type: string; institution: string | null; currency: string; openingBalance: number; openingDate: string }

export function AccountDialog({ companies, account, defaultCompanyId, today, primary }: { companies: { id: string; name: string; kind: string; currency: string }[]; account?: AccountData; defaultCompanyId?: string; today: string; primary?: boolean }) {
  return (
    <ActionDialog
      title={account ? `Modifier « ${account.name} »` : "Nouveau compte"}
      description="Banque, caisse, mobile money… L'argent disponible est la somme de vos comptes."
      action={saveAccount}
      triggerClassName={account ? "rounded-lg p-1.5 text-ink-3 hover:bg-surface-3 hover:text-ink" : buttonClass(primary ? "primary" : "secondary", "sm")}
      ariaLabel={account ? `Modifier ${account.name}` : undefined}
      trigger={account ? <Pencil size={14} /> : <><Plus size={14} /> Ajouter un compte</>}>
      {(state) => {
        const v = { ...(account ?? {}), ...(state.values ?? {}) } as Record<string, unknown>;
        const s = (k: string) => (v[k] == null ? "" : String(v[k]));
        const currency = account?.currency ?? (s("currency") || companies.find((c) => c.id === (defaultCompanyId ?? companies[0]?.id))?.currency || "XOF");
        return (
          <>
            {account && <input type="hidden" name="id" value={account.id} />}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nom du compte" htmlFor="name" error={state.fieldErrors?.name}><Input id="name" name="name" defaultValue={s("name")} placeholder="Ex. Banque pro, Caisse, Wave" required autoFocus /></Field>
              <Field label="Structure" htmlFor="companyId">
                <Select id="companyId" name="companyId" defaultValue={s("companyId") || defaultCompanyId}>
                  {companies.map((c) => <option key={c.id} value={c.id}>{c.kind === "personal" ? "Espace personnel" : c.name}</option>)}
                </Select>
              </Field>
              <Field label="Type" htmlFor="type">
                <Select id="type" name="type" defaultValue={s("type") || "bank"}>
                  {Object.entries(ACCOUNT_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </Select>
              </Field>
              <Field label="Établissement" htmlFor="institution" optional><Input id="institution" name="institution" defaultValue={s("institution")} /></Field>
              <Field label="Devise" htmlFor="currency" hint={account ? "La devise d'un compte existant ne peut pas changer." : undefined} error={state.fieldErrors?.currency}>
                <Select id="currency" name="currency" defaultValue={currency} disabled={!!account}>
                  {Object.values(CURRENCIES).map((c) => <option key={c.code} value={c.code}>{c.code} — {c.label}</option>)}
                </Select>
              </Field>
              <div />
              <Field label="Solde à la date de référence" htmlFor="openingBalance" error={state.fieldErrors?.openingBalance} hint="Les opérations postérieures à cette date sont ajoutées automatiquement.">
                <Input id="openingBalance" name="openingBalance" inputMode="decimal" defaultValue={account && !state.values ? minorToInput(account.openingBalance, account.currency) : s("openingBalance") || "0"} className="tabular" />
              </Field>
              <Field label="Date de référence" htmlFor="openingDate" error={state.fieldErrors?.openingDate}>
                <Input id="openingDate" name="openingDate" type="date" defaultValue={s("openingDate") || today} />
              </Field>
            </div>
            <div className="flex justify-end"><SubmitButton>{account ? "Enregistrer" : "Ajouter le compte"}</SubmitButton></div>
          </>
        );
      }}
    </ActionDialog>
  );
}
