param([Parameter(Mandatory=$true)][string]$ArtifactDirectory)
$ErrorActionPreference='Stop'
$artifacts=(Resolve-Path $ArtifactDirectory).Path
$setup=@(Get-ChildItem $artifacts -Filter '*Windows-x64-Setup.exe')
$zip=@(Get-ChildItem $artifacts -Filter '*Windows-x64.zip')
if($setup.Count -ne 1 -or $zip.Count -ne 1){throw 'Exactly one installer and update zip required'}
$installed=Join-Path $env:LOCALAPPDATA 'Programs\Wenjian'
$data=Join-Path $env:APPDATA '问间'
if((Test-Path $installed) -or (Test-Path $data)){throw 'This test requires an empty disposable Windows runner'}
$report=[ordered]@{platform='Windows';installer=$setup[0].Name;checks=@()}
function Check($condition,$label){if(-not $condition){throw $label};$script:report.checks+=@($label);Write-Output ('PASS: '+$label);$script:report|ConvertTo-Json -Depth 20|Set-Content (Join-Path $artifacts 'windows-install-report.json') -Encoding UTF8}
function InstallSetup { Write-Output 'Starting silent setup';$process=Start-Process -FilePath $setup[0].FullName -ArgumentList '/S' -PassThru;if(-not $process.WaitForExit(180000)){Get-Process|Select-Object Id,ProcessName,MainWindowTitle|ConvertTo-Json|Set-Content (Join-Path $artifacts 'windows-process-report.json');Stop-Process -Id $process.Id -Force;throw 'Setup timed out after 180 seconds'};return $process }
function Launch($exe){
 $app=Start-Process -FilePath $exe -ArgumentList '--remote-debugging-port=0' -PassThru
 for($i=0;$i -lt 120;$i++){
  Start-Sleep -Milliseconds 500
  $ports=@(Get-NetTCPConnection -State Listen -OwningProcess $app.Id -ErrorAction SilentlyContinue)
  foreach($entry in $ports){try{$origin='http://127.0.0.1:'+$entry.LocalPort;$info=Invoke-RestMethod ($origin+'/api/app/info') -TimeoutSec 2;if($info.platform -eq 'win32'){return @{app=$app;origin=$origin;info=$info}}}catch{}}
 }
 throw 'Installed application server did not start'
}
function CloseApp($app){$null=$app.CloseMainWindow();if(-not $app.WaitForExit(10000)){Stop-Process -Id $app.Id -Force;$app.WaitForExit()};Start-Sleep -Seconds 2}
try{
 New-Item -ItemType Directory -Force $data | Out-Null
 $fixture=Get-Content 'work/mac-app/seed.json' -Raw -Encoding UTF8 | ConvertFrom-Json
 $fixture.data.setupCompleted=$true
 $fixture.data.notes[0].title='虚构 Windows 安装测试'
 $fixture.data.cards=@(@{id='installation-fixture';text='原有资料必须保留';at='2026-10-16T00:00:00Z';origin='自己的思考';source='';thoughts=@()})
 [IO.File]::WriteAllText((Join-Path $data 'notebook.json'),($fixture|ConvertTo-Json -Depth 100),[Text.UTF8Encoding]::new($false))
 # Ordinary ZIP users and installed users must resolve the same data directory.
 Expand-Archive -LiteralPath $zip[0].FullName -DestinationPath (Join-Path $artifacts 'portable')
 $portableExe=Get-ChildItem (Join-Path $artifacts 'portable') -Filter Wenjian.exe -Recurse | Select-Object -First 1
 $run=Launch $portableExe.FullName
 $book=Invoke-RestMethod ($run.origin+'/api/notebook')
 Check ($book.data.cards.id -contains 'installation-fixture') 'Portable version reads existing AppData notebook'
 & node scripts/test-windows-fonts.cjs $data $artifacts
 if($LASTEXITCODE -ne 0){throw 'Actual Windows font rendering verification failed'}
 CloseApp $run.app
 $install=InstallSetup
 Check ($install.ExitCode -eq 0) 'Silent installation succeeds without administrator privileges'
 Check (Test-Path (Join-Path $installed 'Uninstall.exe')) 'Uninstaller is installed'
 $run=Launch (Join-Path $installed 'Wenjian.exe')
 Check ($run.info.build -eq '321') 'Installed app identifies build 321'
 $book=Invoke-RestMethod ($run.origin+'/api/notebook')
 Check ($book.data.cards.id -contains 'installation-fixture') 'Installed app reuses portable notebook without migration loss'
 $font=Invoke-WebRequest ($run.origin+'/fonts/NotoSansSC-variable.woff2')
 Check ($font.RawContentLength -gt 7000000) 'Offline Chinese sans font is served in Windows'
 $font=Invoke-WebRequest ($run.origin+'/fonts/NotoSerifSC-variable.woff2')
 Check ($font.RawContentLength -gt 10000000) 'Offline Chinese serif font is served in Windows'
 $css=Invoke-WebRequest ($run.origin+'/fonts/windows-fonts.css')
 Check ($css.Content -match 'Wenjian Serif') 'Typography CSS is packaged'
 CloseApp $run.app
 $install=InstallSetup
 Check ($install.ExitCode -eq 0) 'Reinstall replaces existing installation successfully'
 $run=Launch (Join-Path $installed 'Wenjian.exe')
 $book=Invoke-RestMethod ($run.origin+'/api/notebook')
 Check ($book.data.cards.id -contains 'installation-fixture') 'Existing content survives covering installation'
 CloseApp $run.app
 # Exercise the actual ZIP update helper against the installed app; matching-build
 # fixture isolates replacement/startup confirmation from separately tested discovery.
 $cache=Join-Path $data 'update-cache'
 New-Item -ItemType Directory -Force $cache | Out-Null
 $nonce=[guid]::NewGuid().ToString()
 $confirmation=Join-Path $cache ('boot-'+$nonce+'.json')
 $spec=@{directory=$cache;zip=$zip[0].FullName;target=$installed;pid=2147483647;platform='win32';exe=(Join-Path $installed 'Wenjian.exe');version='3.14';build=321;nonce=$nonce;confirmation=$confirmation}
 $config=Join-Path $cache 'install-fixture.json'
 $jobJson=$spec|ConvertTo-Json
 [IO.File]::WriteAllText($config,$jobJson,[Text.UTF8Encoding]::new($false))
 [IO.File]::WriteAllText((Join-Path $cache 'pending-install.json'),$jobJson,[Text.UTF8Encoding]::new($false))
 $uninstallHash=(Get-FileHash (Join-Path $installed 'Uninstall.exe')).Hash
 & powershell.exe -NoProfile -ExecutionPolicy Bypass -File 'work/mac-app/asar-src/update-installer.ps1' -Config $config
 $result=Get-Content (Join-Path $cache 'status.json') -Raw -Encoding UTF8|ConvertFrom-Json
 Check ($result.state -eq 'succeeded') 'Production ZIP update helper replaces installed app and confirms startup'
 Check ((Get-FileHash (Join-Path $installed 'Uninstall.exe')).Hash -eq $uninstallHash) 'ZIP update preserves installed uninstaller'
 $running=Get-Process Wenjian | Where-Object {$_.Path -eq (Join-Path $installed 'Wenjian.exe') -and $_.MainWindowHandle -ne 0} | Select-Object -First 1
 if(-not $running){$running=Get-Process Wenjian | Where-Object {$_.Path -eq (Join-Path $installed 'Wenjian.exe')} | Select-Object -First 1}
 Check ($null -ne $running) 'Updated program is running'
 CloseApp $running
 $uninstall=Start-Process -FilePath (Join-Path $installed 'Uninstall.exe') -ArgumentList '/S' -Wait -PassThru
 Start-Sleep -Seconds 5
 Check (Test-Path (Join-Path $data 'notebook.json')) 'Uninstall preserves notebook data'
 $remaining=Get-Content (Join-Path $data 'notebook.json') -Raw -Encoding UTF8 | ConvertFrom-Json
 Check ($remaining.data.cards.id -contains 'installation-fixture') 'Uninstall preserves original fixture content'
 $report.success=$true
}finally{
 $report|ConvertTo-Json -Depth 20|Set-Content (Join-Path $artifacts 'windows-install-report.json') -Encoding UTF8
}
