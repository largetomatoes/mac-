param([Parameter(Mandatory=$true)][string]$Config)
$ErrorActionPreference='Stop'
$job=Get-Content -LiteralPath $Config -Raw -Encoding UTF8 | ConvertFrom-Json
if($job.platform -ne 'win32' -or [IO.Path]::GetDirectoryName($Config) -ne $job.directory){throw 'Invalid update configuration'}
# Leave the application directory before moving it; Windows holds a CWD handle.
Set-Location -LiteralPath $job.directory
$backup=$job.target+'.wenjian-previous-'+$job.nonce
$stage=Join-Path $job.directory ('stage-'+$job.nonce)
$moved=$false
try{
 for($i=0;$i -lt 300;$i++){if(-not(Get-Process -Id $job.pid -ErrorAction SilentlyContinue)){break};Start-Sleep -Milliseconds 200}
 if(Get-Process -Id $job.pid -ErrorAction SilentlyContinue){throw 'Application is still running'}
 Expand-Archive -LiteralPath $job.zip -DestinationPath $stage
 $roots=@(Get-ChildItem -LiteralPath $stage -Directory)
 if($roots.Count -ne 1 -or -not(Test-Path -LiteralPath (Join-Path $roots[0].FullName 'Wenjian.exe'))){throw 'Invalid Windows application package'}
 # Keep the installed uninstaller through signed application-only zip upgrades.
 $uninstaller=Join-Path $job.target "Uninstall.exe"
 if(Test-Path -LiteralPath $uninstaller){Copy-Item -LiteralPath $uninstaller -Destination (Join-Path $roots[0].FullName "Uninstall.exe")}
 Move-Item -LiteralPath $job.target -Destination $backup
 $moved=$true
 Move-Item -LiteralPath $roots[0].FullName -Destination $job.target
 $app=Start-Process -FilePath (Join-Path $job.target 'Wenjian.exe') -PassThru
 $ok=$false
 for($i=0;$i -lt 300;$i++){if(Test-Path -LiteralPath $job.confirmation){$result=Get-Content -LiteralPath $job.confirmation -Raw -Encoding UTF8|ConvertFrom-Json;if($result.nonce -eq $job.nonce -and $result.build -eq $job.build){$ok=$true;break}};Start-Sleep -Milliseconds 200}
 if(-not $ok){throw 'New application did not confirm valid startup'}
 $registry="HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Wenjian"
 if(Test-Path $registry){Set-ItemProperty -Path $registry -Name DisplayVersion -Value ($job.version+" ("+$job.build+")");Set-ItemProperty -Path $registry -Name Build -Value ([int]$job.build)}
 Remove-Item -LiteralPath $backup -Recurse -Force
 Remove-Item -LiteralPath $stage -Recurse -Force
 @{state='succeeded'}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $job.directory 'status.json') -Encoding UTF8
}catch{
 if($moved){if($app){Stop-Process -Id $app.Id -ErrorAction SilentlyContinue};Move-Item -LiteralPath $job.target -Destination ($job.target+'.failed-'+$job.nonce);Move-Item -LiteralPath $backup -Destination $job.target;Start-Process -FilePath (Join-Path $job.target 'Wenjian.exe')}
 @{state= $(if($moved){'rolledBack'}else{'failed'});error=$_.Exception.Message}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $job.directory 'status.json') -Encoding UTF8
}
