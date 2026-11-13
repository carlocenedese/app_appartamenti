import type { Note, Supply } from '@bollette/core';
import { button, el, formatPercent, saveErrorMessage } from './view-util';

export interface SuppliesInput {
  supplies: Supply[];
  apartments: { id: string; name: string }[];
  notes: Note[];
  onUpdate: (supply: Supply) => Promise<void>;
  onRemove: (supply: Supply) => Promise<void>;
  onAddNote: (supply: Supply, text: string) => Promise<void>;
}

/** The «Utenze» tab: each supply with its apartments, its notes and the three actions. */
export function renderSupplies(root: HTMLElement, input: SuppliesInput): void {
  const nameOf = (id: string) => input.apartments.find((a) => a.id === id)?.name ?? id;
  root.replaceChildren(el('h2', '', 'Utenze'));
  if (input.supplies.length === 0) {
    root.append(el('p', '', 'Nessuna utenza collegata. Si collegano dalla bolletta da rivedere.'));
    return;
  }
  for (const supply of input.supplies) {
    const card = el('article', 'supply');
    const error = el('p', 'error');
    error.setAttribute('role', 'alert');
    const run = async (action: () => Promise<void>): Promise<void> => {
      error.textContent = '';
      try {
        await action();
      } catch (e) {
        error.textContent = saveErrorMessage(e);
      }
    };

    const apartments = el('ul', 'apartments');
    for (const a of supply.apartments) {
      apartments.append(el('li', '', `${nameOf(a.apartmentId)}: ${formatPercent(a.weight)}`));
    }
    const notes = el('ul', 'notes');
    // ISO timestamps sort as text; newest first.
    const mine = input.notes
      .filter((n) => n.targetType === 'supply' && n.targetId === supply.id)
      .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    for (const n of mine) notes.append(el('li', '', n.text));

    const noteBox = el('div', 'note-box');
    const addNote = button('Aggiungi nota', () => {
      const field = el('textarea');
      field.setAttribute('aria-label', 'Nota');
      field.maxLength = 2000;
      noteBox.replaceChildren(
        field,
        button('Salva nota', () => void run(() => input.onAddNote(supply, field.value)), true),
      );
    });

    const actions = el('div', 'actions');
    actions.append(
      button('Modifica', () => void run(() => input.onUpdate(supply))),
      button('Rimuovi', () => void run(() => input.onRemove(supply))),
      addNote,
    );
    card.append(el('h3', '', supply.label), apartments, notes, noteBox, actions, error);
    root.append(card);
  }
}
