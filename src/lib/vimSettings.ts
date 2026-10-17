/**
 * Cele două comutatoare ale navigării din tastatură, din rotița de setări.
 * Se țin pe DISPOZITIV, ca mărimea textului: pe laptopul cu tastatură vrei
 * modul Vim, pe tableta cu husă poate nu.
 *
 * Amândouă pornite implicit — o valoare lipsă sau necunoscută e „pornit"; doar
 * un „off" scris explicit le oprește.
 */
export const VIM_KEY = 'horizontal-vim'
export const FOLLOW_KEY = 'horizontal-vim-follow'

export function parseFlag(raw: string | null): boolean {
  return raw !== 'off'
}

export function serializeFlag(on: boolean): string {
  return on ? 'on' : 'off'
}
