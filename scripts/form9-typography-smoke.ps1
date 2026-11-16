param([int]$Port = 5088)
$ErrorActionPreference = 'Stop'
$edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
$appUrl = "http://127.0.0.1:$Port"
$testName = 'form9-typography-smoke-' + [Guid]::NewGuid().ToString('N') + '.html'
$testPath = Join-Path (Join-Path $PSScriptRoot '..\wwwroot') $testName
$profileDir = Join-Path ([IO.Path]::GetTempPath()) ('smartlaws-form9-type-profile-' + [Guid]::NewGuid().ToString('N'))
$stdoutPath = Join-Path ([IO.Path]::GetTempPath()) ($testName + '.out')
$stderrPath = Join-Path ([IO.Path]::GetTempPath()) ($testName + '.err')
$edgeProcess = $null

if (!(Test-Path -LiteralPath $edge)) { throw 'Microsoft Edge executable not found' }
if (!(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)) { throw "SmartLaws must be running on port $Port" }

$html = @'
<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/css/court-forms.css?v=21"></head><body>
<div id="preview"></div><script src="/js/court-renderer.js?v=27"></script><script>
try{const code='('+String.fromCharCode(0x0e59)+')';const doc={formCode:code,documentTitle:'Appointment',docDay:'',docMonth:'',docYear:'',requesterFullName:'Client Example',requesterStatus:'',requesterCitizenId:'1234567890123',signerName:'',signatureImageBase64:'',clausesJson:'[]',extraFieldsJson:JSON.stringify({TextFontFamily:'angsana-new',TextFontSize:18,Form9Lawyer:{fullName:'Lawyer Example',citizenId:'1234567890123',licenseNo:'12345'}})};document.getElementById('preview').innerHTML=CourtRenderer.renderDocumentPagesHtml(doc,{});const pages=[...document.querySelectorAll('.court-form9-page')],page=pages[0],back=pages[1],field=page?.querySelector('.court-dotted-line'),digit=back?.querySelector('.court-form9-page .citizen-digit-box')||back?.querySelector('.citizen-digit-box'),dots=page?.querySelector('.court-form9-signature-dots'),name=page?.querySelector('.court-form9-signature-name'),sigLine=page?.querySelector('.court-form9-signature-line');if(!page||!field||!digit||!dots||!name)throw Error('Missing rendered Form 9 element: '+JSON.stringify({pages:pages.length,field:!!field,digit:!!digit,dots:!!dots,name:!!name}));const styles=[field,digit,name].map(x=>({size:getComputedStyle(x).fontSize,family:getComputedStyle(x).fontFamily}));const dr=dots.getBoundingClientRect(),nr=name.getBoundingClientRect(),centerGap=Math.abs((dr.left+dr.right)/2-(nr.left+nr.right)/2),rightGap=Math.abs(sigLine.getBoundingClientRect().right-nr.right);const ok=styles.every(s=>s.size==='24px'&&s.family.includes('Angsana New'))&&centerGap<1&&rightGap<1;document.body.dataset.status=ok?'PASS':'FAIL';document.body.dataset.result=JSON.stringify({styles,centerGap,rightGap});}catch(e){document.body.dataset.status='FAIL';document.body.dataset.error=e.stack||String(e)}
</script></body></html>
'@

try {
    [IO.File]::WriteAllText($testPath, $html, [Text.UTF8Encoding]::new($false))
    $edgeProcess = Start-Process -FilePath $edge -ArgumentList @('--headless=new','--disable-gpu',"--user-data-dir=$profileDir",'--dump-dom',"$appUrl/$testName") -WindowStyle Hidden -PassThru -Wait -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
    $output = Get-Content -LiteralPath $stdoutPath -Raw
    if ($output -notmatch 'data-status="PASS"') {
        $details = if ($output -match 'data-error="([^"]*)"') { [Net.WebUtility]::HtmlDecode($Matches[1]) } else { $output + "`n" + (Get-Content -LiteralPath $stderrPath -Raw) }
        throw "Form 9 typography smoke test failed: $details"
    }
    Write-Output 'PASS: Form 9 typography applies and the signature name is centered under the dotted line in the right-aligned block'
} finally {
    if ($edgeProcess -and !$edgeProcess.HasExited) { Stop-Process -Id $edgeProcess.Id -Force }
    foreach ($path in @($testPath, $stdoutPath, $stderrPath)) {
        if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force }
    }
    $resolvedProfile = [IO.Path]::GetFullPath($profileDir)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if ($resolvedProfile.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $resolvedProfile)) {
        Remove-Item -LiteralPath $resolvedProfile -Recurse -Force
    }
}



