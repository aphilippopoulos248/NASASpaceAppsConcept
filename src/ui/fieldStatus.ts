// A field that runs an action shows the action's error in its tooltip and marks itself invalid;
// once the value is accepted the field's own explanation comes back. (Clearing the tooltip on
// success used to drop that explanation for good after the first edit.)

/** Shows the outcome of an action on the field that ran it. The field's own tooltip, if any, is its explanation. */
export function showFieldOutcome(field: HTMLElement, outcome: { ok: boolean; error?: string }): void {
  if (field.dataset.hint === undefined) field.dataset.hint = field.title;
  field.setAttribute('aria-invalid', String(!outcome.ok));
  field.title = outcome.ok ? field.dataset.hint : (outcome.error ?? '');
}
