import type { Note, Supply } from '@bollette/core';
import { renderSupplies } from './supplies-view';
import { renderSupplyLink } from './supply-link-view';

const apartments = [
  { id: 'demo-1', name: 'Appartamento Rossi (demo)' },
  { id: 'demo-2', name: 'Appartamento Bianchi (demo)' },
];

/** Invented data only: shows the link screen, then the «Utenze» tab with what was linked. */
export function showDemo(main: HTMLElement): void {
  const supplies: Supply[] = [];
  const notes: Note[] = [];
  let noteCount = 0;
  const link = document.createElement('section');
  const tab = document.createElement('section');
  main.replaceChildren(link, tab);
  const draw = (): void =>
    renderSupplies(tab, {
      supplies,
      apartments,
      notes,
      onUpdate: () => Promise.resolve(),
      onRemove: (s) => {
        supplies.splice(supplies.indexOf(s), 1);
        draw();
        return Promise.resolve();
      },
      onAddNote: (s, text) => {
        notes.push({
          id: `n${String(noteCount++)}`,
          v: 1,
          rev: 1,
          targetType: 'supply',
          targetId: s.id,
          text,
          profileId: 'demo',
          at: `2026-11-13T10:${String(notes.length).padStart(2, '0')}:00.000Z`,
          visibleToTenants: false,
        });
        draw();
        return Promise.resolve();
      },
    });
  renderSupplyLink(link, {
    label: 'IT000DEMO0001',
    suggested: [
      { apartmentId: 'demo-1', origin: 'catasto' },
      { apartmentId: 'demo-2', origin: 'indirizzo' },
    ],
    apartments,
    onConfirm: (draft) => {
      supplies.push({
        id: `s${supplies.length}`,
        v: 1,
        rev: 1,
        label: draft.label,
        apartments: draft.rows.map((r) => ({ apartmentId: r.apartmentId, weight: r.basisPoints })),
      });
      if (draft.note.trim() !== '') {
        notes.push({
          id: `n${String(noteCount++)}`,
          v: 1,
          rev: 1,
          targetType: 'supply',
          targetId: `s${supplies.length - 1}`,
          text: draft.note.trim(),
          profileId: 'demo',
          at: '2026-11-13T09:00:00.000Z',
          visibleToTenants: false,
        });
      }
      draw();
      return Promise.resolve();
    },
  });
  draw();
}
