# Runs before the installer touches $INSTDIR. The stock electron-builder script
# asks first ("... is running. Click OK to close it.") and only kills the app
# after the user confirms; a fork that ships several times a day should not make
# people click through that every time, so close the app up front and keep a
# prompt only for the case where the kill does not work.
#
# A graceful kill (taskkill without /F) sends WM_CLOSE, so the app still gets to
# flush its config on the way out.

# `allowOnlyOneInstallerInstance.nsh` declares this itself, but it only does so
# when `customCheckAppRunning` is not defined, and `KILL_PROCESS` below reads it
# to keep the installer from matching itself. Declare it here so both branches
# of `KILL_PROCESS` compile.
Var pid

!macro customCheckAppRunning
  # KILL_PROCESS uses `/FI "PID ne $pid"`; without this the filter is `PID ne`
  # and taskkill bails out with an invalid-argument error.
  System::Call 'kernel32::GetCurrentProcessId() i .r0'
  StrCpy $pid $R0

  # FIND_PROCESS/KILL_PROCESS pick between PowerShell and tasklist/taskkill based
  # on this flag. `CHECK_APP_RUNNING` only sets it on its own path, which is
  # skipped when this macro is defined.
  !insertmacro IS_POWERSHELL_AVAILABLE

  !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
  ${if} $R0 == 0
    DetailPrint "Closing ${PRODUCT_NAME} ..."
    !insertmacro KILL_PROCESS "${APP_EXECUTABLE_FILENAME}" 0
    Sleep 800

    !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
    ${if} $R0 == 0
      !insertmacro KILL_PROCESS "${APP_EXECUTABLE_FILENAME}" 1
      # let Windows release the file handles before the files are replaced
      Sleep 600
    ${endIf}

    # Still there, which in practice means the app runs elevated: a per-user
    # installer cannot stop it, so hand the decision back to the user instead of
    # installing over a locked directory.
    checkAppRunningAgain:
      !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
      ${if} $R0 == 0
        MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY checkAppRunningAgain
        SetErrorLevel 2
        Quit
      ${endIf}
  ${endIf}
!macroend
