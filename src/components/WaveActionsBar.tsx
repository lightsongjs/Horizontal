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
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/>
          <line x1="12" y1="7" x2="12" y2="13"/><line x1="12" y1="13" x2="5" y2="17"/><line x1="12" y1="13" x2="19" y2="17"/>
        </svg>
        <span>Tree</span>
      </button>
      <button
        className={`wave-action-btn ${hideDone ? 'active' : ''}`}
        onClick={onToggleHideDone}
        title={hideDone ? 'Arată tichetele completate' : 'Ascunde tichetele completate'}
      >
        {hideDone ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
          </svg>
        )}
        <span>{hideDone ? 'Arată' : 'Ascunde'}</span>
      </button>
      {canWrite && (
        <button
          className={`wave-action-btn ${selectMode ? 'active' : ''}`}
          onClick={selectMode ? onExitSelect : onEnterSelect}
          title={selectMode ? 'Ieși din Select Mode' : 'Select Mode'}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="3"/>
            {selectMode && <polyline points="9 12 11 14 15 10"/>}
          </svg>
          <span>Select</span>
        </button>
      )}
    </div>
  )
}
