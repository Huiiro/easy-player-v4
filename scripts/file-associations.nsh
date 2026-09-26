; Register candidates without changing the user's default application.
; SHELL_CONTEXT follows the installer's per-user or per-machine selection.
!macro RegisterAudioExtension EXT FORMAT
  WriteRegStr SHELL_CONTEXT "Software\Classes\EasyPlayer.Audio.${EXT}" "" "${FORMAT} Audio"
  ${If} $LANGUAGE == 2052
    WriteRegStr SHELL_CONTEXT "Software\Classes\EasyPlayer.Audio.${EXT}" "" "${FORMAT} 音频"
  ${EndIf}
  WriteRegStr SHELL_CONTEXT "Software\Classes\EasyPlayer.Audio.${EXT}\DefaultIcon" "" '"$INSTDIR\easy-player.exe",0'
  WriteRegStr SHELL_CONTEXT "Software\Classes\EasyPlayer.Audio.${EXT}\shell\open\command" "" '"$INSTDIR\easy-player.exe" "%1"'
  WriteRegNone SHELL_CONTEXT "Software\Classes\.${EXT}\OpenWithProgids" "EasyPlayer.Audio.${EXT}"
  WriteRegStr SHELL_CONTEXT "Software\EasyPlayer\Capabilities\FileAssociations" ".${EXT}" "EasyPlayer.Audio.${EXT}"
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\easy-player.exe\SupportedTypes" ".${EXT}" ""
!macroend

!macro UnregisterAudioExtension EXT
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.${EXT}\OpenWithProgids" "EasyPlayer.Audio.${EXT}"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\EasyPlayer.Audio.${EXT}"
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.${EXT}\OpenWithProgids" "EasyPlayer.Audio"
!macroend

!macro customInstall
  ; Keep the old shared ProgID valid for users who already selected it as default.
  ; Windows requires users to confirm moving that default to a format-specific ProgID.
  WriteRegStr SHELL_CONTEXT "Software\Classes\EasyPlayer.Audio" "" "Audio File"
  ${If} $LANGUAGE == 2052
    WriteRegStr SHELL_CONTEXT "Software\Classes\EasyPlayer.Audio" "" "音频文件"
  ${EndIf}
  WriteRegStr SHELL_CONTEXT "Software\Classes\EasyPlayer.Audio\DefaultIcon" "" '"$INSTDIR\easy-player.exe",0'
  WriteRegStr SHELL_CONTEXT "Software\Classes\EasyPlayer.Audio\shell\open\command" "" '"$INSTDIR\easy-player.exe" "%1"'
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\easy-player.exe" "FriendlyAppName" "Easy Player"
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\easy-player.exe\shell\open\command" "" '"$INSTDIR\easy-player.exe" "%1"'
  WriteRegStr SHELL_CONTEXT "Software\EasyPlayer\Capabilities" "ApplicationName" "Easy Player"
  WriteRegStr SHELL_CONTEXT "Software\EasyPlayer\Capabilities" "ApplicationDescription" "Play local audio files with Easy Player"
  WriteRegStr SHELL_CONTEXT "Software\EasyPlayer\Capabilities" "ApplicationIcon" '"$INSTDIR\easy-player.exe",0'
  WriteRegStr SHELL_CONTEXT "Software\RegisteredApplications" "Easy Player" "Software\EasyPlayer\Capabilities"
  !insertmacro RegisterAudioExtension mp3 MP3
  !insertmacro RegisterAudioExtension aac AAC
  !insertmacro RegisterAudioExtension m4a M4A
  !insertmacro RegisterAudioExtension ogg OGG
  !insertmacro RegisterAudioExtension opus OPUS
  !insertmacro RegisterAudioExtension flac FLAC
  !insertmacro RegisterAudioExtension wav WAV
  !insertmacro RegisterAudioExtension aiff AIFF
  !insertmacro RegisterAudioExtension ape APE
  !insertmacro RegisterAudioExtension dff DFF
  !insertmacro RegisterAudioExtension dsf DSF
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro customUnInstall
  !insertmacro UnregisterAudioExtension mp3
  !insertmacro UnregisterAudioExtension aac
  !insertmacro UnregisterAudioExtension m4a
  !insertmacro UnregisterAudioExtension ogg
  !insertmacro UnregisterAudioExtension opus
  !insertmacro UnregisterAudioExtension flac
  !insertmacro UnregisterAudioExtension wav
  !insertmacro UnregisterAudioExtension aiff
  !insertmacro UnregisterAudioExtension ape
  !insertmacro UnregisterAudioExtension dff
  !insertmacro UnregisterAudioExtension dsf
  DeleteRegKey SHELL_CONTEXT "Software\Classes\EasyPlayer.Audio"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\Applications\easy-player.exe"
  DeleteRegKey SHELL_CONTEXT "Software\EasyPlayer\Capabilities"
  DeleteRegValue SHELL_CONTEXT "Software\RegisteredApplications" "Easy Player"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
