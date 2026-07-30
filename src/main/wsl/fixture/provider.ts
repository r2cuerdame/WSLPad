/**
 * Deterministic WslProvider for fixture mode (goal.md §18.4).
 * All answers come from data.ts synchronously; secrets are masked with the
 * shared masking rules and only revealEnv returns raw values (GUI-only path).
 * Methods are async so validation failures surface as rejections, matching
 * the real provider.
 */
import type {
  ConfigurationFileInfo,
  DistroDetails,
  DistroSummary,
  EnvironmentVariableInfo,
  HermesInfo,
  ImportantPathInfo,
  PortInfo,
  ProcessInfo,
  ResourceInfo,
  ServiceInfo,
  SystemInfo,
  ToolInfo
} from '@shared/types'
import { isPathLikeName, isSecretName, looksWindowsOriginated, maskEnvValue } from '@shared/masking'
import type { WslProvider } from '../contracts'
import { assertValidDistroName } from '../escape'
import {
  assertFixtureDistro,
  fixtureConfigFiles,
  fixtureDistroDetails,
  fixtureDistros,
  fixtureEnvRaw,
  fixtureHermes,
  fixtureImportantPaths,
  fixturePorts,
  fixtureProcesses,
  fixtureResources,
  fixtureServices,
  fixtureSystemInfo,
  fixtureTools,
  type FixtureDistroName
} from './data'

export class FixtureWslProvider implements WslProvider {
  private known(distro: string): FixtureDistroName {
    assertValidDistroName(distro)
    assertFixtureDistro(distro)
    return distro
  }

  async isAvailable(): Promise<boolean> {
    return true
  }

  async listDistros(): Promise<DistroSummary[]> {
    return fixtureDistros()
  }

  async getDistroDetails(distro: string): Promise<DistroDetails> {
    return fixtureDistroDetails(this.known(distro))
  }

  async getSystemInfo(distro: string): Promise<SystemInfo> {
    return fixtureSystemInfo(this.known(distro))
  }

  async getResources(distro: string): Promise<ResourceInfo> {
    return fixtureResources(this.known(distro))
  }

  async getProcesses(distro: string): Promise<ProcessInfo[]> {
    return fixtureProcesses(this.known(distro))
  }

  async getServices(distro: string, systemdEnabled: boolean | null): Promise<ServiceInfo[]> {
    const name = this.known(distro)
    if (systemdEnabled === false) return []
    return fixtureServices(name)
  }

  async getPorts(distro: string): Promise<PortInfo[]> {
    return fixturePorts(this.known(distro))
  }

  async getEnvironment(distro: string): Promise<EnvironmentVariableInfo[]> {
    const raw = fixtureEnvRaw(this.known(distro))
    return Object.entries(raw).map(([name, value]) => ({
      name,
      maskedValue: maskEnvValue(name, value),
      valueLength: value.length,
      isSecret: isSecretName(name),
      isPathLike: isPathLikeName(name),
      fromWindows: looksWindowsOriginated(name, value)
    }))
  }

  async revealEnv(distro: string, name: string): Promise<string | null> {
    const raw = fixtureEnvRaw(this.known(distro))
    return raw[name] ?? null
  }

  async getImportantPaths(distro: string): Promise<ImportantPathInfo[]> {
    return fixtureImportantPaths(this.known(distro))
  }

  async getConfigFiles(distro: string): Promise<ConfigurationFileInfo[]> {
    return fixtureConfigFiles(this.known(distro))
  }

  async getTools(distro: string): Promise<ToolInfo[]> {
    return fixtureTools(this.known(distro))
  }

  async getHermes(distro: string): Promise<HermesInfo | null> {
    return fixtureHermes(this.known(distro))
  }
}
