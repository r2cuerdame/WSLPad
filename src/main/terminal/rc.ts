/**
 * Shell rc files injected into the interactive Console session (goal.md §8.4).
 *
 * Both rc files source the user's own rc first, then install __wslpad_sync as
 * a prompt hook. The hook consumes $WSLPAD_SYNC_FILE (written by the hidden
 * runner) and cd's silently *inside* the prompt hook — the cd never enters
 * shell history and never echoes into the transcript. It then emits OSC 7
 * (current cwd) and OSC 133;A (prompt marker) so the main process can track
 * cwd and ready state. xterm.js ignores both sequences.
 */

/** Deterministic sync-file path for a session/distro id (one console per distro). */
export function syncFilePath(sessionId: string): string {
  return '/tmp/.wslpad-cwd-' + sessionId
}

export const BASH_RC = `# WSLPad console rc (generated - do not edit). Loaded via bash --rcfile.
[ -f "$HOME/.bashrc" ] && . "$HOME/.bashrc"

__wslpad_sync() {
  if [ -n "$WSLPAD_SYNC_FILE" ] && [ -f "$WSLPAD_SYNC_FILE" ]; then
    local __wslpad_target
    __wslpad_target=$(cat "$WSLPAD_SYNC_FILE" 2>/dev/null)
    rm -f -- "$WSLPAD_SYNC_FILE"
    if [ -n "$__wslpad_target" ] && [ -d "$__wslpad_target" ]; then
      cd -- "$__wslpad_target" 2>/dev/null
    fi
  fi
  printf '\\033]7;file://%s%s\\033\\\\' "\${HOSTNAME:-$(hostname)}" "$PWD"
  printf '\\033]133;A\\033\\\\'
}
PROMPT_COMMAND="__wslpad_sync\${PROMPT_COMMAND:+;$PROMPT_COMMAND}"
`

export const ZSH_RC = `# WSLPad console rc (generated - do not edit). Loaded as $ZDOTDIR/.zshrc.
[ -f "$HOME/.zshrc" ] && . "$HOME/.zshrc"

__wslpad_sync() {
  if [ -n "$WSLPAD_SYNC_FILE" ] && [ -f "$WSLPAD_SYNC_FILE" ]; then
    local __wslpad_target
    __wslpad_target=$(cat "$WSLPAD_SYNC_FILE" 2>/dev/null)
    rm -f -- "$WSLPAD_SYNC_FILE"
    if [ -n "$__wslpad_target" ] && [ -d "$__wslpad_target" ]; then
      cd -- "$__wslpad_target" 2>/dev/null
    fi
  fi
  printf '\\033]7;file://%s%s\\033\\\\' "\${HOST:-$HOSTNAME}" "$PWD"
  printf '\\033]133;A\\033\\\\'
}
typeset -ga precmd_functions
precmd_functions+=(__wslpad_sync)
`
