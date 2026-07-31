/**
 * The Windows Terminal profile someone would have to add by hand for a distro
 * that has none. Shared so the main process and the renderer offer exactly the
 * same text — WSLPad never writes settings.json itself (goal.md §2.2): the file
 * belongs to Windows Terminal, which rewrites it whenever it saves.
 */
export function terminalProfileSnippet(distro: string): string {
  return JSON.stringify(
    {
      name: distro,
      commandLine: `wsl.exe -d ${distro}`,
      startingDirectory: `//wsl$/${distro}/home`,
      icon: 'ms-appx:///ProfileIcons/{9acb9455-ca41-5af7-950f-6bca1bc9722f}.png'
    },
    null,
    2
  )
}
