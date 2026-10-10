export interface ActionState {
  ok?: boolean;
  error?: string;
  message?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  /** Identifiant créé, pour enchaîner (ex. ouvrir la fiche) */
  id?: string;
  /** Avertissements non bloquants (ex. doublon potentiel) */
  warning?: string;
  values?: Record<string, string>;
}

export const initialState: ActionState = {};
