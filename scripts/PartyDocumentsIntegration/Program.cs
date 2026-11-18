using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Dapper;
using Microsoft.Data.SqlClient;
using SmartLaws.Web.Models;

var fixture = "partydocs" + Guid.NewGuid().ToString("N")[..12];
var password = Guid.NewGuid().ToString("N");
using var http = new HttpClient(new HttpClientHandler { CookieContainer = new() }) {
    BaseAddress = new(Environment.GetEnvironmentVariable("SMARTLAWS_TEST_BASE_URL") ?? "http://127.0.0.1:5091")
};
using var db = new SqlConnection(JsonNode.Parse(await File.ReadAllTextAsync("appsettings.json"))!["ConnectionStrings"]!["DefaultConnection"]!.GetValue<string>());
await db.OpenAsync();
int caseId = 0;
void Check(bool condition, string message) { if (!condition) throw new Exception(message); }
async Task<JsonNode> Send(string path, object body, HttpMethod? method = null) {
    using var response = await http.SendAsync(new HttpRequestMessage(method ?? HttpMethod.Post, path) { Content = JsonContent.Create(body) });
    var text = await response.Content.ReadAsStringAsync();
    Check(response.IsSuccessStatusCode, path + ": " + response.StatusCode + " " + text.Split("HEADERS")[0]);
    return JsonNode.Parse(text)!;
}
try {
    await Send("/api/auth/register", new { username = fixture, passwordHash = password, fullName = fixture, licenseNo = "TEST" });
    await Send("/api/auth/login", new { username = fixture, password });
    var created = await Send("/api/cases", new LawCase {
        CourtName = "ศาลทดสอบ", BlackCaseNo = fixture, PlaintiffName = "โจทก์ทดสอบ", DefendantName = "จำเลยทดสอบสองคน",
        LawyerRole = "ทนายจำเลย", PartyCountsJson = "{\"จำเลย\":2}",
        InitialParties = [new() { PartySide = "จำเลย", PartyOrder = 1, Title = "นาย", FullName = "หนึ่ง ทดสอบ", IsOurClient = true },
                          new() { PartySide = "จำเลย", PartyOrder = 2, Title = "นางสาว", FullName = "สอง ทดสอบ", IsOurClient = true }]
    });
    caseId = (int)created["id"]!;
    var parties = (await db.QueryAsync<CaseParty>("SELECT * FROM SL_CaseParties WHERE CaseId=@caseId ORDER BY PartyOrder", new { caseId })).ToList();
    foreach (var code in new[] { "(๙)", "(๑๑)", "(๑๑ ก.)", "(๗)", "(๑๐)", "(๔)", "(๑๒)", "(๑๓)", "(๑๔)", "(๓๒)" }) {
        CaseDocument Draft(CaseParty p) => new() {
            CaseId = caseId, PartyId = p.Id, FormCode = code, DocumentTitle = "ทดสอบ " + code,
            RequesterFullName = p.Title + p.FullName, RequesterStatus = "จำเลยที่ " + p.PartyOrder,
            ClausesJson = "[{\"Content\":\"ข้อความของจำเลยที่ " + p.PartyOrder + "\"}]",
            ExtraFieldsJson = new JsonObject { ["SelectedPartyId"] = p.Id }.ToJsonString()
        };
        var first = Draft(parties[0]);
        var second = Draft(parties[1]);
        first.Id = (int)(await Send("/api/documents", first))["id"]!;
        var baseline = await db.QuerySingleAsync<CaseDocument>("SELECT * FROM SL_CaseDocuments WHERE Id=@Id", first);
        var firstArchive = await Send($"/api/documents/{first.Id}/archive", new { pageCount = 2 });
        using (var overwritten = await http.PutAsJsonAsync($"/api/documents/{first.Id}", second))
            Check(overwritten.StatusCode == HttpStatusCode.Conflict, code + ": cannot overwrite defendant 1 with defendant 2");
        second.Id = (int)(await Send("/api/documents", second))["id"]!;
        var secondArchive = await Send($"/api/documents/{second.Id}/archive", new { pageCount = 3 });
        Check(first.Id != second.Id && (int)firstArchive["fileId"]! != (int)secondArchive["fileId"]!, code + ": separate document and archive IDs");
        second.ClausesJson = "[{\"Content\":\"แก้ไขเฉพาะคนที่สอง\"}]";
        await Send($"/api/documents/{second.Id}", second, HttpMethod.Put);
        var repeated = await Send($"/api/documents/{second.Id}/archive", new { pageCount = 4 });
        Check((int)repeated["fileId"]! == (int)secondArchive["fileId"]!, code + ": repeated archive updates only its own entry");
        using (var duplicate = await http.PostAsJsonAsync("/api/documents", Draft(parties[1])))
            Check(duplicate.StatusCode == HttpStatusCode.Conflict, code + ": reject duplicate for same party");
        var unchanged = await db.QuerySingleAsync<CaseDocument>("SELECT * FROM SL_CaseDocuments WHERE Id=@Id", first);
        Check(unchanged.PartyId == first.PartyId && unchanged.ClausesJson == baseline.ClausesJson, code + ": original content retained");
        Check(await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM SL_CaseFileAttachments WHERE CaseId=@caseId AND FormCode=@code", new { caseId, code }) == 2, code + ": exactly two archive entries");
        Console.WriteLine("PASS " + code + ": separate parties, immutable ownership, repeat save/archive, duplicate guard, original preserved");
    }
} finally {
    // Remove only the fixtures belonging to this exact, randomly named account.
    if (caseId > 0) {
        var documents = (await db.QueryAsync<int>("SELECT Id FROM SL_CaseDocuments WHERE CaseId=@caseId", new { caseId })).ToList();
        foreach (var id in documents) {
            using var response = await http.DeleteAsync($"/api/documents/{id}");
            Check(response.IsSuccessStatusCode, "Fixture document cleanup failed");
        }
        await db.ExecuteAsync("DELETE FROM SL_CaseParties WHERE CaseId=@caseId; DELETE FROM SL_LawCases WHERE Id=@caseId AND BlackCaseNo=@fixture", new { caseId, fixture });
    }
    await db.ExecuteAsync("""
        DECLARE @uid int,@profile int;
        SELECT @uid=Id,@profile=LawyerProfileId FROM SL_UserAccounts WHERE Username=@fixture;
        DELETE FROM SL_Sessions WHERE UserId=@uid;
        DELETE FROM SL_AuditLog WHERE UserId=@uid;
        DELETE FROM SL_ElectronicSignatures WHERE SignerName=@fixture;
        DELETE FROM SL_UserAccounts WHERE Id=@uid;
        DELETE FROM SL_LawyerProfiles WHERE Id=@profile;
        """, new { fixture });
}
