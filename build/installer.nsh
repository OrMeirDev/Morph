; Included by electron-builder's NSIS script (package.json build.nsis.include).
; On uninstall, remove the AppContainer profile the conversion engines ran in (D2). An update runs
; the old uninstaller too; the profile is recreated with the same identity on the next conversion.
!macro customUnInstall
  IfFileExists "$INSTDIR\resources\native\morph-confine.exe" 0 +2
    ExecWait '"$INSTDIR\resources\native\morph-confine.exe" --delete-profile Morph.Engines'
!macroend
