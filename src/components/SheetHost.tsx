import { useEffect } from 'react'
import { compactIssueIdFrom, sheetKey, useUI } from '../ui'
import { useMediaQuery } from '../hooks'
import { EditSheet } from './EditSheet'
import { IssueSheet } from './IssueSheet'
import { IssueForm } from './IssueForm'
import { ProjectForm } from './ProjectForm'
import { ProjectSettings } from './ProjectSettings'
import { WaveManager } from './WaveManager'
import { ThemeManager } from './ThemeManager'
import { AppSettings } from './AppSettings'
import { ObstacleForm } from './ObstacleForm'
import { UserForm } from './UserForm'
import { Icon } from './Icon'
import { QuickSheet } from './QuickSheet'
import { FilterForm } from './FilterForm'

export function SheetHost() {
  const { sheet, canGoBack, closeSheet, goBack, dockedIssueId } = useUI()
  // Când formularul stă în panoul lateral, stiva e exact el — deci aici nu mai
  // rămâne nimic de arătat, nici modal, nici fundal. Un card de dependență
  // împins deasupra lui iese din condiția de docare și modalul revine.
  // Foaia rapidă are altă cochilie (`KeyboardSheet`), deci nu deschide `.sheet`
  // — doar Escape-ul de mai jos îi e comun.
  const quick = sheet.kind === 'quick-add'
  // Pe telefon, un tichet existent se deschide în foaia scurtă, nu în
  // formular — vezi `compactIssueIdFrom`. Același prag ca FAB-ul.
  const narrow = useMediaQuery('(max-width: 899px)')
  const compactId = dockedIssueId ? null : compactIssueIdFrom(sheet, canGoBack ? 2 : 1, narrow)
  const open = sheet.kind !== 'none' && !dockedIssueId && !quick && !compactId
  const tall =
    sheet.kind === 'issue-form' ||
    sheet.kind === 'project-form' ||
    sheet.kind === 'project-settings' ||
    sheet.kind === 'wave-manage' ||
    sheet.kind === 'theme-manage' ||
    sheet.kind === 'obstacle-form' ||
    sheet.kind === 'user-form' ||
    sheet.kind === 'filter-form'

  useEffect(() => {
    if (!open && !quick && !compactId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (canGoBack) goBack()
        else closeSheet()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, quick, compactId, canGoBack, closeSheet, goBack])

  // Vizualizarea unui tichet primește o clasă proprie ca să poată fi mai lată
  // și mai înaltă pe desktop decât un sheet obișnuit: conținutul ei e text de
  // citit (descrierea), nu un formular cu câmpuri de lățime fixă.
  const view = sheet.kind === 'issue'

  return (
    <>
      <div className={`sheet-bg ${open ? 'on' : ''}`} onClick={closeSheet} />
      <div className={`sheet ${open ? 'on' : ''} ${tall ? 'tall' : ''} ${view ? 'sheet-view' : ''}`} role="dialog" aria-modal="true">
        <div className="grip" />
        {canGoBack && (
          <button className="sheet-back" onClick={goBack}>
            <Icon name="back" size={15} /> Înapoi
          </button>
        )}
        {sheet.kind === 'issue' && <IssueSheet key={sheetKey(sheet)} issueId={sheet.issueId} />}
        {sheet.kind === 'issue-form' && !dockedIssueId && !compactId && <IssueForm key={sheetKey(sheet) ?? '__new__'} issueId={sheet.issueId} draft={sheet.draft} />}
        {sheet.kind === 'project-form' && <ProjectForm />}
        {sheet.kind === 'project-settings' && <ProjectSettings />}
        {sheet.kind === 'wave-manage' && <WaveManager />}
        {sheet.kind === 'theme-manage' && <ThemeManager />}
        {sheet.kind === 'app-settings' && <AppSettings />}
        {sheet.kind === 'obstacle-form' && (
          <ObstacleForm key={sheet.obstacleId ?? '__new__'} obstacleId={sheet.obstacleId} />
        )}
        {sheet.kind === 'user-form' && <UserForm key={sheet.userId ?? '__new__'} userId={sheet.userId} />}
        {sheet.kind === 'filter-form' && <FilterForm key={sheet.filterId ?? '__new__'} filterId={sheet.filterId} />}
      </div>
      {sheet.kind === 'quick-add' && <QuickSheet ctx={sheet.ctx} />}
      {compactId && sheet.kind === 'issue-form' && <EditSheet key={sheetKey(sheet)} issueId={compactId} />}
    </>
  )
}
