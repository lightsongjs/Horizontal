import { describe, expect, it } from 'vitest'
import { formatStrv, KEYBINDING_PATH, parseStrv, withoutPath, withPath } from './gsettings.mjs'

const custom0 = '/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom0/'

describe('lista de scurtături GNOME', () => {
  it('citește forma pe care o tipărește gsettings', () => {
    expect(parseStrv(`['${custom0}']`)).toEqual([custom0])
    expect(parseStrv('@as []')).toEqual([])
    expect(parseStrv('[]')).toEqual([])
  })
  it('adaugă scurtătura fără să atingă custom0, o singură dată', () => {
    expect(withPath([custom0], KEYBINDING_PATH)).toEqual([custom0, KEYBINDING_PATH])
    expect(withPath([custom0, KEYBINDING_PATH], KEYBINDING_PATH)).toEqual([custom0, KEYBINDING_PATH])
  })
  it('dezinstalarea scoate doar scurtătura noastră', () => {
    expect(withoutPath([custom0, KEYBINDING_PATH], KEYBINDING_PATH)).toEqual([custom0])
  })
  it('scrie forma pe care o acceptă gsettings set', () => {
    expect(formatStrv([custom0, KEYBINDING_PATH])).toBe(`['${custom0}', '${KEYBINDING_PATH}']`)
    expect(formatStrv([])).toBe('@as []')
  })
})
