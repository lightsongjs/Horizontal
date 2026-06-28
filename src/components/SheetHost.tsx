import { useEffect } from 'react'
import { useUI } from '../ui'
import { IssueSheet } from './IssueSheet'
import { IssueForm } from './IssueForm'
import { ProjectForm } from './ProjectForm'
import { WaveManager } from './WaveManager'
import { ThemeManager } from './ThemeManager'

export function SheetHost() {
  const { sheet, closeSheet } = useUI()
  const open = sheet.kind !== 'none'
  const tall =
    sheet.kind === 'issue-form' ||
    sheet.kind === 'project-form' ||
    sheet.kind === 'wave-manage' ||
    sheet.kind === 'theme-manage'

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeSheet()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, closeSheet])

  return (
    <>
      <div className={`sheet-bg ${open ? 'on' : ''}`} onClick={closeSheet} />
      <div className={`sheet ${open ? 'on' : ''} ${tall ? 'tall' : ''}`} role="dialog" aria-modal="true">
        <div className="grip" />
        {sheet.kind === 'issue' && <IssueSheet issueId={sheet.issueId} />}
        {sheet.kind === 'issue-form' && <IssueForm issueId={sheet.issueId} />}
        {sheet.kind === 'project-form' && <ProjectForm />}
        {sheet.kind === 'wave-manage' && <WaveManager />}
        {sheet.kind === 'theme-manage' && <ThemeManager />}
      </div>
    </>
  )
}
