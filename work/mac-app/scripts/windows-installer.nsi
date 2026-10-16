Unicode True
RequestExecutionLevel user
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"
Name "问间 ${APP_VERSION}（${APP_BUILD}）"
OutFile "${OUT_FILE}"
InstallDir "$LOCALAPPDATA\Programs\Wenjian"
Icon "..\AppIcon-win.ico"
SetCompressor /SOLID lzma
SetCompressorDictSize 32
VIProductVersion "3.14.${APP_BUILD}.0"
VIAddVersionKey "ProductName" "问间"
VIAddVersionKey "FileDescription" "问间离线安装程序"
VIAddVersionKey "FileVersion" "${APP_VERSION}.${APP_BUILD}"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\Wenjian.exe"
!define MUI_FINISHPAGE_RUN_TEXT "打开问间"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"
Var Stage
Var Previous
Function .onInit
 ${IfNot} ${RunningX64}
  MessageBox MB_ICONSTOP "需要 64 位 Windows。" /SD IDOK
  Abort
 ${EndIf}
 SetRegView 64
 ReadRegDWORD $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Wenjian" "Build"
 ${If} $0 > ${APP_BUILD}
  MessageBox MB_ICONSTOP "已安装更新的构建，请使用最新安装包。" /SD IDOK
  Abort
 ${EndIf}
 SetShellVarContext current
FunctionEnd
Function CheckClosed
 retry:
 IfFileExists "$INSTDIR\Wenjian.exe" 0 done
 System::Call 'kernel32::CreateFileW(w "$INSTDIR\Wenjian.exe", i 0x80000000, i 0, p 0, i 3, i 0, p 0) p.r0'
 ${If} $0 == -1
  MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "请先在问间中保存内容并退出，再点击重试。" /SD IDCANCEL IDRETRY retry
  Abort
 ${EndIf}
 System::Call 'kernel32::CloseHandle(p r0)'
 done:
FunctionEnd
Section "问间" SEC_MAIN
 Call CheckClosed
 System::Call 'kernel32::GetCurrentProcessId() i.r1'
 StrCpy $Stage "$INSTDIR.install-${APP_BUILD}-$1"
 StrCpy $Previous "$INSTDIR.previous-${APP_BUILD}-$1"
 IfFileExists "$Previous\*" 0 +3
  MessageBox MB_ICONSTOP "发现此前安装的恢复目录，请先保留该目录并联系维护者。" /SD IDOK
  Abort
 ClearErrors
 SetOutPath "$Stage"
 File /r "${APP_DIR}\*.*"
 WriteUninstaller "$Stage\Uninstall.exe"
 IfErrors install_failed
 ; Windows locks the current working directory; release it before renaming stage.
 SetOutPath "$TEMP"
 ClearErrors
 IfFileExists "$INSTDIR\*" 0 new_install
 Rename "$INSTDIR" "$Previous"
 IfErrors install_failed
 new_install:
 Rename "$Stage" "$INSTDIR"
 IfErrors restore_previous
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Wenjian" "DisplayName" "问间"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Wenjian" "DisplayVersion" "${APP_VERSION}（${APP_BUILD}）"
 WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Wenjian" "Build" ${APP_BUILD}
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Wenjian" "InstallLocation" "$INSTDIR"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Wenjian" "UninstallString" '$\"$INSTDIR\Uninstall.exe$\"'
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Wenjian" "DisplayIcon" "$INSTDIR\Wenjian.exe"
 WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Wenjian" "NoModify" 1
 WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Wenjian" "NoRepair" 1
 CreateDirectory "$SMPROGRAMS\问间"
 CreateShortcut "$SMPROGRAMS\问间\问间.lnk" "$INSTDIR\Wenjian.exe"
 CreateShortcut "$DESKTOP\问间.lnk" "$INSTDIR\Wenjian.exe"
 RMDir /r "$Previous"
 Goto finished
 restore_previous:
 Rename "$Previous" "$INSTDIR"
 install_failed:
 SetErrorLevel 1
 MessageBox MB_ICONSTOP "安装未完成，原程序和资料已保留。请关闭问间后重试。" /SD IDOK
 Abort
 finished:
SectionEnd
Function un.onInit
 SetShellVarContext current
 retry:
 IfFileExists "$INSTDIR\Wenjian.exe" 0 done
 System::Call 'kernel32::CreateFileW(w "$INSTDIR\Wenjian.exe", i 0x80000000, i 0, p 0, i 3, i 0, p 0) p.r0'
 ${If} $0 == -1
  MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "请先保存并退出问间，再卸载。资料将保留在本机。" /SD IDCANCEL IDRETRY retry
  Abort
 ${EndIf}
 System::Call 'kernel32::CloseHandle(p r0)'
 done:
FunctionEnd
Section "Uninstall"
 SetOutPath "$TEMP"
 SetRegView 64
 SetShellVarContext current
 ; Only remove installed program files. Never remove AppData, cloud or external books.
 Delete "$SMPROGRAMS\问间\问间.lnk"
 RMDir "$SMPROGRAMS\问间"
 Delete "$DESKTOP\问间.lnk"
 DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Wenjian"
 RMDir /r "$INSTDIR"
SectionEnd
