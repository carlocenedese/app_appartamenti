import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupplyDraft } from '@bollette/core';
import { renderSupplyLink } from '../src/supply-link-view';

const apartments = [
  { id: 'a1', name: 'Appartamento Uno' },
  { id: 'a2', name: 'Appartamento Due' },
];
let root: HTMLElement;
beforeEach(() => {
  root = document.createElement('div');
});
const button = () => root.querySelector('button.primary') as HTMLButtonElement;
const total = () => root.querySelector('.total')?.textContent;
function type(input: HTMLInputElement, text: string): void {
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
function twoSuggestions(onConfirm = vi.fn(() => Promise.resolve())) {
  renderSupplyLink(root, {
    label: 'IT001',
    suggested: [
      { apartmentId: 'a1', origin: 'catasto' },
      { apartmentId: 'a2', origin: 'indirizzo' },
    ],
    apartments,
    onConfirm,
  });
  return onConfirm;
}

describe('renderSupplyLink', () => {
  it('disables the button at 85% and enables it at 100%, with the total updating live', () => {
    twoSuggestions();
    const fields = root.querySelectorAll<HTMLInputElement>('input.percent');
    expect(button().textContent).toBe('Collega e continua');
    expect(button().disabled).toBe(true);
    type(fields[0] as HTMLInputElement, '50');
    type(fields[1] as HTMLInputElement, '35');
    expect(total()).toBe('Totale: 85,00%');
    expect(button().disabled).toBe(true);
    expect(root.querySelector('.problem')?.textContent).toContain('manca il 15,00%');
    type(fields[1] as HTMLInputElement, '50');
    expect(total()).toBe('Totale: 100,00%');
    expect(button().disabled).toBe(false);
    expect(root.querySelector('.problem')?.textContent).toBe('');
  });

  it('shows suggestions already chosen, with their origin', () => {
    twoSuggestions();
    const selects = root.querySelectorAll<HTMLSelectElement>('select');
    expect(selects[0]?.value).toBe('a1');
    expect(selects[1]?.value).toBe('a2');
    const chips = [...root.querySelectorAll('.chip')].map((c) => c.textContent);
    expect(chips).toEqual(['da catasto', 'da indirizzo']);
  });

  it('does not ask for the percentage with one suggestion, and confirms at once', async () => {
    const onConfirm = vi.fn<(d: SupplyDraft) => Promise<void>>(() => Promise.resolve());
    renderSupplyLink(root, {
      label: 'IT002',
      suggested: [{ apartmentId: 'a2', origin: 'catasto' }],
      apartments,
      onConfirm,
    });
    expect(root.querySelectorAll('input.percent')).toHaveLength(0);
    expect(total()).toBe('Totale: 100,00%');
    expect(button().disabled).toBe(false);
    const note = root.querySelector('textarea') as HTMLTextAreaElement;
    note.value = 'Contatore condiviso';
    note.dispatchEvent(new Event('input', { bubbles: true }));
    button().click();
    await Promise.resolve();
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onConfirm.mock.calls[0]?.[0]).toEqual({
      label: 'IT002',
      rows: [{ apartmentId: 'a2', basisPoints: 10000 }],
      note: 'Contatore condiviso',
    });
  });

  it('labels the note field and says it stays visible', () => {
    twoSuggestions();
    expect(root.textContent).toContain('Nota (facoltativa)');
    expect(root.textContent).toContain("Resta visibile accanto all'utenza.");
  });

  it('adds a row with «+ Aggiungi appartamento»', () => {
    twoSuggestions();
    const add = [...root.querySelectorAll('button')].find(
      (b) => b.textContent === '+ Aggiungi appartamento',
    ) as HTMLButtonElement;
    add.click();
    expect(root.querySelectorAll('select')).toHaveLength(3);
    expect(root.querySelector('.problem')?.textContent).toBe("Scegli l'appartamento di ogni riga.");
  });

  it('shows the stale write message, or a generic one without the error text', async () => {
    const stale = Object.assign(new Error('x'), { name: 'StaleWriteError' });
    const onConfirm = vi
      .fn()
      .mockRejectedValueOnce(stale)
      .mockRejectedValueOnce(new Error('/etc/secret'));
    renderSupplyLink(root, {
      label: 'IT003',
      suggested: [{ apartmentId: 'a1', origin: 'indirizzo' }],
      apartments,
      onConfirm,
    });
    button().click();
    await vi.waitFor(() =>
      expect(root.querySelector('.error')?.textContent).toBe(
        "Un'altra persona ha cambiato questa utenza. Ricarica e riprova.",
      ),
    );
    await vi.waitFor(() => expect(button().disabled).toBe(false));
    button().click();
    await vi.waitFor(() =>
      expect(root.querySelector('.error')?.textContent).toBe('Non è stato possibile salvare.'),
    );
  });

  it('keeps the button disabled after a successful confirm: a second click does nothing', async () => {
    const onConfirm = vi.fn(() => Promise.resolve());
    renderSupplyLink(root, {
      label: 'IT004',
      suggested: [{ apartmentId: 'a1', origin: 'catasto' }],
      apartments,
      onConfirm,
    });
    button().click();
    await vi.waitFor(() => expect(onConfirm).toHaveBeenCalledOnce());
    await Promise.resolve();
    expect(button().disabled).toBe(true);
    button().click();
    await Promise.resolve();
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('removes a row with «Rimuovi riga», only while there are several', () => {
    twoSuggestions();
    const remove = () =>
      [...root.querySelectorAll('button')].filter((b) => b.textContent === 'Rimuovi riga');
    expect(remove()).toHaveLength(2);
    (remove()[0] as HTMLButtonElement).click();
    expect(root.querySelectorAll('select')).toHaveLength(1);
    expect(remove()).toHaveLength(0);
    // The remaining row is the whole supply: 100% and no percentage field.
    expect(root.querySelectorAll('input.percent')).toHaveLength(0);
    expect(total()).toBe('Totale: 100,00%');
    expect(button().disabled).toBe(false);
  });

  it('starts with one empty row when nothing is suggested, and a chosen apartment gets 100%', () => {
    renderSupplyLink(root, { label: 'IT005', suggested: [], apartments, onConfirm: vi.fn() });
    const select = root.querySelector('select') as HTMLSelectElement;
    expect(root.querySelectorAll('select')).toHaveLength(1);
    expect(select.value).toBe('');
    select.value = 'a2';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(root.querySelectorAll('input.percent')).toHaveLength(0);
    expect(total()).toBe('Totale: 100,00%');
    expect(button().disabled).toBe(false);
  });

  it('starts from an initial draft when given', () => {
    renderSupplyLink(root, {
      label: 'ignored',
      suggested: [],
      apartments,
      initial: {
        label: 'IT006',
        rows: [
          { apartmentId: 'a1', basisPoints: 6000 },
          { apartmentId: 'a2', basisPoints: 4000 },
        ],
        note: '',
      },
      onConfirm: vi.fn(),
    });
    expect(total()).toBe('Totale: 100,00%');
    expect(root.querySelector('.label')?.textContent).toBe('IT006');
    expect(root.querySelectorAll<HTMLInputElement>('input.percent')[0]?.value).toBe('60,00');
  });

  it('limits the note to 2000 characters', () => {
    twoSuggestions();
    expect((root.querySelector('textarea') as HTMLTextAreaElement).maxLength).toBe(2000);
  });
});
