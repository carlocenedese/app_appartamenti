import {
  draftProblem,
  draftTotal,
  newDraft,
  type ApartmentSuggestion,
  type SupplyDraft,
} from '@bollette/core';
import { button, el, formatPercent, parsePercent, saveErrorMessage } from './view-util';

export interface SupplyLinkInput {
  label: string;
  suggested: ApartmentSuggestion[];
  apartments: { id: string; name: string }[];
  onConfirm: (draft: SupplyDraft) => Promise<void>;
}

function option(text: string, value: string): HTMLOptionElement {
  const o = el('option', '', text);
  o.value = value;
  return o;
}

/** «A chi appartiene l'utenza?»: rows of apartment and percentage; totals and problems come from the core. */
export function renderSupplyLink(root: HTMLElement, input: SupplyLinkInput): void {
  const draft = newDraft(input.label, input.suggested);
  // newDraft leaves the apartments of several suggestions empty; the suggestion is chosen here.
  draft.rows.forEach((row, i) => {
    row.apartmentId ||= input.suggested[i]?.apartmentId ?? '';
  });
  const originOf = (id: string) => input.suggested.find((s) => s.apartmentId === id)?.origin;
  // With one suggestion the row is fixed at 100%, so the percentage is not asked.
  const askPercent = () => !(input.suggested.length === 1 && draft.rows.length === 1);

  const rowsBox = el('div', 'rows');
  const total = el('p', 'total');
  const problem = el('p', 'problem');
  problem.setAttribute('role', 'status');
  const error = el('p', 'error');
  error.setAttribute('role', 'alert');
  const confirm = button('Collega e continua', () => void submit(), true);

  function refresh(): void {
    total.textContent = `Totale: ${formatPercent(draftTotal(draft))}`;
    const p = draftProblem(draft);
    problem.textContent = p ?? '';
    confirm.disabled = p !== undefined;
  }

  async function submit(): Promise<void> {
    confirm.disabled = true;
    error.textContent = '';
    try {
      await input.onConfirm(draft);
    } catch (e) {
      error.textContent = saveErrorMessage(e);
    }
    refresh();
  }

  function renderRows(): void {
    rowsBox.replaceChildren();
    draft.rows.forEach((row, index) => {
      const line = el('div', 'row');
      const select = el('select');
      select.setAttribute('aria-label', `Appartamento ${index + 1}`);
      select.append(option('Scegli…', ''));
      for (const a of input.apartments) select.append(option(a.name, a.id));
      select.value = row.apartmentId;
      select.addEventListener('change', () => {
        row.apartmentId = select.value;
        renderRows();
      });
      line.append(select);
      const origin = originOf(row.apartmentId);
      if (origin !== undefined) line.append(el('span', 'chip', `da ${origin}`));
      if (askPercent()) {
        const field = el('input', 'percent');
        field.type = 'text';
        field.inputMode = 'decimal';
        field.setAttribute('aria-label', `Percentuale ${index + 1}`);
        field.value = row.basisPoints === 0 ? '' : formatPercent(row.basisPoints).slice(0, -1);
        field.addEventListener('input', () => {
          const parsed = parsePercent(field.value);
          row.basisPoints = parsed ?? 0;
          field.setAttribute('aria-invalid', String(parsed === undefined));
          refresh();
        });
        line.append(field, el('span', '', '%'));
      }
      rowsBox.append(line);
    });
    refresh();
  }

  const add = button('+ Aggiungi appartamento', () => {
    draft.rows.push({ apartmentId: '', basisPoints: 0 });
    renderRows();
  });

  const noteLabel = el('label', 'note');
  const noteField = el('textarea');
  noteField.addEventListener('input', () => {
    draft.note = noteField.value;
  });
  noteLabel.append(
    el('span', '', 'Nota (facoltativa)'),
    noteField,
    el('small', '', "Resta visibile accanto all'utenza."),
  );

  root.replaceChildren(
    el('h2', '', "A chi appartiene l'utenza?"),
    el('p', 'label', input.label),
    rowsBox,
    add,
    total,
    problem,
    noteLabel,
    error,
    confirm,
  );
  renderRows();
}
