import { useEffect } from 'react'
import { useUI } from '../ui'
import { IssueSheet } from './IssueSheet'
import { IssueForm } from './IssueForm'
import { ProjectForm } from './ProjectForm'
import { ProjectSettings } from './ProjectSettings'
import { WaveManager } from './WaveManager'
import { ThemeManager } from './ThemeManager'

export function SheetHost() {
  const { sheet, canGoBack, closeSheet, goBack } = useUI()
  const open = sheet.kind !== 'none'
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

  return (
    <>
      <div className={`sheet-bg ${open ? 'on' : ''}`} onClick={closeSheet} />
      <div className={`sheet ${open ? 'on' : ''} ${tall ? 'tall' : ''}`} role="dialog" aria-modal="true">
        <div className="grip" />
        {canGoBack && (
          <button className="sheet-back" onClick={goBack}>
            ← Înapoi
          </button>
        )}
        {sheet.kind === 'issue' && <IssueSheet key={sheet.issueId} issueId={sheet.issueId} />}
        {sheet.kind === 'issue-form' && <IssueForm key={sheet.issueId ?? '__new__'} issueId={sheet.issueId} />}
        {sheet.kind === 'project-form' && <ProjectForm />}
        {sheet.kind === 'project-settings' && <ProjectSettings />}
        {sheet.kind === 'wave-manage' && <WaveManager />}
        {sheet.kind === 'theme-manage' && <ThemeManager />}
      </div>
    </>
  )
}
