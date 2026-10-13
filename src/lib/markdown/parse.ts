import { parser, TaskList, Strikethrough, Autolink } from '@lezer/markdown'

/**
 * O singură gramatică pentru cititor și editor, ca ce vezi citind să fie
 * exact ce vezi scriind. Fără `Table`: tabelele nu sunt în subset și rămân text.
 */
export const mdParser = parser.configure([TaskList, Strikethrough, Autolink])
