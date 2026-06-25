!macro _miraStopEngineService ENGINE_EXE LABEL
  IfFileExists "${ENGINE_EXE}" 0 done_${LABEL}
    DetailPrint "Stopping existing MIRA local engine service..."
    nsExec::ExecToLog '"${ENGINE_EXE}" stop --home "$PROFILE"'
    Pop $0
    DetailPrint "Uninstalling existing MIRA local engine service..."
    nsExec::ExecToLog '"${ENGINE_EXE}" uninstall-service --home "$PROFILE"'
    Pop $0
  done_${LABEL}:
!macroend

!macro customInit
  !insertmacro _miraStopEngineService "$INSTDIR\resources\bundled-engine\win32\mira-engine.exe" legacy_flat
  !insertmacro _miraStopEngineService "$INSTDIR\resources\bundled-engine\win32\mira-engine\mira-engine.exe" onedir
!macroend

!macro customInstall
  DetailPrint "Installing MIRA local engine service..."
  nsExec::ExecToLog '"$INSTDIR\resources\bundled-engine\win32\mira-engine\mira-engine.exe" install-service --host 127.0.0.1 --port 18790 --home "$PROFILE" --config "$PROFILE\.mira\config.json"'
  Pop $0
  StrCmp $0 0 install_done
    DetailPrint "MIRA local engine service install failed with exit code $0."
    IfSilent install_done
    MessageBox MB_OK|MB_ICONEXCLAMATION "MIRA was installed, but the local engine service could not be updated. Open MIRA Settings and choose Repair service. If it still fails, restart Windows and run the installer again."
  install_done:
!macroend

!macro customUnInstall
  DetailPrint "Stopping MIRA local engine service..."
  nsExec::ExecToLog '"$INSTDIR\resources\bundled-engine\win32\mira-engine\mira-engine.exe" stop --home "$PROFILE"'
  Pop $0
  DetailPrint "Uninstalling MIRA local engine service..."
  nsExec::ExecToLog '"$INSTDIR\resources\bundled-engine\win32\mira-engine\mira-engine.exe" uninstall-service --home "$PROFILE"'
  Pop $0
!macroend
