; WSLPad NSIS customization (auto-included by electron-builder).
; The app registers itself under HKCU Run for start-with-Windows; make sure
; uninstall removes that login item so no dangling entry survives.
!macro customUnInstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "electron.app.WSLPad"
!macroend
