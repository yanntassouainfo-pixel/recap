# Brief commun — modules de Recap

Recap est une application Next.js 15 (App Router, React 19, TypeScript, Tailwind v4) de pilotage financier pour
indépendants et petites entreprises, entièrement en français. Base SQLite via Drizzle (better-sqlite3).

## À lire AVANT d'écrire du code
- `src/lib/db/schema.ts` — modèle de données (montants = entiers en unités mineures de LEUR devise).
- `src/lib/finance/engine.ts`, `src/lib/finance/insights.ts` — moteur déterministe (ne PAS le modifier).
- `src/lib/data.ts` — `getScope`, `getSnapshot` (instantané financier mis en cache par requête), `getSettings`…
- `src/lib/options.ts` — options de formulaires.
- `src/components/ui.tsx` — primitives (Card, CardHeader, PageHeader, Badge, InvoiceStatusBadge, Money, BigMoney,
  Delta, EmptyState, Field, Input, Select, Textarea, Table/Th/Td, Tabs, Segmented, Progress, Notice, ButtonLink…).
- `src/components/form-bits.tsx` (SubmitButton, FormMessage), `src/components/modal.tsx`, `src/components/toast.tsx`.
- `src/components/quick/forms.tsx` + `provider.tsx` — formulaires rapides réutilisables (`QuickButton kind="payment" preset={{invoiceId}}` etc.).
- `src/app/actions/finance.ts`, `src/app/actions/crm.ts` — modèles d'actions serveur (validation, `ownedId` pour
  l'isolation des données, `audit()`, `revalidatePath`). Les fichiers "use server" n'exportent QUE des fonctions async.
- `src/app/(app)/page.tsx` — le tableau de bord : référence de style visuel et de densité.
- `src/lib/labels.ts`, `src/lib/money.ts`, `src/lib/dates.ts`, `src/lib/documents.ts`, `src/lib/storage.ts`, `src/lib/pdf.ts`.

## Règles impératives
1. **Ne modifiez AUCUN fichier existant** en dehors de ceux explicitement attribués à votre module. D'autres agents
   travaillent en parallèle. Si un fichier partagé doit évoluer, créez un helper dans vos propres fichiers et
   signalez le besoin dans votre rapport final.
2. Toute requête filtre par `userId` ; toute référence saisie passe par `ownedId(...)`.
3. Les calculs financiers passent par le moteur (`getSnapshot`, fonctions de `engine.ts`). Jamais de mélange de devises
   sans `toBase`/`convert`. Distinguer facturé / encaissé / restant dû / payé / engagé / prévisionnel.
4. Interface 100 % français, libellés explicites, sans jargon comptable. Statuts colorés TOUJOURS accompagnés d'un libellé.
5. Chaque page : `PageHeader` (titre + description qui répond à une question concrète + actions), états vides utiles
   (guident vers la prochaine action), gestion des erreurs, responsive (tableaux → listes empilées sur mobile :
   `hidden md:block` pour le tableau et une liste `md:hidden`).
6. Aucun bouton décoratif : chaque bouton déclenche une vraie action. Si une intégration n'est pas configurée,
   affichez un état explicite.
7. Utilisez les tokens de couleur (`text-ink`, `text-ink-2`, `text-ink-3`, `bg-surface`, `bg-surface-2`, `border-line`,
   `text-good`, `text-bad`, `text-warn`, `bg-*-soft`, `var(--series-N)`) — jamais de couleur brute (sauf couleurs
   d'entités stockées en base). Le thème sombre en dépend.
8. Les pages sont des composants serveur ; l'interactivité dans des composants client dédiés.
   `export const metadata = { title: "…" }` sur chaque page.
9. Montants : `formatMoney(minor, currency)` ; saisie : `parseAmount` / `money(form, key, currency)` ; dates ISO `YYYY-MM-DD`.

## Vérifier votre travail
- `npx tsc --noEmit` doit passer sans erreur.
- Le serveur de dev tourne déjà sur http://localhost:3100 (NE PAS le relancer, NE PAS utiliser le navigateur intégré).
  Obtenez un cookie de session de démo : `T=$(npx tsx scripts/dev-session.ts)` puis
  `curl -s -b "recap_session=$T" http://localhost:3100/votre-page -o /tmp/x.html -w "%{http_code}"` — exigez 200 et
  cherchez les erreurs (`grep -i "error" `). Les journaux du serveur ne vous sont pas accessibles : en cas de 500,
  isolez en simplifiant.
- Tests unitaires pour toute logique pure non triviale : `tests/<module>.test.ts` (vitest, `npx vitest run tests/<fichier>`).
- La base de démo se régénère avec `npx tsx scripts/seed.ts` (le faire si vous l'avez salie ; prévenez dans le rapport).

## Rapport final (court)
Fichiers créés, fonctionnalités livrées, ce qui a été vérifié et comment, limites connues, et besoins de
modification de fichiers partagés (avec le diff proposé).
