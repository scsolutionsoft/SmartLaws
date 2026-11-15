param([int]$Port = 5088)
$ErrorActionPreference = 'Stop'
$edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
$appUrl = "http://127.0.0.1:$Port"
$testName = 'clause-font-smoke-' + [Guid]::NewGuid().ToString('N') + '.html'
$testPath = Join-Path (Join-Path $PSScriptRoot '..\wwwroot') $testName
$profileDir = Join-Path ([IO.Path]::GetTempPath()) ('smartlaws-font-smoke-profile-' + [Guid]::NewGuid().ToString('N'))
$stdoutPath = Join-Path ([IO.Path]::GetTempPath()) ($testName + '.out')
$stderrPath = Join-Path ([IO.Path]::GetTempPath()) ($testName + '.err')
$edgeProcess = $null

if (!(Test-Path -LiteralPath $edge)) { throw 'Microsoft Edge executable not found' }
if (!(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)) { throw "SmartLaws must be running on port $Port" }

$html = @'
<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/css/court-forms.css?v=17"></head><body>
<select id="edFormCode"><option value="(๑๑)">คำให้การจำเลย</option></select>
<select id="edClauseTextFontFamily"><option value="th-sarabun-new">TH Sarabun New</option><option value="angsana-new">Angsana New</option></select>
<select id="edClauseTextFontSize"><option value="16">16</option><option value="18">18</option></select>
<span id="clausesSectionLabel"></span><div class="editor-panel"><div id="clauseTextStyleControls"></div><div id="clausesEditorList"></div></div><div id="studioPaperPreview"></div>
<script src="/js/court-renderer.js?v=23"></script><script>
document.addEventListener('DOMContentLoaded',()=>{const app=document.createElement('script');app.src='/js/app.js?v=18';app.onload=()=>{try{
const form=document.getElementById('edFormCode');form.value='(๑๑)';
App.state.currentClauses=[
 {ClauseTitle:'ข้อ ๑.',Content:'ข้อความทดสอบการจัดแนวบนเส้นประและการตัดคำไทยให้เต็มบรรทัด '.repeat(9)},
 {ClauseTitle:'ข้อ ๒.',Content:'ข้อความข้อที่สองต้องใช้ตัวเลือกฟอนต์และขนาดชุดเดียวกัน'}
];App.renderClausesEditorList();
document.getElementById('edClauseTextFontFamily').value='angsana-new';
document.getElementById('edClauseTextFontSize').value='18';App.updateClauseTextStyle();
const cards=[...document.querySelectorAll('#clausesEditorList > div')], inputs=cards.map(card=>card.querySelector('textarea'));
const saved=App.collectCurrentDocFromInputs(), extra=JSON.parse(saved.extraFieldsJson);
const paper=document.createElement('div');paper.innerHTML=CourtRenderer.renderDocumentPagesHtml(saved,{});document.body.append(paper);
const lines=[...paper.querySelectorAll('.court-thai-line')].filter(line=>line.textContent.trim());
const line=lines.find(item=>parseFloat(item.style.letterSpacing||'0')>0)||lines[0], range=document.createRange();range.selectNodeContents(line);
const tokens=CourtRenderer.tokenizeThaiLineText('amount 150,000.50 baht date 9/99');
const formCodes=['(๑)','(๒)','(๓)','(๔)','(๕)','(๖)','(๗)','(๘)','(๙)','(๑๐)','(๑๑)','(๑๑ ก.)','(๑๒)','(๑๓)','(๑๔)','(๑๕)','(๔๐ ก.)'];
const formStyleChecks=formCodes.map(formCode=>{const d={...saved,formCode};const host=document.createElement('div');host.innerHTML=CourtRenderer.renderDocumentPagesHtml(d,{});document.body.append(host);const page=host.querySelector('.court-page'),field=host.querySelector('.court-dotted-line')||host.querySelector('.court-thai-line');const style=field?getComputedStyle(field):null;const check={formCode,family:style?.fontFamily||'',size:style?.fontSize||'',hasPageStyle:!!page?.style.getPropertyValue('--court-entry-font-family')};host.remove();return check;});
const textRect=range.getBoundingClientRect(),lineRect=line.getBoundingClientRect();
document.body.dataset.result=JSON.stringify({inputFamilies:inputs.map(input=>getComputedStyle(input).fontFamily),inputSizes:inputs.map(input=>getComputedStyle(input).fontSize),savedFamily:extra.TextFontFamily,savedSize:extra.TextFontSize,paperStyle:line.getAttribute('style'),lineCount:lines.length,letterSpacing:line.style.letterSpacing,textToDottedGap:lineRect.bottom-textRect.bottom,lineWidth:lineRect.width,textWidth:textRect.width,rightGap:lineRect.right-textRect.right,perClauseSelectors:cards.reduce((count,card)=>count+card.querySelectorAll('select').length,0),numericTokens:tokens.filter(token=>/[0-9๐-๙]/.test(token)),formStyleChecks});
document.body.dataset.status='PASS';
}catch(error){document.body.dataset.status='FAIL';document.body.dataset.error=error.stack||String(error);}};app.onerror=()=>{document.body.dataset.status='FAIL';document.body.dataset.error='Unable to load app.js';};document.body.appendChild(app);});
</script></body></html>
'@

try {
    [IO.File]::WriteAllText($testPath, $html, [Text.UTF8Encoding]::new($false))
    $edgeProcess = Start-Process -FilePath $edge -ArgumentList @('--headless=new','--disable-gpu',"--user-data-dir=$profileDir",'--dump-dom',"$appUrl/$testName") -WindowStyle Hidden -PassThru -Wait -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
    $output = Get-Content -LiteralPath $stdoutPath -Raw
    if ($output -notmatch 'data-status="PASS"') {
        $details = if ($output -match 'data-error="([^"]*)"') { [Net.WebUtility]::HtmlDecode($Matches[1]) } else { Get-Content -LiteralPath $stderrPath -Raw }
        throw "Browser smoke test failed: $details"
    }
    $encoded = [regex]::Match($output, 'data-result="([^"]+)"').Groups[1].Value
    $state = [Net.WebUtility]::HtmlDecode($encoded) | ConvertFrom-Json
    if ($state.savedFamily -ne 'angsana-new' -or $state.savedSize -ne 18) { throw 'Shared font and size did not persist in document settings' }
    if (($state.inputSizes | Where-Object { $_ -ne '24px' }).Count -or @($state.inputFamilies | Where-Object { !$_.Contains('Angsana New') }).Count) { throw 'All clause input boxes did not receive the shared style' }
    if (!$state.paperStyle.Contains('Angsana New') -or !$state.paperStyle.Contains('font-size:18pt')) { throw 'Preview did not use the shared font and size' }
    if ($state.perClauseSelectors -ne 0) { throw 'Font controls still appear within each clause card' }
    if (@($state.formStyleChecks | Where-Object { !$_.hasPageStyle -or $_.size -ne '24px' -or !$_.family.Contains('Angsana New') }).Count) { throw 'Shared font settings are not applied to every court form code' }
    Write-Output ('Line measurement: width={0}px text={1}px gap={2}px spacing={3}' -f $state.lineWidth,$state.textWidth,$state.rightGap,$state.letterSpacing)
    $currencyToken = [string](@($state.numericTokens | Where-Object { $_ -match '^\d{1,3}(,\d{3})*(\.\d+)?$' }) | Select-Object -First 1)
    if ($currencyToken.Length -lt 8) { throw ('Currency digit groups are being split: ' + ($state.numericTokens -join '|')) }
    $spacing = [double]([regex]::Match($state.letterSpacing, '-?\d+(?:\.\d+)?').Value)
    if ($state.lineCount -lt 2 -or $spacing -lt 0) { throw 'Thai text did not wrap and justify full non-final lines' }
    if ([double]$state.textToDottedGap -gt 8) { throw 'Preview text is not aligned close enough to its dotted writing line' }
    if ([double]$state.rightGap -gt 8) { throw ('Non-final line does not fill its available width: ' + $state.rightGap + 'px remaining') }
    Write-Output 'PASS: single document-level controls apply to every clause, persist, fill wrapped lines, and align text to dotted rules'
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
