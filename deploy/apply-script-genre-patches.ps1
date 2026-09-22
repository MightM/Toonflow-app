# 把 script-genre-patches/<题材>/ 下的「题材附加规则 · X」章节追加到 ToonFlow 全局剧本技能文件末尾
# 每个题材一章。默认只追加目标文件里还没有的章节，已有章节一律不动（用户可能改过）；
# 加 -UpdateExisting 才把内容有变的已有章节整章替换。首次改动前留 .bak-20260917 备份
# 本文件必须带 UTF-8 BOM：Windows PowerShell 5.1 按系统 ANSI（gb2312）解析无 BOM 脚本，中文字面量会被打乱
# 用法：powershell -NoProfile -ExecutionPolicy Bypass -File apply-script-genre-patches.ps1 [-PatchDir 目录] [-UpdateExisting]
param(
  [string]$PatchDir = (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "script-genre-patches"),
  [switch]$UpdateExisting
)
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$skills = Join-Path $env:APPDATA "ToonFlow\data\skills"
$utf8 = New-Object Text.UTF8Encoding $false
$prefix = "## 题材附加规则 · "
# 文本 = 原版正文 + 若干章节；章节之间用空行 + --- + 空行分隔，每章以 "## 题材附加规则 · X" 开头
$splitter = "\r?\n[ \t]*\r?\n---[ \t]*\r?\n[ \t]*\r?\n(?=" + [regex]::Escape($prefix) + ")"
function Split-Chapters([string]$text) {
  $parts = [regex]::Split($text, $splitter)
  $chapters = [ordered]@{}
  for ($i = 1; $i -lt $parts.Length; $i++) {
    $body = $parts[$i].TrimEnd()
    $head = ($body -split "\r?\n", 2)[0]
    if (-not $head.StartsWith($prefix)) { throw "章节标题不以「$prefix」开头：[$head]" }
    $genre = $head.Substring($prefix.Length).Trim()
    $chapters[$genre] = $body
  }
  return @{ base = $parts[0].TrimEnd(); chapters = $chapters }
}
function Join-Chapters($base, $chapters) {
  $out = $base
  foreach ($k in $chapters.Keys) { $out += "`n`n---`n`n" + $chapters[$k] + "`n" }
  return $out
}
$genreDirs = Get-ChildItem -Directory $PatchDir | Sort-Object Name
foreach ($name in @("script_agent_decision", "script_execution_skeleton", "script_execution_adaptation", "script_execution_script", "script_agent_supervision")) {
  $target = Join-Path $skills "$name.md"
  $backup = "$target.bak-20260917"
  $text = [IO.File]::ReadAllText($target, [Text.Encoding]::UTF8)
  $doc = Split-Chapters $text
  $changed = @(); $kept = @()
  foreach ($dir in $genreDirs) {
    $patchFile = Join-Path $dir.FullName "$name.md"
    if (-not (Test-Path $patchFile)) { continue }
    $patch = Split-Chapters ([IO.File]::ReadAllText($patchFile, [Text.Encoding]::UTF8))
    foreach ($g in $patch.chapters.Keys) {
      if ($doc.chapters.Contains($g)) {
        if ($doc.chapters[$g] -eq $patch.chapters[$g]) { continue }
        if (-not $UpdateExisting) { $kept += $g; continue }
      }
      $doc.chapters[$g] = $patch.chapters[$g]
      $changed += $g
    }
  }
  if ($kept.Count -gt 0) { "{0}: existing chapters kept as-is [{1}] (differ from patch; pass -UpdateExisting to replace)" -f $name, ($kept -join ", ") }
  if ($changed.Count -eq 0) { "{0}: nothing to add, skip" -f $name; continue }
  if (-not (Test-Path $backup)) { Copy-Item $target $backup }
  $out = Join-Chapters $doc.base $doc.chapters
  [IO.File]::WriteAllText($target, $out, $utf8)
  "{0}: chapters updated [{1}] ({2} -> {3} bytes)" -f $name, ($changed -join ", "), $text.Length, $out.Length
}
