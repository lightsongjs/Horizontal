/**
 * Lista `custom-keybindings` din GNOME e una singură, pentru toate scurtăturile
 * personalizate ale omului (azi: custom0 = Flameshot). Instalarea adaugă calea
 * noastră la listă, n-o rescrie — de-aia funcții care primesc lista existentă.
 */
export const KEYBINDING_PATH = '/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/horizontal/'

export function parseStrv(s) {
  return [...s.matchAll(/'([^']*)'/g)].map((m) => m[1])
}
export function formatStrv(list) {
  return list.length ? `[${list.map((p) => `'${p}'`).join(', ')}]` : '@as []'
}
export function withPath(list, p) {
  return list.includes(p) ? list : [...list, p]
}
export function withoutPath(list, p) {
  return list.filter((x) => x !== p)
}
