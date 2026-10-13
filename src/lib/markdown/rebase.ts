/**
 * Ce face editorul cu o valoare nouă venită prin props (`value`): o rebază
 * reală din store, sau doar ecoul propriilor scrieri, întors prin ciorna
 * autosave-ului?
 *
 * Un ecou nu se aplică NICIODATĂ: poate fi mai vechi decât documentul. Cu
 * Gboard, valoarea amânată pe durata compunerii e cea de la penultima
 * scriere, iar la `compositionend` documentul are deja literele de după ea —
 * aplicată, ar fi șters exact ultimele litere scrise, iar autosave-ul le-ar fi
 * salvat pierdute. De-aia nu ajunge „ultima valoare emisă": ținem toate
 * valorile emise de la ultima sincronizare (mărginit).
 *
 * Sincronizare = store-ul a ajuns la document (valoare egală cu el) sau am
 * aplicat o rebază reală. După ea un text egal cu o scriere veche e o
 * schimbare adevărată (de ex. o anulare pe alt dispozitiv), nu un ecou.
 */
export class Echoes {
  private seen: string[] = []
  constructor(private readonly max = 64) {}

  /** Editorul a trimis `value` prin `onChange`/`onCommit`. */
  emitted(value: string) {
    this.seen.push(value)
    if (this.seen.length > this.max) this.seen.shift()
  }

  /** O rebază reală a fost aplicată: ecourile de dinainte nu mai contează. */
  applied() { this.seen = [] }

  /**
   * `true` = `incoming` e o schimbare din afară și trebuie aplicată peste
   * `doc`. O valoare egală cu documentul închide ecourile (store-ul e la zi).
   */
  shouldApply(incoming: string, doc: string): boolean {
    if (incoming === doc) { this.seen = []; return false }
    return !this.seen.includes(incoming)
  }
}
