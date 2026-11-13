import { MASKED_VALUE } from '@shared/constants'
import { isSecretName, isSensitivePath, looksLikePrivateKey } from '@shared/masking'

export * from '@shared/masking'

const ENV_ASSIGNMENT_RE =
  /^([ \t]*(?:export[ \t]+)?)([A-Za-z_][A-Za-z0-9_.-]*)([ \t]*=[ \t]*)([^\r\n]*)(\r?)$/gm

/**
 * MCP-side text masking (goal.md §11.4): private key files are withheld
 * entirely, well-known credential paths carry a warning while remaining
 * readable, and env/ini-style `KEY=value` lines with secret-like names are
 * masked line by line.
 */
export function maskTextFileContent(
  path: string,
  content: string
): { content: string; warning: string | null } {
  if (looksLikePrivateKey(content)) {
    return { content: '[private key content withheld]', warning: 'private key content withheld' }
  }
  const masked = content.replace(
    ENV_ASSIGNMENT_RE,
    (line, prefix: string, name: string, eq: string, _value: string, cr: string) =>
      isSecretName(name) ? `${prefix}${name}${eq}${MASKED_VALUE}${cr}` : line
  )
  return { content: masked, warning: isSensitivePath(path) ? 'sensitive file' : null }
}
