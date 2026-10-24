import { parser, TaskList, Strikethrough, Autolink, Table } from '@lezer/markdown'

/**
 * O singură gramatică pentru cititor și editor, ca ce vezi citind să fie
 * exact ce vezi scriind. Tabelele (GFM) intră din 2026-10-24: uneltele care
 * scriu descrieri prin ticket-kit le folosesc, iar ca text erau ilizibile.
 */
export const mdParser = parser.configure([TaskList, Strikethrough, Autolink, Table])
