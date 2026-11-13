import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note, Supply } from '@bollette/core';
import { renderSupplies } from '../src/supplies-view';

const apartments = [
  { id: 'a1', name: 'Appartamento Uno' },
  { id: 'a2', name: 'Appartamento Due' },
];
const supply = {
  id: 's1',
  v: 1,
  rev: 1,
  label: 'IT001',
  apartments: [
    { apartmentId: 'a1', weight: 6667 },
    { apartmentId: 'a2', weight: 3333 },
  ],
} as Supply;
const note = (id: string, at: string, text: string, targetId = 's1'): Note =>
  ({
    id,
    v: 1,
    rev: 1,
    targetType: 'supply',
    targetId,
    text,
    profileId: 'p',
    at,
    visibleToTenants: false,
  }) as Note;

let root: HTMLElement;
beforeEach(() => {
  root = document.createElement('div');
});
const btn = (name: string) =>
  [...root.querySelectorAll('button')].find((b) => b.textContent === name) as HTMLButtonElement;

function render(over: Partial<Parameters<typeof renderSupplies>[1]> = {}) {
  const input = {
    supplies: [supply],
    apartments,
    notes: [
      note('n1', '2026-11-01T10:00:00.000Z', 'vecchia'),
      note('n2', '2026-11-10T10:00:00.000Z', 'nuova'),
      note('n3', '2026-11-12T10:00:00.000Z', 'di un altro', 's9'),
    ],
    onUpdate: vi.fn(() => Promise.resolve()),
    onRemove: vi.fn(() => Promise.resolve()),
    onAddNote: vi.fn<(s: Supply, t: string) => Promise<void>>(() => Promise.resolve()),
    ...over,
  };
  renderSupplies(root, input);
  return input;
}

describe('renderSupplies', () => {
  it('shows label, apartments with percentages and its notes newest first', () => {
    render();
    expect(root.querySelector('h3')?.textContent).toBe('IT001');
    const apts = [...root.querySelectorAll('.apartments li')].map((li) => li.textContent);
    expect(apts).toEqual(['Appartamento Uno: 66,67%', 'Appartamento Due: 33,33%']);
    const notes = [...root.querySelectorAll('.notes li')].map((li) => li.textContent);
    expect(notes).toEqual(['nuova', 'vecchia']);
  });

  it('calls the callbacks for change and remove', () => {
    const input = render();
    btn('Modifica').click();
    btn('Rimuovi').click();
    expect(input.onUpdate).toHaveBeenCalledWith(supply);
    expect(input.onRemove).toHaveBeenCalledWith(supply);
  });

  it('adds a note through the inline field', async () => {
    const input = render();
    btn('Aggiungi nota').click();
    const field = root.querySelector('textarea') as HTMLTextAreaElement;
    field.value = 'Da verificare';
    btn('Salva nota').click();
    await vi.waitFor(() => expect(input.onAddNote).toHaveBeenCalledWith(supply, 'Da verificare'));
  });

  it('shows the stale write message and a generic one for other errors', async () => {
    const stale = Object.assign(new Error('x'), { name: 'StaleWriteError' });
    const onRemove = vi
      .fn()
      .mockRejectedValueOnce(stale)
      .mockRejectedValueOnce(new Error('dettaglio'));
    render({ onRemove });
    btn('Rimuovi').click();
    await vi.waitFor(() =>
      expect(root.querySelector('.error')?.textContent).toBe(
        "Un'altra persona ha cambiato questa utenza. Ricarica e riprova.",
      ),
    );
    btn('Rimuovi').click();
    await vi.waitFor(() =>
      expect(root.querySelector('.error')?.textContent).toBe('Non è stato possibile salvare.'),
    );
  });

  it('says what to do when there are no supplies', () => {
    render({ supplies: [] });
    expect(root.textContent).toContain('Nessuna utenza collegata');
  });
});
