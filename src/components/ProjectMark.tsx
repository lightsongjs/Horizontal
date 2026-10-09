import { isInboxProject } from '../lib/captureTokens'
import type { Project } from '../lib/types'
import { Icon } from './Icon'

interface Props {
  project: Pick<Project, 'id' | 'name' | 'accent'>
  /** Clasa bulinei de culoare (`t-dot`, `sidebar-proj-dot`…); fără ea, un proiect obișnuit nu arată nimic. */
  dot?: string
  size?: number
}

/**
 * Semnul din stânga numelui de proiect: bulina de culoare, iar la Inbox
 * iconița lui, în aceeași culoare. Un singur loc decide cine e Inbox
 * (`isInboxProject`), ca numele lui să poată fi orice — inclusiv fără emoji.
 */
export function ProjectMark({ project, dot, size = 12 }: Props) {
  if (isInboxProject(project)) {
    return (
      <span className="proj-inbox" style={{ color: project.accent || undefined }}>
        <Icon name="inbox" size={size} />
      </span>
    )
  }
  return dot ? <span className={dot} style={{ background: project.accent || 'var(--txt-faint)' }} /> : null
}
