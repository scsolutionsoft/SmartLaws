using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Dapper;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using SmartLaws.Web.Models;

namespace SmartLaws.Web.Services;

public static class CaseArchive
{
    public record DeleteRequest(string BackupToken, bool Confirmed, string Confirmation);
    record Receipt(int CaseId, int UserId, string Hash, DateTimeOffset Expires);
    record Snapshot(LawCase Case, List<CaseParty> Parties, List<CaseDocument> Documents,
        List<CaseFileAttachment> Files, List<CaseAppointment> Appointments, List<LitigationEvent> Litigation,
        List<Link> AppointmentFiles, List<ClientDocumentLink> ClientDocuments, List<ClientAccess> ClientAccounts, List<ClientShare> ClientShares, List<ClientChatMessage> ClientMessages);
    public record Link(int AppointmentId, int FileId);
    static readonly JsonSerializerOptions Json = new() { WriteIndented = true };
    static async Task<Snapshot?> Read(SqlConnection c, SqlTransaction tx, int id)
    {
        var p = new { id };
        var item = await c.QuerySingleOrDefaultAsync<LawCase>("SELECT * FROM SL_LawCases WHERE Id=@id", p, tx);
        if (item == null) return null;
        return new(item,
            (await c.QueryAsync<CaseParty>("SELECT * FROM SL_CaseParties WHERE CaseId=@id ORDER BY Id", p, tx)).ToList(),
            (await c.QueryAsync<CaseDocument>("SELECT * FROM SL_CaseDocuments WHERE CaseId=@id ORDER BY Id", p, tx)).ToList(),
            (await c.QueryAsync<CaseFileAttachment>("SELECT * FROM SL_CaseFileAttachments WHERE CaseId=@id ORDER BY Id", p, tx)).ToList(),
            (await c.QueryAsync<CaseAppointment>("SELECT * FROM SL_Appointments WHERE CaseId=@id ORDER BY Id", p, tx)).ToList(),
            (await c.QueryAsync<LitigationEvent>("SELECT * FROM SL_LitigationEvents WHERE CaseId=@id ORDER BY Id", p, tx)).ToList(),
            (await c.QueryAsync<Link>("SELECT l.AppointmentId,l.FileId FROM SL_AppointmentFiles l JOIN SL_Appointments a ON a.Id=l.AppointmentId WHERE a.CaseId=@id ORDER BY l.AppointmentId,l.FileId", p, tx)).ToList(),
            (await c.QueryAsync<ClientDocumentLink>("SELECT * FROM SL_ClientDocuments WHERE CaseId=@id ORDER BY FileId", p, tx)).ToList(),
            (await c.QueryAsync<ClientAccess>("SELECT * FROM SL_ClientCaseLinks WHERE CaseId=@id ORDER BY UserId", p, tx)).ToList(),
            (await c.QueryAsync<ClientShare>("SELECT s.ClientUserId,s.CaseId,s.FileId FROM SL_ClientShares s JOIN SL_ClientCaseLinks a ON a.UserId=s.ClientUserId AND a.CaseId=s.CaseId WHERE a.CaseId=@id ORDER BY s.ClientUserId,s.FileId", p, tx)).ToList(),
            (await c.QueryAsync<ClientChatMessage>("SELECT * FROM SL_ClientChat WHERE CaseId=@id ORDER BY Id", p, tx)).ToList());
    }
    static string Hash(string json) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(json)));
    static string DownloadName(LawCase item)
    {
        var number = string.IsNullOrWhiteSpace(item.BlackCaseNo) ? item.CaseCode : item.BlackCaseNo.Trim();
        if (!string.IsNullOrWhiteSpace(item.BlackCaseNo) && !number.Contains('/') && !string.IsNullOrWhiteSpace(item.BlackCaseYear))
            number += "/" + item.BlackCaseYear.Trim();
        // Keep Thai case numbers, replacing characters that cannot appear in a filename.
        number = string.Concat((number ?? "").Select(ch => char.IsControl(ch) || "<>:\"/\\|?*".Contains(ch) ? '-' : ch)).Trim().TrimEnd('.');
        if (number.Length == 0) number = item.Id.ToString();
        if (number.Length > 120) number = number[..120];
        var now = DateTimeOffset.UtcNow.ToOffset(TimeSpan.FromHours(7));
        return $"คดีดำ-{number}_{now.ToString("dd-MM", System.Globalization.CultureInfo.InvariantCulture)}-{now.Year + 543}_{now.ToString("HH-mm-ss", System.Globalization.CultureInfo.InvariantCulture)}.zip";
    }
    static void Write(ZipArchive zip, string name, byte[] data)
    {
        using var output = zip.CreateEntry(name, CompressionLevel.Fastest).Open();
        output.Write(data);
    }
    public static void Map(RouteGroupBuilder api)
    {
        api.MapGet("/cases/{id:int}/backup", async (int id, HttpContext h, DatabaseService db, IDataProtectionProvider protection, WordExportService word, FileStorage storage) =>
        {
            using var c = db.CreateConnection(); await c.OpenAsync();
            using var tx = c.BeginTransaction(System.Data.IsolationLevel.Serializable);
            var snapshot = await Read(c, tx, id);
            if (snapshot == null) return Results.NotFound();
            var json = JsonSerializer.Serialize(snapshot, Json);
            tx.Commit();
            var tempPath=Path.Combine(Path.GetTempPath(),$"smartlaws-case-backup-{Guid.NewGuid():N}.zip");
            try
            {
                await using (var output=new FileStream(tempPath,FileMode.CreateNew,FileAccess.ReadWrite,FileShare.None,81920,FileOptions.Asynchronous|FileOptions.SequentialScan))
                using (var zip = new ZipArchive(output, ZipArchiveMode.Create, true))
                {
                    Write(zip, "case-data.json", Encoding.UTF8.GetBytes(json));
                    Write(zip, "README.txt", Encoding.UTF8.GetBytes("สำรองข้อมูลสำนวน SmartLaws\ncase-data.json: ข้อมูลคดี คู่ความ เอกสาร วันนัด ขั้นตอนคดี และความสัมพันธ์ไฟล์\nfiles/: ไฟล์ที่อัปโหลดจริง\ndocuments/: แบบพิมพ์จากสตูดิโอในรูปแบบ Word\nlinks/: ที่อยู่ไฟล์ภายนอก (ไม่ได้ดาวน์โหลดเนื้อหาจากเว็บไซต์ภายนอก)\nข้อมูลต้นฉบับและภาพลายเซ็นในเอกสารถูกเก็บใน JSON ด้วย โปรดเก็บ ZIP ในที่ปลอดภัย\n"));
                    foreach (var f in snapshot.Files)
                    {
                        if (!string.IsNullOrEmpty(f.StorageKey))
                        {
                            var ext = f.MimeType switch { "application/pdf" => ".pdf", "image/png" => ".png", "image/jpeg" => ".jpg", _ => ".bin" };
                            await using var input=storage.OpenRead(f.StorageKey);
                            await using var entry=zip.CreateEntry($"files/{f.Id}{ext}",CompressionLevel.Fastest).Open();
                            await input.CopyToAsync(entry,81920,h.RequestAborted);
                        }
                        else if (!string.IsNullOrEmpty(f.FileDataBase64))
                        {
                            var raw = f.FileDataBase64.Contains(',') ? f.FileDataBase64.Split(',', 2)[1] : f.FileDataBase64;
                            var ext = f.MimeType switch { "application/pdf" => ".pdf", "image/png" => ".png", "image/jpeg" => ".jpg", _ => ".bin" };
                            Write(zip, $"files/{f.Id}{ext}", Convert.FromBase64String(raw));
                        }
                        else if (!string.IsNullOrWhiteSpace(f.FileUrlOrPath))
                            Write(zip, $"links/{f.Id}.txt", Encoding.UTF8.GetBytes(f.FileTitle + "\n" + f.FileUrlOrPath));
                        else if (f.StorageType != "COURT_FORM" || !snapshot.Documents.Any(d => d.Id == f.DocumentId))
                            throw new InvalidDataException("ไฟล์ต้นฉบับไม่ครบ");
                    }
                    foreach (var doc in snapshot.Documents)
                        Write(zip, $"documents/{doc.Id}.docx", word.GenerateCourtDocumentDocx(doc, snapshot.Case));
                }
            }
            catch (Exception e) when (e is FormatException or InvalidDataException)
            {
                if(File.Exists(tempPath))File.Delete(tempPath);
                return Results.Conflict(new { message = "สร้าง ZIP ไม่สำเร็จ: ข้อมูลไฟล์ไม่ครบหรือเสียหาย กรุณาตรวจสอบก่อนลบ" });
            }
            h.Response.OnCompleted(()=>{if(File.Exists(tempPath))File.Delete(tempPath);return Task.CompletedTask;});
            var token = protection.CreateProtector("SmartLaws.CaseArchive.v1").Protect(JsonSerializer.Serialize(
                new Receipt(id, AccountSecurity.User(h).Id, Hash(json), DateTimeOffset.UtcNow.AddMinutes(30))));
            h.Response.Headers["X-Case-Backup-Token"] = token;
            return Results.File(new FileStream(tempPath,FileMode.Open,FileAccess.Read,FileShare.Read,81920,FileOptions.Asynchronous|FileOptions.SequentialScan), "application/zip", DownloadName(snapshot.Case),enableRangeProcessing:true);
        });
        api.MapDelete("/cases/{id:int}", async (int id, [FromBody] DeleteRequest request, HttpContext h, DatabaseService db, IDataProtectionProvider protection,FileStorage storage) =>
        {
            if (!request.Confirmed || request.Confirmation != "ลบคดี" || string.IsNullOrEmpty(request.BackupToken))
                return Results.BadRequest(new { message = "ต้องดาวน์โหลด ZIP และยืนยันการลบสองขั้นตอนก่อน" });
            Receipt? receipt;
            try { receipt = JsonSerializer.Deserialize<Receipt>(protection.CreateProtector("SmartLaws.CaseArchive.v1").Unprotect(request.BackupToken)); }
            catch (Exception e) when (e is CryptographicException or JsonException) { return Results.BadRequest(new { message = "หลักฐานสำรองข้อมูลไม่ถูกต้อง กรุณาดาวน์โหลด ZIP ใหม่" }); }
            if (receipt == null || receipt.CaseId != id || receipt.UserId != AccountSecurity.User(h).Id || receipt.Expires < DateTimeOffset.UtcNow)
                return Results.BadRequest(new { message = "หลักฐานสำรองข้อมูลหมดอายุหรือไม่ตรงกับคดี กรุณาดาวน์โหลด ZIP ใหม่" });
            using var c = db.CreateConnection(); await c.OpenAsync();
            using var tx = c.BeginTransaction(System.Data.IsolationLevel.Serializable);
            var current = await Read(c, tx, id);
            if (current == null) return Results.NotFound();
            if (Hash(JsonSerializer.Serialize(current, Json)) != receipt.Hash)
                return Results.Conflict(new { message = "ข้อมูลคดีเปลี่ยนหลังสำรอง กรุณาดาวน์โหลด ZIP ใหม่ก่อนลบ" });
            var storageKeys=current.Files.Select(f=>f.StorageKey).Where(k=>!string.IsNullOrEmpty(k)).ToArray();
            await c.ExecuteAsync("SELECT ProspectUserId INTO #caseConsultProspects FROM SL_Consultations WHERE ConvertedCaseId=@id; DELETE FROM SL_Sessions WHERE UserId IN (SELECT UserId FROM SL_ClientCaseLinks WHERE CaseId=@id) AND NOT EXISTS(SELECT 1 FROM SL_ClientCaseLinks a WHERE a.UserId=SL_Sessions.UserId AND a.CaseId<>@id AND a.IsActive=1); DELETE FROM SL_ClientChat WHERE CaseId=@id; DELETE FROM SL_ClientShares WHERE CaseId=@id; DELETE FROM SL_ClientCaseLinks WHERE CaseId=@id; UPDATE SL_Consultations SET ConvertedCaseId=NULL,Status=N'Reviewing',UpdatedAt=SYSUTCDATETIME() WHERE ConvertedCaseId=@id; UPDATE SL_UserAccounts SET Role=N'Prospect' WHERE Id IN(SELECT ProspectUserId FROM #caseConsultProspects) AND Role=N'Client' AND NOT EXISTS(SELECT 1 FROM SL_ClientCaseLinks a WHERE a.UserId=SL_UserAccounts.Id AND a.IsActive=1); UPDATE SL_ClientIdentities SET MustChangePassword=0 WHERE UserId IN(SELECT ProspectUserId FROM #caseConsultProspects); DELETE FROM SL_Appointments WHERE CaseId=@id; DELETE FROM SL_LitigationEvents WHERE CaseId=@id; DELETE FROM SL_CaseFileAttachments WHERE CaseId=@id; DELETE FROM SL_CaseDocuments WHERE CaseId=@id; DELETE FROM SL_CaseParties WHERE CaseId=@id; DELETE FROM SL_LawCases WHERE Id=@id;", new { id }, tx);
            tx.Commit();
            foreach(var key in storageKeys)storage.Delete(key);
            return Results.Ok(new { deleted = true });
        });
        api.MapGet("/cases/{id:int}/hearings", async (int id, DatabaseService db) =>
        {
            using var c = db.CreateConnection();
            return Results.Ok(await c.QueryAsync<CaseAppointment>("SELECT * FROM SL_Appointments WHERE CaseId=@id AND Kind=N'ฟังคำพิพากษา' ORDER BY StartsAt DESC,Id DESC", new { id }));
        });
    }
}
