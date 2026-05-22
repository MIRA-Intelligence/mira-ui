!macro customInstall
  DetailPrint "Installing MIRA local engine service..."
  nsExec::ExecToLog '"$INSTDIR\resources\bundled-engine\win32\mira-engine.exe" install-service --host 127.0.0.1 --port 18790 --home "$PROFILE" --config "$PROFILE\.mira\config.json"'
  nsExec::ExecToLog '"$INSTDIR\resources\bundled-engine\win32\mira-engine.exe" start --home "$PROFILE"'
!macroend

!macro customUnInstall
  DetailPrint "Stopping MIRA local engine service..."
  nsExec::ExecToLog '"$INSTDIR\resources\bundled-engine\win32\mira-engine.exe" stop --home "$PROFILE"'
  DetailPrint "Uninstalling MIRA local engine service..."
  nsExec::ExecToLog '"$INSTDIR\resources\bundled-engine\win32\mira-engine.exe" uninstall-service --home "$PROFILE"'
!macroend
