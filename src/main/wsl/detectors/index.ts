import type { ToolInfo } from '@shared/types'
import type { DistroRunner } from '../contracts'
import { TOOL_SCRIPT_SPECS, runToolDetection } from './tools'

/**
 * Extensible tool-detector surface (goal.md §6.5). Detection always runs
 * through the Hidden Runner — nothing here ever touches the user Console.
 */

export interface DistroContext {
  runner: DistroRunner
  distro: string
}

export interface ToolDetectionResult {
  info: ToolInfo
}

export interface ToolDetector {
  id: string
  displayName: string
  detect(ctx: DistroContext): Promise<ToolDetectionResult>
}

/** Detect the whole catalog with one batched script plus one services call. */
export function detectTools(runner: DistroRunner, distro: string): Promise<ToolInfo[]> {
  return runToolDetection(runner, distro, TOOL_SCRIPT_SPECS)
}

/** One detector per tool for callers that need individual re-detection. */
export const toolDetectors: ToolDetector[] = TOOL_SCRIPT_SPECS.map((spec) => ({
  id: spec.id,
  displayName: spec.displayName,
  async detect(ctx: DistroContext): Promise<ToolDetectionResult> {
    const infos = await runToolDetection(ctx.runner, ctx.distro, [spec])
    return { info: infos[0] }
  }
}))

export { detectHermes } from './hermes'
export { inferInstallMethod, parseVersionLine } from './tools'
