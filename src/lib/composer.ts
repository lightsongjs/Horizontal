/**
 * Caseta de comentariu din fir: restrânsă sau deschisă (macheta
 * `design/desc-box/index.html`).
 *
 * Descrierea se scrie mult mai des decât un comentariu, deci în repaus caseta
 * e un singur rând (avatarul tău, „Scrie un comentariu…", agrafa), iar
 * acțiunile — imagine, agrafă, „către…", Trimite — apar abia când chiar scrii.
 *
 * Deschisă = cât are focusul ORI cât ține ceva nescris: text, fișiere urcate
 * sau în curs de urcare, un destinatar ales. La blur se strânge doar goală:
 * o casetă care s-ar strânge peste o ciornă ar ascunde exact „Trimite".
 */
export type ComposerState = {
  /** Focusul e undeva în casetă (textarea, „către…", agrafă). */
  focused: boolean
  body: string
  /** Fișiere deja urcate, care pleacă odată cu comentariul. */
  pending: number
  /** Urcări în curs. */
  busy: number
  /** Destinatarul ales: `undefined` = nimeni ales (`null` = „Nimănui" e o alegere). */
  to: string | null | undefined
}

export function composerOpen(s: ComposerState): boolean {
  return s.focused || s.body.trim() !== '' || s.pending > 0 || s.busy > 0 || s.to !== undefined
}
