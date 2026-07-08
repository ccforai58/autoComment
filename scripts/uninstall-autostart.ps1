$ErrorActionPreference = "Continue"

$TaskName = "AutoCommentLocalStack"

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

Write-Output "Removed Windows logon task: $TaskName"
