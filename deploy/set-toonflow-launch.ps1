# 设置 ToonFlow 的启动参数并（可选）拉起它。默认参数 --disable-gpu：
# 生产机上 ComfyUI 出图时 RTX 3060 Ti 100%、显存 7.6/8 GB 占满，Chromium 的 GPU 进程拿不到时间片，
# ToonFlow 整个窗口会卡到出图结束；关掉硬件加速后窗口由 CPU 合成，不再和 ComfyUI 抢显卡。
# 做三件事：① 桌面 / 开始菜单里指向 ToonFlow.exe 的快捷方式写入参数；② 计划任务 ToonFlowStart 用同样的参数；③ -Start 时拉起。
# 用法：set-toonflow-launch.ps1 [-LaunchArgs "--disable-gpu"] [-Start]   （-LaunchArgs "" 可恢复硬件加速）
param(
  [string]$Exe = "D:\toonflow\ToonFlow.exe",
  [string]$LaunchArgs = "--disable-gpu",
  [switch]$Start
)
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$shell = New-Object -ComObject WScript.Shell
$roots = @("$env:USERPROFILE\Desktop", "$env:PUBLIC\Desktop", "$env:APPDATA\Microsoft\Windows\Start Menu\Programs", "$env:ProgramData\Microsoft\Windows\Start Menu\Programs")
$patched = 0
foreach ($root in $roots) {
  if (-not (Test-Path $root)) { continue }
  Get-ChildItem $root -Recurse -Filter "*.lnk" -ErrorAction SilentlyContinue | ForEach-Object {
    $lnk = $shell.CreateShortcut($_.FullName)
    if ($lnk.TargetPath -ne $Exe) { return }
    if ($lnk.Arguments -eq $LaunchArgs) { "shortcut ok: $($_.FullName)"; return }
    $lnk.Arguments = $LaunchArgs
    $lnk.Save()
    $patched++
    "shortcut updated: $($_.FullName) -> `"$Exe`" $LaunchArgs"
  }
}
"shortcuts patched: $patched"

$task = "ToonFlowStart"
$tr = if ($LaunchArgs) { "`"$Exe`" $LaunchArgs" } else { "`"$Exe`"" }
schtasks /Create /TN $task /TR $tr /SC ONCE /ST 00:00 /IT /F | Out-Null
"task $task -> $tr"
if ($Start) {
  schtasks /Run /TN $task | Out-Null
  "started"
}
