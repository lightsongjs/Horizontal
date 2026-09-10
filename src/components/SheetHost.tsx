import { useEffect } from 'react'
import { useUI } from '../ui'
import { IssueSheet } from './IssueSheet'
import { IssueForm } from './IssueForm'
import { ProjectForm } from './ProjectForm'
import { ProjectSettings } from './ProjectSettings'
import { WaveManager } from './WaveManager'
import { ThemeManager } from './ThemeManager'
import { Icon } from './Icon'

export function SheetHost() {
  const { sheet, canGoBack, closeSheet, goBack, dockedIssueId } = useUI()
  // Când formularul stă în panoul lateral, stiva e exact el — deci aici nu mai
  // rămâne nimic de arătat, nici modal, nici fundal. Un card de dependență
  // împins deasupra lui iese din condiția de docare și modalul revine.
  const open = sheet.kind !== 'none' && !dockedIssueId
  const tall =
    sheet.kind === 'issue-form' ||
    sheet.kind === 'project-form' ||
    sheet.kind === 'project-settings' ||
    sheet.kind === 'wave-manage' ||
    sheet.kind === 'theme-manage'

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (canGoBack) goBack()
        else closeSheet()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, canGoBack, closeSheet, goBack])

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
        {sheet.kind === 'issue' && <IssueSheet key={sheet.issueId} issueId={sheet.issueId} />}
        {sheet.kind === 'issue-form' && !dockedIssueId && <IssueForm key={sheet.issueId ?? '__new__'} issueId={sheet.issueId} />}
        {sheet.kind === 'project-form' && <ProjectForm />}
        {sheet.kind === 'project-settings' && <ProjectSettings />}
        {sheet.kind === 'wave-manage' && <WaveManager />}
        {sheet.kind === 'theme-manage' && <ThemeManager />}
      </div>
    </>
  )
}
