param([int]$Port = 5088)
$ErrorActionPreference = 'Stop'
$edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
$appUrl = "http://127.0.0.1:$Port"
$testName = 'form9-reset-smoke-' + [Guid]::NewGuid().ToString('N') + '.html'
$testPath = Join-Path (Join-Path $PSScriptRoot '..\wwwroot') $testName
$profileDir = Join-Path ([IO.Path]::GetTempPath()) ('smartlaws-form9-profile-' + [Guid]::NewGuid().ToString('N'))
$stdoutPath = Join-Path ([IO.Path]::GetTempPath()) ($testName + '.out')
$stderrPath = Join-Path ([IO.Path]::GetTempPath()) ($testName + '.err')
$edgeProcess = $null

if (!(Test-Path -LiteralPath $edge)) { throw 'Microsoft Edge executable not found' }
if (!(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)) { throw "SmartLaws must be running on port $Port" }

$html = @'
<!doctype html><html><head><meta charset="utf-8"></head><body>
<select id="edFormCode"><option value="(4)">(4)</option></select>
<script>
window.CourtRenderer={renderDocumentPagesHtml:()=>''};
const oldCode='('+String.fromCharCode(0x0e54)+')',form9='('+String.fromCharCode(0x0e59)+')';
window.App={state:{currentDoc:{caseId:1,formCode:oldCode,requesterFullName:'OLD CASE A398',requesterStatus:'OLD PARTY',requesterHouseNo:'88/398',docDay:'20',docMonth:'January',docYear:'68',signerName:'OLD SIGNER',drafterName:'OLD DRAFTER',clausesJson:'[{"Content":"OLD PETITION TEXT"}]',closingPrayer:'OLD CLOSING',extraFieldsJson:JSON.stringify({CaseFields:{courtName:'OLD COURT'},BlackCaseNo:'A.398',RedCaseNo:'A.398',AppointedLawyerName:'OLD LAWYER',TextFontFamily:'angsana-new',TextFontSize:18})},cases:[{id:1,primaryLawyerId:7}],lawyers:[{id:7,fullName:'Lawyer Profile',licenseNo:'12345'}],templates:[{formCode:form9,id:9,formName:'Appointment'}]},collectCurrentDocFromInputs(){return structuredClone(this.state.currentDoc)},toForm9LawyerProfile(p){return p?{fullName:p.fullName,licenseNo:p.licenseNo}:{}},loadDocumentIntoEditorState(doc){this.state.currentDoc=doc},syncEditorToPreview(){},showToast(){}};
</script>
<script src="/js/court-form-editor.js"></script>
<script>
CourtFormEditor.render=()=>{};
try{CourtFormEditor.changeForm(form9);const d=App.state.currentDoc,e=JSON.parse(d.extraFieldsJson);const stale=JSON.stringify(d).includes('OLD')||JSON.stringify(e).includes('OLD')||JSON.stringify(d).includes('398')||JSON.stringify(e).includes('398');const ok=!stale&&d.clausesJson==='[]'&&e.Form9Lawyer.fullName==='Lawyer Profile'&&e.TextFontFamily==='angsana-new'&&e.TextFontSize===18;document.body.dataset.status=ok?'PASS':'FAIL';document.body.dataset.result=JSON.stringify({requester:d.requesterFullName,clauses:d.clausesJson,extra:e});}catch(e){document.body.dataset.status='FAIL';document.body.dataset.error=e.stack||String(e)}
</script></body></html>
'@

try {
    [IO.File]::WriteAllText($testPath, $html, [Text.UTF8Encoding]::new($false))
    $edgeProcess = Start-Process -FilePath $edge -ArgumentList @('--headless=new','--disable-gpu',"--user-data-dir=$profileDir",'--dump-dom',"$appUrl/$testName") -WindowStyle Hidden -PassThru -Wait -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
    $output = Get-Content -LiteralPath $stdoutPath -Raw
    if ($output -notmatch 'data-status="PASS"') {
        $details = if ($output -match 'data-error="([^"]*)"') { [Net.WebUtility]::HtmlDecode($Matches[1]) } else { $output + "`n" + (Get-Content -LiteralPath $stderrPath -Raw) }
        throw "Form 9 reset smoke test failed: $details"
    }
    Write-Output 'PASS: switching to Form 9 clears stale case text and keeps only the lawyer profile and selected font settings'
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
