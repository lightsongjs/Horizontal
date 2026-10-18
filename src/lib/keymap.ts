/**
 * Harta de taste a modului Vim, ca DATE, plus mașinăria pură care transformă
 * apăsări în acțiuni: tasta → token, secvențe (`gg`, `ga`), numărători (`5j`),
 * contexte (listă / panou / bara laterală / oriunde).
 *
 * Nimic de aici nu atinge DOM-ul sau React-ul: dispecerul (`useKeyDispatcher`
 * din `src/vim.tsx`) citește evenimentul, cere un token, îl dă lui `feed` și
 * execută ce iese. De-aia totul se poate testa cu fixtures — inclusiv
 * tastatura românească, unde ș / ă / î nu sunt ASCII.
 *
 * Harta e o singură sursă: dispecerul o folosește ca să decidă, iar ajutorul
 * (`InfoPanel`, într-o fază următoare) și fereastra „which-key" o citesc ca să
 * arate. O tastă scrisă în două locuri ar fi divergat la prima schimbare.
 */

/** Unde e focusul. `any` = oriunde (global). */
export type KeyCtx = 'list' | 'panel' | 'sidebar' | 'any'

/** Ce face o tastă. Dispecerul are câte un handler pentru fiecare. */
export type ActionId =
  | 'goToday' | 'goWeek' | 'goMine' | 'goTo' | 'search' | 'help' | 'toggleSidebar' | 'settings'
  | 'historyBack' | 'historyForward' | 'undo' | 'wavePrev' | 'waveNext' | 'waveManage'
  // listă: mișcări, panouri
  | 'down' | 'up' | 'groupDown' | 'groupUp' | 'first' | 'last' | 'open' | 'toPanel' | 'toSidebar'
  // listă: acțiuni pe rânduri (ținte: intervalul vizual > selecția > rândul cursorului)
  | 'done' | 'delete' | 'tomorrow' | 'date' | 'urgent' | 'pin' | 'move' | 'rename'
  | 'yankLink' | 'yankTitle' | 'repeat' | 'find' | 'filter' | 'nextMatch' | 'prevMatch'
  | 'mark' | 'visual' | 'newTask' | 'menu'
  // panou: cursorul de câmp și scurtăturile pe tichetul deschis
  | 'toList' | 'fieldDown' | 'fieldUp' | 'fieldFirst' | 'fieldLast' | 'sectionDown' | 'sectionUp' | 'activate'
  | 'pTitle' | 'pDesc' | 'pComment' | 'pHandoff' | 'pRename' | 'pDate' | 'pWave'
  | 'pDone' | 'pUrgent' | 'pPin' | 'pMove' | 'pDelete' | 'pYankLink' | 'pYankTitle'
  // bara laterală
  | 'sbDown' | 'sbUp' | 'sbFirst' | 'sbLast' | 'sbOpen'

export interface Binding {
  /** Tokenii secvenței, în ordine: `['g', 'g']`, `['Enter']`. */
  seq: string[]
  ctx: KeyCtx
  id: ActionId
  /** Ce se scrie în ajutor și în fereastra „which-key". */
  desc: string
  /** O mișcare: singurul fel de tastă care primește o numărătoare (`5j`). */
  motion?: boolean
  /** Dublură (săgețile): merge, dar nu se listează. */
  hidden?: boolean
}

const b = (seq: string, ctx: KeyCtx, id: ActionId, desc: string, extra: Partial<Binding> = {}): Binding =>
  ({ seq: splitSeq(seq), ctx, id, desc, ...extra })

/** `'gg'` → `['g','g']`; un nume de tastă (`Enter`, `ArrowDown`) e un singur token. */
export function splitSeq(s: string): string[] {
  return /^(Enter|Space|Escape|Arrow[A-Za-z]+)$/.test(s) ? [s] : [...s]
}

/**
 * Toată harta: navigarea (cursorul, panourile, ecranele), acțiunile pe rând,
 * cursorul de câmp din panou și valurile. Ce nu e aici rămâne al
 * ascultătorilor vechi (C în „Cards", T, S, 1–4, Ctrl+S…).
 */
export const KEYMAP: Binding[] = [
  // oriunde
  // Mnemonice în engleză, consecvent: today / week / mine.
  b('gt', 'any', 'goToday', 'Mergi la Azi (today)'),
  b('gw', 'any', 'goWeek', 'Mergi la 7 zile (week)'),
  b('gm', 'any', 'goMine', 'Mergi la Ale mele (mine)'),
  b('gp', 'any', 'goTo', '„Mergi la…” (proiect, filtru, listă, val)'),
  b('z', 'any', 'goTo', '„Mergi la…” (ca zoxide în yazi)'),
  b(':', 'any', 'goTo', '„Mergi la…” (pe RO: Shift + ș)'),
  b('/', 'any', 'search', 'Caută tichet în toate proiectele (și O, Ctrl+F)'),
  b('O', 'any', 'search', 'Caută tichet în toate proiectele (ca /)'),
  b('?', 'any', 'help', 'Ajutorul cu tastele'),
  b('gs', 'any', 'toggleSidebar', 'Ascunde / arată bara laterală'),
  b('g,', 'any', 'settings', 'Setări (mod Vim, panoul urmează cursorul)'),
  b('H', 'any', 'historyBack', 'Înapoi în istoric'),
  b('L', 'any', 'historyForward', 'Înainte în istoric'),
  b('u', 'any', 'undo', 'Anulează ultima acțiune (ce oferă toastul)'),
  b('[', 'any', 'wavePrev', 'Valul anterior (pe RO: tasta ă)'),
  b(']', 'any', 'waveNext', 'Valul următor (pe RO: tasta î)'),
  b('gv', 'any', 'waveManage', 'Foaia „Valuri”: redenumește, mută, adaugă'),
  // listă: mișcări
  b('j', 'list', 'down', 'Rândul următor (5j = 5 rânduri)', { motion: true }),
  b('k', 'list', 'up', 'Rândul anterior', { motion: true }),
  b('ArrowDown', 'list', 'down', 'Rândul următor', { motion: true, hidden: true }),
  b('ArrowUp', 'list', 'up', 'Rândul anterior', { motion: true, hidden: true }),
  b('J', 'list', 'groupDown', 'Grupul următor (zi, layer)', { motion: true }),
  b('K', 'list', 'groupUp', 'Grupul anterior', { motion: true }),
  b('gg', 'list', 'first', 'Primul rând'),
  b('G', 'list', 'last', 'Ultimul rând'),
  b('Enter', 'list', 'open', 'Deschide în panou (focusul rămâne în listă)'),
  b('o', 'list', 'open', 'Deschide în panou (ca Enter)'),
  b('l', 'list', 'toPanel', 'Intră în panou'),
  b('h', 'list', 'toSidebar', 'Intră în bara laterală'),
  // listă: acțiuni
  b('x', 'list', 'done', 'Gata / redeschide'),
  b('dd', 'list', 'delete', 'Șterge (fără întrebare; u anulează)'),
  b('D', 'list', 'tomorrow', 'Mută pe mâine'),
  b('t', 'list', 'date', 'Dată și oră (direct în sub-meniu; cifrele scriu ora)'),
  b('m', 'list', 'menu', 'Meniul de acțiuni (dată, urgent, mută, …) — și pe selecție'),
  b('!', 'list', 'urgent', 'Urgent'),
  b('F', 'list', 'pin', 'Fixează sus / scoate de sus'),
  b('M', 'list', 'move', 'Mută în alt proiect (un tichet)'),
  b('r', 'list', 'rename', 'Redenumește (în panou, titlul selectat)'),
  b('cc', 'list', 'rename', 'Redenumește (ca r)'),
  b('yy', 'list', 'yankLink', 'Copiază linkul'),
  b('yt', 'list', 'yankTitle', 'Copiază titlul'),
  b('.', 'list', 'repeat', 'Repetă ultima acțiune pe rândurile de acum'),
  b('f', 'list', 'filter', 'Filtrează lista (ascunde restul)'),
  b('Space', 'list', 'mark', 'Pune / scoate rândul din selecție și coboară'),
  b('v', 'list', 'visual', 'Selecție pe interval (j / k o întind)'),
  b('V', 'list', 'visual', 'Selecție pe interval (ca v)'),
  // `a` ca în yazi (append / create). C nu mai creează cu modul Vim pornit.
  b('a', 'list', 'newTask', 'Sarcină nouă în grupul cursorului (aceeași zi / valul activ)'),
  // panou: cursorul de câmp
  b('j', 'panel', 'fieldDown', 'Următorul: titlu → jetoane → descriere → fiecare dependență → fir', { motion: true }),
  b('k', 'panel', 'fieldUp', 'Câmpul anterior', { motion: true }),
  b('ArrowDown', 'panel', 'fieldDown', 'Câmpul următor', { motion: true, hidden: true }),
  b('ArrowUp', 'panel', 'fieldUp', 'Câmpul anterior', { motion: true, hidden: true }),
  b('gg', 'panel', 'fieldFirst', 'Primul câmp (titlul)'),
  b('G', 'panel', 'fieldLast', 'Ultimul câmp (comentariul)'),
  b('J', 'panel', 'sectionDown', 'Secțiunea următoare: titlu → jetoane → descriere → dependențe → fir'),
  b('K', 'panel', 'sectionUp', 'Secțiunea anterioară'),
  b('Enter', 'panel', 'activate', 'Activează: scrie / meniul (pe jetoane) / deschide dependența'),
  b('l', 'panel', 'activate', 'Activează câmpul (ca Enter)'),
  b('Space', 'panel', 'activate', 'Activează câmpul (ca Enter)'),
  b('h', 'panel', 'toList', 'Înapoi în listă'),
  b('ArrowLeft', 'panel', 'toList', 'Înapoi în listă', { hidden: true }),
  // panou: scurtături
  b('i', 'panel', 'pTitle', 'Scrie în titlu'),
  b('a', 'panel', 'pDesc', 'Scrie în descriere, la final'),
  b('m', 'panel', 'menu', 'Meniul de acțiuni, pe tichetul deschis'),
  b('gc', 'panel', 'pComment', 'Scrie un comentariu'),
  b('@', 'panel', 'pHandoff', 'Pasează (comentariu „către…”)'),
  b('r', 'panel', 'pRename', 'Rescrie titlul (selectat)'),
  b('cc', 'panel', 'pRename', 'Rescrie titlul (ca r)'),
  b('t', 'panel', 'pDate', 'Dată și oră (sub-meniul)'),
  b('w', 'panel', 'pWave', 'Valul'),
  b('x', 'panel', 'pDone', 'Gata / redeschide'),
  b('!', 'panel', 'pUrgent', 'Urgent'),
  b('F', 'panel', 'pPin', 'Fixează sus'),
  b('M', 'panel', 'pMove', 'Mută în alt proiect'),
  b('dd', 'panel', 'pDelete', 'Șterge tichetul (u anulează)'),
  b('yy', 'panel', 'pYankLink', 'Copiază linkul'),
  b('yt', 'panel', 'pYankTitle', 'Copiază titlul'),
  // bara laterală
  b('j', 'sidebar', 'sbDown', 'Următorul', { motion: true }),
  b('k', 'sidebar', 'sbUp', 'Anteriorul', { motion: true }),
  b('ArrowDown', 'sidebar', 'sbDown', 'Următorul', { motion: true, hidden: true }),
  b('ArrowUp', 'sidebar', 'sbUp', 'Anteriorul', { motion: true, hidden: true }),
  b('gg', 'sidebar', 'sbFirst', 'Primul'),
  b('G', 'sidebar', 'sbLast', 'Ultimul'),
  b('Enter', 'sidebar', 'sbOpen', 'Deschide'),
  b('l', 'sidebar', 'sbOpen', 'Deschide și treci în listă'),
  b('h', 'sidebar', 'toList', 'Înapoi în listă'),
]

/** Acțiunile care se pot repeta cu `.` (cele care schimbă rândurile). */
export const REPEATABLE: ReadonlySet<ActionId> = new Set(['done', 'delete', 'tomorrow', 'urgent', 'pin'])

/** Cât așteaptă o secvență începută (`g…`) continuarea. */
export const SEQ_TIMEOUT_MS = 1000
/** Fereastra cu continuările apare abia după o ezitare. */
export const WHICH_KEY_DELAY_MS = 400

// ─── tasta → token ─────────────────────────────────────────────────────────

/**
 * Punctuația după POZIȚIA tastei, pentru tastaturile unde tasta scrie altceva
 * decât ASCII. Pe „Română (standard)” tasta lui `;` scrie `ș`, a lui `[` scrie
 * `ă`: după `e.key`, `:` și `[` n-ar exista deloc pe tastatura omului.
 */
const BY_CODE: Record<string, [string, string]> = {
  Semicolon: [';', ':'],
  BracketLeft: ['[', '{'],
  BracketRight: [']', '}'],
  Slash: ['/', '?'],
  Period: ['.', '>'],
  Comma: [',', '<'],
  Quote: ["'", '"'],
  Backslash: ['\\', '|'],
}

export interface KeyLike {
  key: string
  code?: string
  shiftKey?: boolean
}

/**
 * Tokenul unei apăsări, sau null pentru o tastă care nu înseamnă nimic aici
 * (Shift singur, Tab, F5…). Literele și ASCII-ul după ce SCRIE tasta (`J`
 * e Shift+j, oricare ar fi aranjamentul); ce nu e ASCII (ă ș ț â î, taste
 * moarte) cade pe poziție, prin `e.code`.
 */
export function token(e: KeyLike): string | null {
  const k = e.key
  if (k === 'Enter') return 'Enter'
  if (k === ' ' || k === 'Spacebar') return 'Space'
  if (k === 'Escape' || k === 'Esc') return 'Escape'
  if (k.startsWith('Arrow')) return k
  if (/^[\x21-\x7e]$/.test(k)) return k
  const byCode = e.code ? BY_CODE[e.code] : undefined
  if (byCode) return byCode[e.shiftKey ? 1 : 0]
  return null
}

// ─── secvențe ──────────────────────────────────────────────────────────────

export interface SeqState {
  /** Tokenii secvenței în curs (fără numărătoare). */
  keys: string[]
  /** Numărătoarea tastată înainte (`'12'`), încă text. */
  count: string
  /** Când a venit ultima tastă — o secvență mai veche de `SEQ_TIMEOUT_MS` se uită. */
  at: number
}

export const EMPTY_SEQ: SeqState = { keys: [], count: '', at: 0 }

export interface FeedOptions {
  /** Contextul în care e focusul: `list`, `panel`, `sidebar`, sau null (niciunul — doar globalele). */
  ctx: Exclude<KeyCtx, 'any'> | null
  now: number
  /** Numărătorile au sens doar unde există o mișcare (lista, bara laterală). */
  allowCount: boolean
  bindings?: Binding[]
}

export type FeedResult =
  /** Execută. `count` ≥ 1, mereu 1 pentru ce nu e mișcare. */
  | { kind: 'fire'; binding: Binding; count: number }
  /** Secvență sau numărătoare în curs: tasta e a noastră, așteptăm. */
  | { kind: 'pending' }
  /** O secvență începută s-a rupt (`g` + o tastă fără sens): tasta se înghite. */
  | { kind: 'broken' }
  /** Tasta nu e a noastră: rămâne ascultătorilor vechi. */
  | { kind: 'none' }

/** Legăturile care se aplică în contextul dat: localul bate globalul la aceeași secvență. */
export function activeBindings(ctx: FeedOptions['ctx'], bindings: Binding[] = KEYMAP): Binding[] {
  const es = bindings.filter((x) => x.ctx === 'any' || x.ctx === ctx)
  const key = (x: Binding) => x.seq.join('\u0000')
  const local = new Set(es.filter((x) => x.ctx !== 'any').map(key))
  return es.filter((x) => x.ctx !== 'any' || !local.has(key(x)))
}

const startsWith = (seq: string[], prefix: string[]) =>
  seq.length >= prefix.length && prefix.every((t, i) => seq[i] === t)

/** Candidații pentru un prefix: exactul (dacă e) și cele mai lungi. */
export function candidates(prefix: string[], es: Binding[]): { exact: Binding | null; longer: Binding[] } {
  const all = es.filter((x) => startsWith(x.seq, prefix))
  return {
    exact: all.find((x) => x.seq.length === prefix.length) ?? null,
    longer: all.filter((x) => x.seq.length > prefix.length),
  }
}

const countOf = (s: string) => Math.max(1, parseInt(s || '1', 10) || 1)
const fire = (binding: Binding, count: string): FeedResult =>
  ({ kind: 'fire', binding, count: binding.motion ? countOf(count) : 1 })

/**
 * Un token în plus. Întoarce starea nouă și ce s-a hotărât.
 *
 * - Numărătoarea: o cifră 1–9 cu secvența goală (sau 0 după o cifră) se
 *   adună, doar unde `allowCount`; se aplică numai mișcărilor.
 * - Un exact fără continuări mai lungi pleacă imediat; cu continuări (`g`
 *   n-are exact, dar ar putea avea) așteaptă — `expire` îl trage la timeout.
 * - Un token necunoscut cu secvența goală nu e al nostru (`none`); cu o
 *   secvență în curs, o rupe și se înghite (`broken`).
 */
export function feed(state: SeqState, tok: string, opts: FeedOptions): { state: SeqState; result: FeedResult } {
  // O secvență rămasă de acum o oră nu se lipește de tasta de acum.
  const s = state.at && opts.now - state.at > SEQ_TIMEOUT_MS ? EMPTY_SEQ : state
  if (opts.allowCount && s.keys.length === 0 && (/^[1-9]$/.test(tok) || (tok === '0' && s.count))) {
    return { state: { keys: [], count: s.count + tok, at: opts.now }, result: { kind: 'pending' } }
  }
  const es = activeBindings(opts.ctx, opts.bindings)
  const keys = [...s.keys, tok]
  const { exact, longer } = candidates(keys, es)
  if (exact && longer.length === 0) return { state: EMPTY_SEQ, result: fire(exact, s.count) }
  if (exact || longer.length) return { state: { keys, count: s.count, at: opts.now }, result: { kind: 'pending' } }
  // O numărătoare singură („5" + o tastă străină) se uită și lasă tasta să treacă.
  return { state: EMPTY_SEQ, result: s.keys.length > 0 ? { kind: 'broken' } : { kind: 'none' } }
}

/** Timpul a expirat: un exact așteptat pleacă (`g` singur, dacă ar exista), restul se uită. */
export function expire(state: SeqState, opts: Pick<FeedOptions, 'ctx' | 'bindings'>): { state: SeqState; result: FeedResult } {
  if (!state.keys.length) return { state: EMPTY_SEQ, result: { kind: 'none' } }
  const { exact } = candidates(state.keys, activeBindings(opts.ctx, opts.bindings))
  return { state: EMPTY_SEQ, result: exact ? fire(exact, state.count) : { kind: 'none' } }
}

/** Continuările unui prefix, pentru fereastra „which-key". */
export function continuations(state: SeqState, ctx: FeedOptions['ctx'], bindings: Binding[] = KEYMAP): { rest: string; desc: string }[] {
  if (!state.keys.length) return []
  const { longer } = candidates(state.keys, activeBindings(ctx, bindings))
  return longer.filter((x) => !x.hidden).map((x) => ({ rest: x.seq.slice(state.keys.length).join(''), desc: x.desc }))
}

/** Ce se arată în pastila de jos: „5", „g…", „2g…". */
export function pendingLabel(state: SeqState): string {
  if (!state.keys.length && !state.count) return ''
  return state.count + (state.keys.length ? `${state.keys.join('')}…` : '')
}

/**
 * Focusul e într-un câmp în care se scrie: tastele simple sunt ale lui, nu
 * ale noastre. `SELECT` inclus (o săgeată schimbă opțiunea), ca și editorul
 * CodeMirror (contenteditable, dar și orice element din el).
 */
export function isTypingTarget(el: Element | null): boolean {
  if (!el) return false
  const tag = el.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(type)
  }
  if ((el as HTMLElement).isContentEditable) return true
  return !!el.closest?.('.cm-editor')
}
