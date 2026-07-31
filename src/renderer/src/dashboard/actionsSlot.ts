import { createContext, useContext } from 'react'

/**
 * Where a Card's action controls should render. The Dashboard detail owns the
 * section title row and offers it as a slot, so a section's filters share that
 * row with the export buttons instead of costing a toolbar row of their own.
 * Outside the detail (and in unit tests) the slot is null and a Card renders
 * its actions inline, exactly as it always did.
 */
export const CardActionsSlot = createContext<HTMLElement | null>(null)

export function useCardActionsSlot(): HTMLElement | null {
  return useContext(CardActionsSlot)
}
