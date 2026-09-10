import { useHorizontal } from '../store'
import { Icon } from './Icon'

/**
 * „Blocat de". Exportat o dată și folosit de card ȘI de rând, ca la clopoțelul
 * din DueChip: aceeași informație trebuie să arate identic în cele două moduri.
 *
 * Un obstacol → id-ul lui, care e acționabil. Mai multe → numărul, fiindcă
 * patru id-uri pe un card de telefon nu se citesc, iar oricum deschizi foaia.
 */
export function ObstacleChip({ issueId }: { issueId: string }) {
  const { blockedByObstacle, obstacles } = useHorizontal()
  const ids = blockedByObstacle[issueId]
  if (!ids?.length) return null

  const first = obstacles.find((o) => o.id === ids[0])
  const label =
    ids.length === 1
      ? `${ids[0]}${first?.owner ? ` · ${first.owner}` : ''}`
      : `${ids.length} obstacole`

  return (
    <span className="obst-chip blk" title={ids.join(', ')}>
      <Icon name="obstacle" size={10} />
      {label}
    </span>
  )
}
