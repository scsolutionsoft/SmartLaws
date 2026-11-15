using System.Data;
using Dapper;
using SmartLaws.Web.Models;

namespace SmartLaws.Web.Services;

public static class CapacitySupport
{
    // Apply access scope in SQL before materializing rows, not only in the response filter.
    public const string CaseScope = """
        SELECT c.Id FROM SL_LawCases c WHERE
        (@Role='Lawyer' AND c.PrimaryLawyerId=@LawyerProfileId) OR
        (@Role='Clerk' AND c.ClerkId=@LawyerProfileId AND EXISTS
          (SELECT 1 FROM SL_LawyerClerkMappings m JOIN SL_UserAccounts u ON u.Id=m.LawyerUserId
           WHERE m.ClerkUserId=@Id AND m.IsActive=1 AND u.LawyerProfileId=c.PrimaryLawyerId))
        """;
    public const string FileColumns = """
        f.Id,f.CaseId,f.DocumentId,f.DirectoryIndexNo,f.FormCode,f.DirectoryCategoryName,
        f.FileTitle,f.StorageType,f.FileStatus,
        CASE WHEN DATALENGTH(f.FileDataBase64)>0 THEN CONCAT('/api/files/',f.Id,'/content') ELSE f.FileUrlOrPath END AS FileUrlOrPath,
        f.MimeType,f.PageCount,f.UploadedBy,f.Remark,f.CreatedAt,
        f.CourtLevel,f.JudgmentBlackCaseNo,f.JudgmentRedCaseNo,f.JudgmentDate
        """;

    public static async Task InitializeAsync(DatabaseService db)
    {
        using var conn = db.CreateConnection();
        foreach (var (table, name, keys) in new[] {
            ("SL_LawCases", "IX_Capacity_CaseLawyer", "PrimaryLawyerId,Id"),
            ("SL_LawCases", "IX_Capacity_CaseClerk", "ClerkId,Id"),
            ("SL_CaseDocuments", "IX_Capacity_DocumentCase", "CaseId,UpdatedAt"),
            ("SL_CaseFileAttachments", "IX_Capacity_FileCase", "CaseId,DirectoryIndexNo,Id"),
            ("SL_LawyerClerkMappings", "IX_Capacity_MappingClerk", "ClerkUserId,IsActive,LawyerUserId"),
            ("SL_LawyerClerkMappings", "IX_Capacity_MappingLawyer", "LawyerUserId,IsActive"),
            ("SL_Sessions", "IX_Capacity_SessionUser", "UserId,ExpiresAt"),
            ("SL_UserAccounts", "IX_Capacity_Username", "Username"),
            ("SL_UserAccounts", "IX_Capacity_Email", "Email"),
            ("SL_PaymentSlips", "IX_Capacity_SlipUser", "UserId,Id") })
        {
            // Identifiers are constants above; no request values are interpolated.
            await conn.ExecuteAsync($"IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('{table}') AND name='{name}') CREATE INDEX {name} ON {table}({keys});");
        }
    }

    public static async Task<IResult> Dashboard(HttpContext http, DatabaseService db)
    {
        using var conn = db.CreateConnection();
        var user = AccountSecurity.User(http);
        var sql = $"""
            SELECT Id INTO #VisibleCases FROM ({CaseScope}) scoped;
            CREATE UNIQUE CLUSTERED INDEX IX_VisibleCases ON #VisibleCases(Id);
            SELECT * INTO #Mappings FROM SL_LawyerClerkMappings WHERE IsActive=1 AND (LawyerUserId=@Id OR ClerkUserId=@Id);
            SELECT * FROM SL_CaseDocuments WHERE CaseId IN (SELECT Id FROM #VisibleCases) ORDER BY UpdatedAt DESC;
            SELECT * FROM SL_LawyerProfiles WHERE @Role<>'Admin' AND Id=@LawyerProfileId;
            SELECT * FROM SL_CourtFormTemplates ORDER BY Id;
            SELECT * FROM SL_ElectronicSignatures WHERE @Role<>'Admin' AND SignerName=@FullName ORDER BY Id;
            SELECT * FROM SL_UserAccounts WHERE @Role='Admin' OR Id=@Id OR
              Id IN (SELECT LawyerUserId FROM #Mappings) OR Id IN (SELECT ClerkUserId FROM #Mappings) ORDER BY Id;
            SELECT * FROM SL_SubscriptionPlans ORDER BY Id;
            SELECT * FROM SL_PaymentSlips WHERE @Role='Admin' OR UserId=@Id ORDER BY Id DESC;
            SELECT {FileColumns} FROM SL_CaseFileAttachments f WHERE f.CaseId IN (SELECT Id FROM #VisibleCases) ORDER BY f.DirectoryIndexNo,f.Id DESC;
            SELECT * FROM #Mappings ORDER BY LawyerUserId,IsDefaultTypist DESC,Id;
            DROP TABLE #Mappings; DROP TABLE #VisibleCases;
            """;
        using var rows = await conn.QueryMultipleAsync(new CommandDefinition(sql, user, cancellationToken:http.RequestAborted));
        var docs = (await rows.ReadAsync<CaseDocument>()).ToList();
        var lawyers = (await rows.ReadAsync<LawyerProfile>()).ToList();
        var templates = (await rows.ReadAsync<CourtFormTemplate>()).ToList();
        var signatures = (await rows.ReadAsync<ElectronicSignature>()).ToList();
        var users = (await rows.ReadAsync<UserAccount>()).ToList();
        foreach (var account in users) account.PasswordHash = "";
        var plans = (await rows.ReadAsync<SubscriptionPlan>()).ToList();
        var slips = (await rows.ReadAsync<PaymentSlip>()).ToList();
        var files = (await rows.ReadAsync<CaseFileAttachment>()).ToList();
        var mappings = (await rows.ReadAsync<LawyerClerkMapping>()).ToList();
        var cases = (List<LawCase>)http.Items["visibleCases"]!;
        return Results.Ok(new { TotalCases=cases.Count, TotalDocuments=docs.Count, Cases=cases,
            RecentDocuments=docs, Lawyers=lawyers, Templates=templates, Signatures=signatures,
            Users=users, Plans=plans, PaymentSlips=slips, CaseFiles=files, ClerkMappings=mappings });
    }

    public static void MapFiles(RouteGroupBuilder api)
    {
        api.MapGet("/files/{id:int}/content", async (int id, HttpContext http, DatabaseService db) =>
        {
            using var conn = db.CreateConnection();
            var type = await conn.ExecuteScalarAsync<string>(new CommandDefinition(
                "SELECT MimeType FROM SL_CaseFileAttachments WHERE Id=@id AND DATALENGTH(FileDataBase64)>0", new {id}, cancellationToken:http.RequestAborted));
            if (type is not ("application/pdf" or "image/png" or "image/jpeg")) return Results.NotFound();
            // The access filter authorizes the file's case before this result is executed.
            return Results.Stream(async output => {
                await using var connection = db.CreateConnection();
                await connection.OpenAsync(http.RequestAborted);
                await using var command = connection.CreateCommand();
                command.CommandText = "SELECT FileDataBase64 FROM SL_CaseFileAttachments WHERE Id=@id";
                command.Parameters.AddWithValue("@id",id);
                await using var reader = await command.ExecuteReaderAsync(CommandBehavior.SequentialAccess, http.RequestAborted);
                if (await reader.ReadAsync(http.RequestAborted))
                    await DecodeBase64Async(reader.GetTextReader(0),output,http.RequestAborted);
            }, contentType:type);
        });
    }

    // Decode legacy nvarchar base64 with bounded buffers (also supports raw base64).
    public static async Task DecodeBase64Async(TextReader input, Stream output, CancellationToken cancellationToken)
    {
        using (input)
        {
            var chars = new char[8192]; var bytes = new byte[6144];
            int count = 0;
            while (count < 5) { int n=await input.ReadAsync(chars.AsMemory(count,5-count),cancellationToken); if(n==0) break; count+=n; }
            if (new string(chars,0,count)=="data:")
            {
                var header = new char[1]; int length=5;
                while (true) {
                    if (++length>256 || await input.ReadAsync(header.AsMemory(),cancellationToken)==0) throw new InvalidDataException("Invalid file header");
                    if(header[0]==',') break;
                }
                count=0;
            }
            while (true)
            {
                int read = await input.ReadAsync(chars.AsMemory(count,chars.Length-count),cancellationToken);
                count+=read;
                int usable=count-count%4;
                if (usable>0) {
                    if (!Convert.TryFromBase64Chars(chars.AsSpan(0,usable),bytes,out int written)) throw new InvalidDataException("Invalid file encoding");
                    await output.WriteAsync(bytes.AsMemory(0,written),cancellationToken);
                    Array.Copy(chars,usable,chars,0,count-usable); count-=usable;
                }
                if(read==0) { if(count!=0) throw new InvalidDataException("Incomplete file encoding"); break; }
            }
        }
    }
}
