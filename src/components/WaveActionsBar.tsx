import { Icon } from './Icon'
interface Props {
  treeViewActive: boolean
  onToggleTree: () => void
  hideDone: boolean
  onToggleHideDone: () => void
  selectMode: boolean
  onEnterSelect: () => void
  onExitSelect: () => void
  /** Read-only members can't bulk-move/delete, so the Select control is hidden. */
  canWrite?: boolean
}

export function WaveActionsBar({
  treeViewActive, onToggleTree,
  hideDone, onToggleHideDone,
  selectMode, onEnterSelect, onExitSelect,
  canWrite = true,
}: Props) {
  return (
    <div className="wave-actions">
      <button
        className={`wave-action-btn ${treeViewActive ? 'active' : ''}`}
        onClick={onToggleTree}
        title={treeViewActive ? 'Ieși din Tree View' : 'Tree View — explorează dependențe'}
      >
        <Icon name="graph" size={14} />
        <span>Tree</span>
      </button>
      <button
        className={`wave-action-btn ${hideDone ? 'active' : ''}`}
        onClick={onToggleHideDone}
        title={hideDone ? 'Arată tichetele completate' : 'Ascunde tichetele completate'}
      >
        {hideDone ? (
          <Icon name="hide" size={14} />
        ) : (
          <Icon name="show" size={14} />
        )}
        <span>{hideDone ? 'Arată' : 'Ascunde'}</span>
      </button>
      {canWrite && (
        <button
          className={`wave-action-btn ${selectMode ? 'active' : ''}`}
          onClick={selectMode ? onExitSelect : onEnterSelect}
          title={selectMode ? 'Ieși din Select Mode' : 'Select Mode'}
        >
          <Icon name={selectMode ? 'selectAll' : 'selectNone'} size={14} />
          <span>Select</span>
        </button>
      )}
    </div>
  )
}
