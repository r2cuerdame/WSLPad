Add-Type -AssemblyName System.Windows.Forms
$form = [System.Windows.Forms.Form]::new()
$form.Text = 'WSLPad A/B companion window'
$form.Width = 400
$form.Height = 240
$form.ShowInTaskbar = $true
[System.Windows.Forms.Application]::Run($form)
