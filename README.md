# Recap

Application de pilotage financier et commercial pour indépendants et petites entreprises, entièrement en français.

- **Tableau de bord** : argent disponible, fin de mois prévue, priorité du jour.
- **Revenus & factures** : factures, devis, paiements, PDF, import de factures avec détection des doublons.
- **Dépenses & transactions** : dépenses, échéances à venir, charges récurrentes, exports CSV.
- **Prévisionnel & rentabilité** : trésorerie sur 30 à 365 jours (prudent / central / optimiste), simulateur de dépense, objectifs.
- **Clients, documents & emails** : contacts et pipeline, bibliothèque de documents versionnés, emails à partir de modèles.
- **Assistant** : réponses chiffrées à partir de vos données (« Puis-je absorber une dépense de 1,5 M ? »).

Plusieurs structures (entreprises, espace personnel) et plusieurs devises (XOF, EUR, USD…) sont gérées.

## Démarrer

Prérequis : Node.js 20 ou plus récent.

```bash
npm install
cp .env.example .env.local   # facultatif : envoi d'emails, assistant IA
npm run db:seed              # facultatif : crée le compte de démonstration
npm run dev                  # http://localhost:3100
```

Compte de démonstration (après `npm run db:seed`) : `demo@recap.local` / `demo-recap-2026`.
Vous pouvez aussi créer votre propre compte depuis la page d'inscription.

## Où sont gardées vos données

Tout ce que vous saisissez est enregistré localement et conservé d'une session à l'autre :

- `data/recap.db` — base SQLite (créée et mise à jour automatiquement au premier lancement) ;
- `uploads/` — documents et justificatifs envoyés.

Ces deux emplacements sont exclus de Git : vos données ne partent jamais sur GitHub.
Pour les sauvegarder, copiez ces deux dossiers (application arrêtée).

## Configuration facultative (`.env.local`)

| Variable | Rôle |
|---|---|
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE` | Envoi réel des emails. Sans SMTP, les emails restent en brouillon et ne sont jamais marqués comme envoyés. |
| `ANTHROPIC_API_KEY` | Lecture des factures en photo et réponses rédigées de l'assistant. Sans clé, l'assistant utilise son moteur de calcul seul. |
| `DATABASE_FILE` | Emplacement de la base (par défaut `data/recap.db`). |
| `UPLOAD_DIR` | Dossier des fichiers envoyés (par défaut `uploads/`). |

## Commandes utiles

```bash
npm run typecheck   # vérification TypeScript
npm test            # tests unitaires (vitest)
npm run build && npm start
npm run db:reset    # efface la base locale et recrée la démo
```
