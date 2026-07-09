import { useCallback, useEffect, useMemo, useState } from 'react'
import { useHorizontal } from './store'
import { buildOrderedLayers, type OrderedLayer } from './lib/ordering'

const HIDE_DONE_KEY = 'horizontal:hide-done'

/** localStorage-backed "hide completed" toggle, shared across views. */
export function useHideDone(): [boolean, () => void] {
  const [hideDone, setHideDone] = useState(
    () => localStorage.getItem(HIDE_DONE_KEY) === '1',
  )
  useEffect(() => {
    localStorage.setItem(HIDE_DONE_KEY, hideDone ? '1' : '0')
  }, [hideDone])
  const toggle = useCallback(() => setHideDone((h) => !h), [])
  return [hideDone, toggle]
}

/** Layer groups for the active wave, urgent-first, optionally hiding done. */
export function useOrderedLayers(hideDone: boolean): OrderedLayer[] {
  const { layers, byId } = useHorizontal()
  return useMemo(() => buildOrderedLayers(layers, byId, hideDone), [layers, byId, hideDone])
}
