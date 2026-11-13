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
  /** Starts from this draft (editing a supply) instead of the suggestions. */
  initial?: SupplyDraft;
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
  const draft =
    input.initial === undefined
      ? newDraft(input.label, input.suggested)
      : { ...input.initial, rows: input.initial.rows.map((r) => ({ ...r })) };
  const originOf = (id: string) => input.suggested.find((s) => s.apartmentId === id)?.origin;
  // A single row at 100% is the whole supply, so the percentage is not asked.
  const askPercent = () => !(draft.rows.length === 1 && draft.rows[0]?.basisPoints === 10000);
  // A lone row chosen by hand is the whole supply too.
  const fillLone = () => {
    const [only] = draft.rows;
    if (draft.rows.length === 1 && only !== undefined && only.basisPoints === 0) {
      only.basisPoints = 10000;
    }
  };
  let done = false;

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
    confirm.disabled = done || p !== undefined;
  }

  async function submit(): Promise<void> {
    confirm.disabled = true;
    error.textContent = '';
    try {
      await input.onConfirm(draft);
      done = true;
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
        fillLone();
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
      if (draft.rows.length > 1) {
        line.append(
          button('Rimuovi riga', () => {
            draft.rows.splice(index, 1);
            fillLone();
            renderRows();
          }),
        );
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
  noteField.maxLength = 2000;
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
    el('p', 'label', draft.label),
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
