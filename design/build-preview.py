#!/usr/bin/env python3
"""Generează `design/preview.html` — bancul de probă pentru src/styles.css.

De ce există: aplicația cere login în Supabase, iar o schimbare de stil se vede
abia după ce te-ai autentificat și ai navigat până la ecranul potrivit. Bancul
scoate CSS-ul REAL (`../src/styles.css`) peste DOM-ul real al aplicației, într-un
fișier care se deschide direct în browser.

Ecranul „Controale" nu imită un ecran anume: e o galerie cu fiecare clasă care
și-a pierdut chenarul, în starea normală și în cea activă. Acolo se vede dacă un
buton a rămas fără nicio delimitare.

Rulează: python3 design/build-preview.py   (din rădăcina repo-ului)
"""
import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICON_DIR = os.path.join(ROOT, 'node_modules/lucide-react/dist/esm/icons')

# ── Iconițele, scoase din lucide ca bancul să arate exact ce arată aplicația ──
_ALIAS = {'trash-2': 'trash'}


def icon_body(name):
    src = io.open(os.path.join(ICON_DIR, '%s.mjs' % _ALIAS.get(name, name)), encoding='utf-8').read()
    node = src.split('node: [', 1)[1]
    depth, i = 1, 0
    while depth > 0:
        if node[i] == '[':
            depth += 1
        elif node[i] == ']':
            depth -= 1
        i += 1
    parts = re.findall(r'\[\s*"([a-z]+)"\s*,\s*\{(.*?)\}\s*\]', node[:i - 1], re.S)
    return ''.join(
        '<%s %s/>' % (tag, ' '.join('%s="%s"' % (k, v) for k, v in
                                    re.findall(r'([A-Za-z0-9\-]+)\s*:\s*"([^"]*)"', attrs) if k != 'key'))
        for tag, attrs in parts)


_CACHE = {}


def ic(name, size=18, cls=None):
    if name not in _CACHE:
        _CACHE[name] = icon_body(name)
    return ('<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 24 24" '
            'fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" '
            'stroke-linejoin="round"%s>%s</svg>'
            % (size, size, ' class="%s"' % cls if cls else '', _CACHE[name]))


# ── Bucăți de DOM, cu aceleași clase ca în componente ────────────────────────
def tk(tid, theme, theme_color, title, done=False, urgent=False, deps=None,
       cross=0, due=None, late=False, state=''):
    cls = ' '.join(x for x in ('tk', state, 'done' if done else '') if x)
    meta = ('<span class="theme-dot" style="background:%s"></span>'
            '<span class="tk-id">%s</span><span class="tk-theme">%s</span>' % (theme_color, tid, theme))
    if urgent:
        meta += '<span class="tk-urgent" title="Urgent">%s</span>' % ic('zap', 13)
    sub = ''
    if deps:
        sub += '<span class="dep">%s %s</span>' % (ic('corner-down-right', 13), deps)
    if cross:
        sub += '<span class="tk-children">+%d din alt val</span>' % cross
    if due:
        d, t = due
        sub += ('<span class="due-chip%s"><span class="dc-date">%s</span>%s%s</span>'
                % (' late' if late else '', d,
                   '<span class="dc-time">%s</span>' % t if t else '',
                   '<span class="t-bell" aria-label="Are memento">%s</span>' % ic('bell', 12)))
    return ('<button class="%s" data-title="%s">'
            '<span class="tk-check" role="checkbox" aria-checked="%s">%s</span>'
            '<div class="tk-meta">%s</div><h5>%s</h5>%s</button>'
            % (cls, title, str(done).lower(), ic('circle-check' if done else 'circle', 17),
               meta, title, '<span class="tk-sub">%s</span>' % sub if sub else ''))


def trow(time, title, proj, dot, done=False, late=False, urgent=False, bell=False, allday=False):
    tail = ''
    if urgent:
        tail += '<span class="t-urgent" title="Urgent">%s</span>' % ic('zap', 13)
    if bell:
        tail += '<span class="t-bell" aria-label="Are memento">%s</span>' % ic('bell', 12)
    tail += ('<span class="t-proj"><span class="t-dot" style="background:%s"></span>'
             '<span class="t-proj-name">%s</span></span>' % (dot, proj))
    return ('<button class="list-row task-row%s%s">'
            '<span class="list-check" role="checkbox" aria-checked="%s">%s</span>'
            '<span class="t-time%s">%s</span><span class="list-title">%s</span>'
            '<span class="t-tail">%s</span></button>'
            % (' done' if done else '', ' late' if late else '', str(done).lower(),
               ic('circle-check' if done else 'circle', 17),
               ' allday' if allday else '', time, title, tail))


T = {'email': '#ffb454', 'db': '#3ecf8e', 'auth': '#6e7bff', 'users': '#a06eff', 'expense': '#ff6b6b'}
L = ['var(--layer-0)', 'var(--layer-1)', 'var(--layer-2)', 'var(--layer-3)', 'var(--layer-4)']


def layer(idx, num, title, sub, cards, now=False):
    return ('<div class="layer%s" style="--layer-color: %s">'
            '<div class="layer-head"><div class="layer-num">%s</div>'
            '<div><h4>%s</h4><div class="sub">%s</div></div>%s</div>%s</div>'
            % (' ready' if now else '', L[idx], num, title, sub,
               '<span class="badge-now">Acum</span>' if now else '', cards))


# ═══ ECRANUL „ORDINE" ════════════════════════════════════════════════════════
WAVES = ('<div class="wave-sel"><div class="wave-tabs">'
         '<button class="wbtn wscratch" title="Notițe"><span class="wname">%s</span><span class="wsub">3</span></button>'
         '<button class="wbtn on"><span class="wname">I</span><span class="wsub">MVP · 6</span></button>'
         '<button class="wbtn"><span class="wname">II</span><span class="wsub">Dashboard &amp; users · 2</span></button>'
         '<button class="wbtn"><span class="wname">III</span><span class="wsub">Polish · 1</span></button>'
         '<button class="wbtn wmanage" aria-label="Gestionează valuri"><span class="wname">%s</span><span class="wsub">valuri</span></button>'
         '</div></div>' % (ic('notepad-text', 18), ic('settings-2', 18)))

ORDINE = WAVES + ''.join([
    layer(0, '1', 'Începe aici', 'Nu depinde de nimic din acest val · 1 tichete',
          tk('TUR-01', 'Email', T['email'], 'Adresă email nouă pentru proiect', done=True), now=True),
    layer(1, '2', 'Layer 2', 'Depinde de layer 1 · 2 tichete',
          tk('TUR-02', 'Supabase / DB', T['db'], 'Cont Supabase (DB + Auth)',
             urgent=True, deps='TUR-01', due=('9 sep', '09:30'), state='active')
          + tk('TUR-03', 'Email', T['email'], 'Cont Mailjet (trimitere email)', deps='TUR-01')),
    layer(2, '3', 'Layer 3', 'Depinde de layer 2 · 2 tichete',
          tk('TUR-04', 'Email', T['email'], 'Webhook Supabase → Mailjet (verificare)',
             deps='TUR-02, TUR-03', due=('8 sep', None), late=True, state='blocked')
          + tk('TUR-05', 'Supabase / DB', T['db'], 'Deploy pe Cloudflare + domeniu', deps='TUR-02', cross=1)),
    layer(3, '4', 'Layer 4', 'Depinde de layer 3 · 1 tichete',
          tk('TUR-06', 'Auth', T['auth'], 'Pagină SignUp / Înregistrare', deps='TUR-04', state='selected')),
])

# ═══ ECRANUL „PROIECTE" ══════════════════════════════════════════════════════
def proj(i, name, desc, pct, accent, tags=()):
    return ('<button class="proj p%d">'
            '<h3>%s</h3><p>%s</p><div class="proj-meta">'
            '<div class="bar"><i style="width:%d%%;background:%s"></i></div>'
            '<span class="pct">%d%%</span></div>%s</button>'
            % (i, name, desc, pct, accent, pct,
               '<div class="proj-tags">%s</div>' % ''.join('<span class="mini">%s</span>' % t for t in tags)
               if tags else ''))


PROIECTE = ('<div class="section-label">Proiecte active <span class="cnt">3</span></div>'
            '<div class="proj-grid">'
            + proj(1, 'Aplicație Turism', 'Expense tracker + bilete + auth pentru călătorii', 22, '#6e7bff',
                   ('TUR', 'val I / III', '9 tichete'))
            + proj(2, 'Horizontal', 'Mementouri, listele inteligente, modul desktop.', 64, '#3ecf8e',
                   ('HZ', 'val IV / V'))
            + proj(3, 'Apologetica', 'Conținut, biblie, taxonomie. Sursa sistemului vizual.', 81, '#ffb454')
            + '</div>')

# ═══ ECRANUL „AZI" ═══════════════════════════════════════════════════════════
def group(n, label, date, rows, gc):
    return ('<div class="list-group" style="--gc: %s"><div class="list-group-head">'
            '<span class="list-group-num">%d</span><span class="list-group-label">%s</span>%s</div>%s</div>'
            % (gc, n, label, '<span class="list-group-date">%s</span>' % date if date else '', rows))


QA = ('<div class="qa"><div class="qa-row">'
      '<span class="qa-plus">%s</span>'
      '<input class="qa-input" placeholder="Ce ai de făcut?" value="Sună la bancă mâine la 10" />'
      '</div><div class="qa-meta">'
      '<span class="chip date"><span class="chip-ico">%s</span>mâine 10:00'
      '<button class="chip-x" aria-label="Respinge data recunoscută">%s</button></span>'
      '<span class="chip bell"><span class="chip-ico">%s</span> memento la oră</span>'
      '<span class="chip">%s zilnic</span>'
      '<label class="qa-proj"><span class="t-dot" style="background:#6e7bff"></span>'
      '<select><option>Aplicație Turism</option></select></label>'
      '<span class="qa-hint"><kbd>↵</kbd> adaugă</span>'
      '</div></div>' % (ic('plus', 16), ic('calendar-check', 13), ic('x', 12),
                        ic('bell', 13), ic('rotate-cw', 12)))

PUSH = ('<div class="push-cta"><span class="push-cta-ico">%s</span>'
        '<div class="push-cta-txt"><strong>Activează mementourile</strong>'
        '<span>Notificările merg doar din aplicația de pe ecranul de start.</span></div>'
        '<button class="push-cta-btn">Activează</button>'
        '<button class="push-cta-x" aria-label="Ascunde">%s</button></div>'
        % (ic('bell', 20), ic('x', 15)))

AZI = (QA + PUSH
       + group(2, 'Restanțe', None,
               trow('8 sep', 'Webhook Supabase → Mailjet', 'TUR', '#6e7bff', late=True, allday=True, bell=True)
               + trow('7 sep', 'Deploy funcția reminder-action', 'HZ', '#3ecf8e', late=True, allday=True),
               'var(--blocked)')
       + group(3, 'Azi', 'miercuri, 9 septembrie',
               trow('09:30', 'Cont Supabase (DB + Auth)', 'TUR', '#6e7bff', urgent=True, bell=True)
               + trow('14:00', 'Split datorii (sora: 40 cor.)', 'TUR', '#6e7bff')
               + trow('—', 'Atașează bilete / chitanțe', 'TUR', '#6e7bff', allday=True),
               'var(--accent)')
       + '<button class="done-toggle">%s Terminate azi (1)</button>' % ic('chevron-right', 15)
       + group(1, 'Mâine', 'joi, 10 septembrie',
               trow('07:00', 'Pagină SignUp / Înregistrare', 'TUR', '#6e7bff', bell=True), 'var(--accent)'))

# ═══ ECRANUL „LISTĂ" — panoul lateral ════════════════════════════════════════
# Singurul ecran al bancului cu două coloane. Se vede doar peste 1200px: sub
# prag `SplitView` nu randează `.split` deloc, iar formularul se întoarce în
# foaia de jos — deci o fereastră îngustă aici nu e o regresie, e comportamentul.
def lrow(tid, title, layer_color, done=False, urgent=False, docked=False, due=None):
    cls = 'list-row' + (' done' if done else '') + (' docked' if docked else '')
    tail = ''
    if urgent:
        tail += '<span class="tk-urgent">%s</span>' % ic('zap', 13)
    if due:
        tail += '<span class="due-chip"><span class="dc-date">%s</span></span>' % due
    return ('<button class="%s" style="--layer-color:%s">'
            '<span class="list-check">%s</span>'
            '<span class="list-id">%s</span>'
            '<span class="list-title">%s</span>'
            '<span class="row-tail">%s</span></button>'
            % (cls, layer_color, ic('circle-check' if done else 'circle', 17), tid, title, tail))


def lgroup(num, label, count, color, rows):
    return ('<div class="list-group" style="--layer-color:%s">'
            '<div class="list-group-head"><span class="list-group-num">%s</span>'
            '<span class="list-group-label">%s</span>'
            '<span class="list-group-count">%s</span></div>%s</div>'
            % (color, num, label, count, rows))


LISTA_STANGA = (
    '<div class="wave-sel">'
    '<div class="wave-tabs"><button class="wave-tab on">I</button>'
    '<button class="wave-tab">II</button><button class="wave-tab">III</button></div>'
    '<div class="wave-actions">'
    '<button class="wave-action-btn">%s</button>'
    '<button class="wave-action-btn active">%s</button>'
    '<button class="wave-action-btn">%s</button></div></div>'
    % (ic('share-2', 14), ic('eye-off', 14), ic('check-check', 14))
    + lgroup(1, 'Începe aici', 2, 'var(--layer-0)',
             lrow('TUR-01', 'Cont Supabase (DB + Auth)', 'var(--layer-0)', urgent=True, docked=True, due='9 sep')
             + lrow('TUR-02', 'Schema tabelelor', 'var(--layer-0)', done=True))
    + lgroup(2, 'Layer 2', 3, 'var(--layer-1)',
             lrow('TUR-04', 'Pagină SignUp / Înregistrare', 'var(--layer-1)')
             + lrow('TUR-05', 'Webhook Supabase → Mailjet', 'var(--layer-1)', due='12 sep')
             + lrow('TUR-06', 'Import bilete din CSV', 'var(--layer-1)'))
    + lgroup(3, 'Layer 3', 1, 'var(--layer-2)',
             lrow('TUR-09', 'Split datorii între participanți', 'var(--layer-2)'))
)

LISTA_PANOU = (
    '<div class="sh-header">'
    '<button class="sh-close">%s</button>'
    '<button class="sh-copy">%s</button>'
    '<button class="sh-delete">%s</button>'
    '<span class="sh-title-wrap"><input class="sh-title-input" type="search" '
    'value="Cont Supabase (DB + Auth)" /></span>'
    '<button class="sh-save dirty">%s</button></div>'
    % (ic('x', 16), ic('copy', 15), ic('trash-2', 14), ic('arrow-up', 16))
    + '<div class="sheet-scroll if-body">'
      '<div class="sh-meta-section"><div class="meta-body"><div class="sh-meta-inline-row">'
      '<div class="meta-col meta-col-theme"><span class="meta-row-label">Temă</span>'
      '<div class="pills-row"><button class="if-meta-pill">Fără</button>'
      '<button class="if-meta-pill active"><span class="if-meta-dot" style="background:#6e7bff"></span>Auth</button>'
      '<button class="if-meta-add">+</button></div></div>'
      '<div class="meta-vsep"></div>'
      '<div class="meta-col meta-col-wave"><span class="meta-row-label">Val</span>'
      '<div class="pills-row"><button class="if-meta-wave active">I</button>'
      '<button class="if-meta-wave">II</button><button class="if-meta-wave">III</button></div></div>'
      '</div></div></div>'
      '<div class="form-cols">'
      '<div class="form-col form-col-desc">'
      '<label class="if-field-label" style="display:block;margin-bottom:8px">Descriere</label>'
      '<textarea class="desc-fixed">Proiect nou pe Supabase: baza de date plus Auth cu magic link. '
      'Fără RLS deocamdată — vine în TUR-04, odată cu pagina de înregistrare.</textarea></div>'
      '<div class="form-col form-col-right">'
      '<div class="deps-zone"><div class="deps-bar">'
      '<button class="dep-tab-btn on">%s Necesită<span class="dep-tab-count">1</span></button>'
      '<button class="dep-tab-btn">%s Permite<span class="dep-tab-count">2</span></button>'
      '<div class="dep-search-wrap-rel"><div class="dep-search-field">'
      '<input class="dep-search-input-sm" placeholder="Caută sau creează tichet…" /></div></div>'
      '</div>'
      '<div class="dep-card"><button class="dep-card-body"><span class="dep-card-id">TUR-02</span>'
      '<span class="dep-card-title">Schema tabelelor</span></button>'
      '<button class="dep-card-x">%s</button></div>'
      '</div></div></div></div>'
      % (ic('arrow-left', 13), ic('arrow-right', 13), ic('x', 12))
)

LISTA = ('<div class="split">'
         '<div class="split-list"><div class="panel">' + LISTA_STANGA + '</div></div>'
         '<aside class="split-pane">' + LISTA_PANOU + '</aside></div>')

LISTA_GOL = ('<div class="split">'
             '<div class="split-list"><div class="panel">' + LISTA_STANGA.replace(' docked', '') + '</div></div>'
             '<aside class="split-pane"><div class="split-empty">' + ic('pencil', 22)
             + '<p>Alege un tichet din listă ca să-l editezi aici.</p></div></aside></div>')

# ═══ ECRANUL „CONTROALE" ═════════════════════════════════════════════════════
# Fiecare clasă care și-a pierdut chenarul, în starea normală și în cea activă.
def g(label, html):
    return '<div class="bench-group"><div class="bench-label">%s</div><div class="bench-row">%s</div></div>' % (label, html)


CONTROALE = ''.join([
    g('Butoane de header',
      '<button class="back" aria-label="Înapoi">%s</button>'
      '<button class="header-sidebar-btn">%s</button>'
      '<button class="header-sidebar-btn" aria-pressed="true">%s</button>'
      '<button class="header-search-btn">%s</button>'
      '<button class="header-settings-btn">%s</button>'
      '<button class="header-info-btn">%s</button>'
      '<button class="header-refresh-btn">%s</button>'
      '<button class="header-new-btn">+ Tichet</button>'
      '<button class="theme-toggle">%s</button>'
      % (ic('arrow-left', 20), ic('panel-left', 15), ic('panel-left', 15), ic('search', 15),
         ic('settings', 15), ic('circle-question-mark', 15), ic('refresh-cw', 15), ic('moon', 16))),

    g('Jetoane și badge-uri',
      '<span class="mini">TUR</span><span class="mini">val I / III</span>'
      '<span class="cnt">3</span>'
      '<span class="hprog"><span class="dot"></span>38%</span>'
      '<span class="tk-children">+2 din alt val</span>'
      '<span class="badge-now">Acum</span>'
      '<span class="due-chip"><span class="dc-date">9 sep</span><span class="dc-time">09:30</span>'
      '<span class="t-bell">' + ic('bell', 12) + '</span></span>'
      '<span class="due-chip late"><span class="dc-date">8 sep</span></span>'
      '<span class="type-badge">task</span><span class="type-badge ext">extern</span>'
      '<span class="acc-count">4</span><span class="users-count">7</span>'
      '<span class="list-group-num">3</span><span class="wave-roman">II</span>'),

    g('Cipuri',
      '<span class="chip">simplu</span><span class="chip on">activ</span>'
      '<span class="chip date"><span class="chip-ico">' + ic('calendar-check', 13) + '</span>mâine 10:00</span>'
      '<span class="chip bell"><span class="chip-ico">' + ic('bell', 13) + '</span> memento</span>'
      '<button class="chip-add">+ temă</button>'
      '<button class="dep-chip"><span class="dep-chip-title">TUR-02</span></button>'
      '<button class="dep-chip on"><span class="dep-chip-title">TUR-04</span></button>'
      '<span class="assignee-chip-inline"><span class="assignee-avatar-sm">IS</span>'
      '<span class="assignee-name-sm">Ionuț (me)</span></span>'),

    g('Pastile de formular',
      '<button class="if-meta-pill">Fără</button>'
      '<button class="if-meta-pill active"><span class="if-meta-dot" style="background:#6e7bff"></span>Auth</button>'
      '<button class="if-meta-pill urgent-pill active">Urgent</button>'
      '<button class="if-meta-wave">I</button><button class="if-meta-wave active">II</button>'
      '<button class="if-meta-add">+</button>'),

    g('Butoane',
      '<button class="btn-primary">Salvează</button>'
      '<button class="btn-ghost">Renunță</button>'
      '<button class="btn-danger">Șterge</button>'
      '<button class="if-btn-primary">Adaugă tichet</button>'
      '<button class="if-btn-ghost">Anulează</button>'
      '<button class="sh-save dirty">Salvează</button>'
      '<button class="sh-save dirty nudge">Nesalvat!</button>'
      '<button class="sh-save" disabled>Salvat</button>'
      '<button class="sh-close">' + ic('x', 16) + '</button>'
      '<button class="sh-copy">' + ic('copy', 15) + '</button>'
      '<button class="sh-delete">' + ic('trash-2', 14) + '</button>'
      '<button class="sh-delete confirming">Sigur?</button>'
      '<button class="wave-action-btn">' + ic('share-2', 14) + '</button>'
      '<button class="wave-action-btn active">' + ic('eye-off', 14) + '</button>'
      '<button class="due-pick">' + ic('calendar-check', 14) + ' Pune o zi</button>'
      '<button class="due-clear">' + ic('x', 13) + '</button>'
      '<button class="att-open">Deschide</button>'
      '<button class="sidebar-new-btn">+ Proiect nou</button>'
      '<button class="qa-add">+ sub-tichet</button>'),

    g('File',
      '<div class="tabs"><button class="tab on">Ordine</button><button class="tab">Listă</button>'
      '<button class="tab">Graf</button><button class="tab">Teme</button></div>'
      '<button class="sh-dep-tab on">Depinde de</button><button class="sh-dep-tab">Blochează</button>'
      '<button class="dep-tab-btn on">Curente</button><button class="dep-tab-btn">Toate</button>'),

    g('Containere',
      '<div class="layer-intro"><b>Layerele</b> se calculează din dependențe. Valul îl alegi tu.</div>'
      '<div class="banner">' + ic('triangle-alert', 15) + ' Valul are 3 tichete. Mută-le pe alt val înainte să-l poți șterge.</div>'
      '<div class="bulk-bar"><span class="bulk-count"><strong>4</strong> selectate</span>'
      '<div class="bulk-actions"><span class="bulk-label">Mută pe</span>'
      '<select class="bulk-wave-select"><option>— val —</option></select>'
      '<div class="bulk-sep"></div>'
      '<button class="bulk-btn danger">' + ic('trash-2', 15) + ' Șterge</button></div></div>'
      '<div class="toast on">Tichet salvat</div>'
      '<div class="dep-card"><button class="dep-card-body"><span class="dep-card-id">TUR-02</span>'
      '<span class="dep-card-title">Cont Supabase (DB + Auth)</span></button>'
      '<button class="dep-card-x">' + ic('x', 12) + '</button></div>'
      '<div class="dep-empty-row">nimic încă</div>'),

    g('Câmpuri',
      '<div class="fld"><textarea rows="2" placeholder="Descrierea tichetului…"></textarea></div>'
      '<input class="dep-search-input" placeholder="Caută un tichet…" />'
      '<div class="due-input"><span class="due-native">9 sep 2026</span></div>'
      '<div class="dep-search-field"><input class="dep-search-input-sm" placeholder="Caută…" /></div>'),

    g('Rânduri de listă',
      lrow('TUR-04', 'Rând normal', 'var(--layer-1)')
      + lrow('TUR-01', 'Deschis în panoul lateral', 'var(--layer-0)', docked=True)
      + lrow('TUR-02', 'Terminat', 'var(--layer-0)', done=True)),

    g('Panoul gol',
      '<div class="split-pane" style="height:180px"><div class="split-empty">' + ic('pencil', 22)
      + '<p>Alege un tichet din listă ca să-l editezi aici.</p></div></div>'),

    g('Indicii de tastatură',
      '<span class="qs-esc-badge">esc</span>'
      '<span class="qa-hint"><kbd>↵</kbd> adaugă</span>'
      '<div class="qs-footer"><kbd>↑↓</kbd> navighează <kbd>↵</kbd> deschide</div>'),
])

SCREENS = {
    'ordine': ('Aplicație Turism', 'Ordine · val I', 'TU', True, True,
               '<div class="tabs"><button class="tab on">Ordine</button><button class="tab">Listă</button>'
               '<button class="tab">Graf</button><button class="tab">Teme</button></div>'
               '<div class="panel">' + ORDINE + '</div>'),
    'proiecte': ('Horizontal', 'Toate proiectele tale', 'H', False, True, PROIECTE),
    'azi': ('Azi', 'miercuri, 9 septembrie', None, False, False, '<div class="panel smart-list">' + AZI + '</div>'),
    'lista': ('Aplicație Turism', 'Listă · val I · panou lateral', 'TU', True, True,
              '<div class="tabs"><button class="tab">Ordine</button><button class="tab on">Listă</button>'
              '<button class="tab">Graf</button><button class="tab">Teme</button></div>' + LISTA),
    'lista-gol': ('Aplicație Turism', 'Listă · niciun tichet ales', 'TU', True, True,
                  '<div class="tabs"><button class="tab">Ordine</button><button class="tab on">Listă</button>'
                  '<button class="tab">Graf</button><button class="tab">Teme</button></div>' + LISTA_GOL),
    'controale': ('Controale', 'fiecare clasă, normal și activ', None, False, False,
                  '<div class="panel bench-gallery">' + CONTROALE + '</div>'),
}


def screen(key):
    title, crumb, logo, back, prog, body = SCREENS[key]
    head = ''
    if back:
        head += '<button class="back" aria-label="Înapoi">%s</button>' % ic('arrow-left', 20)
    head += '<div class="logo">%s</div>' % (logo if logo else ic('calendar-days', 18))
    head += '<div class="htxt"><h1>%s</h1><div class="crumb">%s</div></div>' % (title, crumb)
    if prog:
        head += '<div class="hprog"><span class="dot"></span>38%</div>'
    head += '<button class="header-info-btn" aria-label="Referință">%s</button>' % ic('circle-question-mark', 15)
    return ('<section class="bench-screen" data-screen="%s" hidden><header>%s</header>'
            '<main><div class="view">%s</div></main></section>' % (key, head, body))


TABBAR = ('<nav class="tabbar">'
          '<button class="on"><span class="tb-ico">%s</span>Azi</button>'
          '<button><span class="tb-ico">%s</span>7 zile</button>'
          '<button class="tb-add" aria-label="Sarcină nouă"><span class="tb-ico">%s</span></button>'
          '<button><span class="tb-ico">%s</span>Proiecte</button></nav>'
          % (ic('calendar-days', 21), ic('calendar-range', 21), ic('plus', 25), ic('layout-grid', 21)))

SHELL = """<!doctype html>
<html lang="ro" data-theme="dark">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Horizontal — banc de probă</title>
<!-- CSS-ul REAL al aplicației. Generat de design/build-preview.py; nu edita
     acest fișier de mână, se rescrie. -->
<link rel="stylesheet" href="../src/styles.css" />
<style>
  /* Numai schela bancului. Nimic de aici nu ajunge în aplicație. */
  body { overflow: auto; background: #08080a; }
  [data-theme='light'] body { background: #dfe6ef; }
  .bench-bar {
    position: fixed; top: 0; left: 0; right: 0; z-index: 100;
    display: flex; gap: 6px; align-items: center; justify-content: center;
    padding: 8px; background: rgba(0,0,0,.6); backdrop-filter: blur(8px);
    font-family: var(--mono); font-size: 11px;
  }
  .bench-bar button {
    padding: 5px 11px; border-radius: 6px; background: rgba(255,255,255,.08);
    color: #cfd2dc; font-family: inherit; font-size: inherit; letter-spacing: .06em;
    text-transform: uppercase; border: 0; cursor: pointer;
  }
  .bench-bar button.on { background: var(--accent); color: var(--on-accent); }
  .bench-bar .sep { width: 1px; height: 18px; background: rgba(255,255,255,.15); margin: 0 6px; }
  #app { margin-top: 44px; height: calc(100dvh - 44px); }
  .bench-screen[hidden] { display: none; }
  .bench-screen { display: contents; }
  /* Galeria: etichetă mono peste fiecare grup, controalele înșirate. */
  .bench-group { margin-bottom: 26px; }
  .bench-label {
    font-family: var(--mono); font-size: 9.5px; letter-spacing: .18em;
    text-transform: uppercase; color: var(--txt-faint); margin-bottom: 10px;
  }
  .bench-row { display: flex; flex-wrap: wrap; gap: 9px; align-items: center; }
  .bench-row > .tabs, .bench-row > .bulk-bar, .bench-row > .toast,
  .bench-row > .banner, .bench-row > .layer-intro, .bench-row > .dep-card,
  .bench-row > .fld, .bench-row > .qs-footer { width: 100%; }
  .bench-gallery .toast { position: static; transform: none; opacity: 1; }
  .bench-gallery .bulk-bar { position: static; transform: none; }
</style>
</head>
<body>
<div class="bench-bar">
  <button data-go="ordine">Ordine</button>
  <button data-go="proiecte">Proiecte</button>
  <button data-go="azi">Azi</button>
  <button data-go="lista">Listă</button>
  <button data-go="lista-gol">Listă · gol</button>
  <button data-go="controale">Controale</button>
  <span class="sep"></span>
  <button id="bench-theme">Temă</button>
</div>

<div id="app">
__SCREENS__
__TABBAR__
</div>

<script>
  var root = document.documentElement;
  function show(key) {
    document.querySelectorAll('.bench-screen').forEach(function (s) {
      s.hidden = s.dataset.screen !== key;
    });
    document.querySelectorAll('.bench-bar [data-go]').forEach(function (b) {
      b.classList.toggle('on', b.dataset.go === key);
    });
    location.hash = key;
  }
  document.querySelectorAll('.bench-bar [data-go]').forEach(function (b) {
    b.addEventListener('click', function () { show(b.dataset.go); });
  });
  document.getElementById('bench-theme').addEventListener('click', function () {
    root.setAttribute('data-theme', root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  });
  show(location.hash.slice(1) || 'ordine');
</script>
</body>
</html>
"""

html = (SHELL
        .replace('__SCREENS__', ''.join(screen(k) for k in ('ordine', 'proiecte', 'azi', 'lista', 'lista-gol', 'controale')))
        .replace('__TABBAR__', TABBAR))
out = os.path.join(ROOT, 'design/preview.html')
io.open(out, 'w', encoding='utf-8').write(html)
print('design/preview.html — %d KB' % (len(html.encode()) // 1024))
