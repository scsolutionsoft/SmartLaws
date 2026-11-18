using Dapper;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Data.SqlClient;

namespace SmartLaws.Web.Services;

public sealed class FileStorage(IWebHostEnvironment environment, IConfiguration configuration, DatabaseService db)
{
    public const long MaxFileBytes = 1024L * 1024 * 1024;
    public const long MaxRequestBytes = MaxFileBytes + 1024 * 1024;
    const int BufferSize = 81920;

    string Root => configuration["FileStorage:Directory"] is { Length: > 0 } configured
        ? Path.GetFullPath(configured, environment.ContentRootPath)
        : Path.Combine(environment.ContentRootPath, "App_Data", "Uploads");

    public static bool IsUploadRequest(HttpRequest request)
    {
        var path = request.Path.Value ?? "";
        return path.Equals("/api/files", StringComparison.OrdinalIgnoreCase)
            || path.StartsWith("/api/files/", StringComparison.OrdinalIgnoreCase)
                && path.EndsWith("/replace-content", StringComparison.OrdinalIgnoreCase)
            || path.Equals("/api/client-records", StringComparison.OrdinalIgnoreCase)
            || path.Equals("/api/personal-documents", StringComparison.OrdinalIgnoreCase)
            || path.Equals("/api/payments/slips", StringComparison.OrdinalIgnoreCase)
            || path.EndsWith("/messages", StringComparison.OrdinalIgnoreCase)
            || path.Equals("/api/admin/lawyer-archives/preview", StringComparison.OrdinalIgnoreCase)
            || path.StartsWith("/api/admin/lawyer-archives/", StringComparison.OrdinalIgnoreCase)
                && path.EndsWith("/restore", StringComparison.OrdinalIgnoreCase);
    }

    public static void SetRequestLimit(HttpContext context)
    {
        var feature = context.Features.Get<IHttpMaxRequestBodySizeFeature>();
        if (feature is { IsReadOnly: false }) feature.MaxRequestBodySize = MaxRequestBytes;
    }

    public static async Task<IFormCollection> ReadFormAsync(HttpContext context)
    {
        SetRequestLimit(context);
        return await context.Request.ReadFormAsync(context.RequestAborted);
    }

    public async Task<string> SaveAsync(Stream source, long expectedLength, CancellationToken cancellationToken)
    {
        if (expectedLength <= 0 || expectedLength > MaxFileBytes)
            throw new InvalidDataException("ไฟล์ต้องมีขนาดมากกว่า 0 และไม่เกิน 1 GB");

        var key = Guid.NewGuid().ToString("N") + ".bin";
        await SaveWithKeyAsync(source,key,expectedLength,cancellationToken);
        return key;
    }

    public async Task SaveWithKeyAsync(Stream source,string key,long expectedLength,CancellationToken cancellationToken)
    {
        if (expectedLength <= 0 || expectedLength > MaxFileBytes)
            throw new InvalidDataException("ไฟล์ต้องมีขนาดมากกว่า 0 และไม่เกิน 1 GB");
        if (!IsValidKey(key)) throw new InvalidDataException("รหัสไฟล์ไม่ถูกต้อง");
        await using var connection = db.CreateConnection();
        await connection.OpenAsync(cancellationToken);
        using var transaction = connection.BeginTransaction();
        await connection.ExecuteAsync(new CommandDefinition(
            "INSERT INTO SL_FileBlobs(StorageKey,Content,SizeBytes) VALUES(@key,0x,@expectedLength)",
            new { key, expectedLength }, transaction, cancellationToken:cancellationToken));
        {
            var buffer = new byte[1024 * 1024];
            long total = 0;
            int read;
            while ((read = await source.ReadAsync(buffer.AsMemory(), cancellationToken)) > 0)
            {
                total += read;
                if (total > MaxFileBytes) throw new InvalidDataException("ไฟล์ต้องมีขนาดไม่เกิน 1 GB");
                await using var command = connection.CreateCommand();
                command.Transaction = transaction;
                command.CommandTimeout = 120;
                command.CommandText = "UPDATE SL_FileBlobs SET Content.WRITE(@bytes,NULL,0) WHERE StorageKey=@key";
                command.Parameters.Add("@key",System.Data.SqlDbType.NVarChar,40).Value=key;
                command.Parameters.Add("@bytes",System.Data.SqlDbType.VarBinary,-1).Value=buffer.AsSpan(0,read).ToArray();
                await command.ExecuteNonQueryAsync(cancellationToken);
            }
            if (total != expectedLength) throw new InvalidDataException("ขนาดไฟล์ที่รับมาไม่ตรงกัน กรุณาลองใหม่");
            transaction.Commit();
        }
    }

    public async Task<bool> IsValidDocumentAsync(string key, string mimeType, string fileName, CancellationToken cancellationToken)
    {
        var expected = mimeType switch
        {
            "application/pdf" => new byte[] { 0x25, 0x50, 0x44, 0x46, 0x2D },
            "image/png" => new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 },
            "image/jpeg" => new byte[] { 255, 216, 255 },
            _ => Array.Empty<byte>()
        };
        if (expected.Length == 0) return false;
        var extension = Path.GetExtension(fileName);
        if (mimeType == "application/pdf" && !extension.Equals(".pdf", StringComparison.OrdinalIgnoreCase)) return false;
        if (mimeType == "image/png" && !extension.Equals(".png", StringComparison.OrdinalIgnoreCase)) return false;
        if (mimeType == "image/jpeg" && extension is not (".jpg" or ".jpeg") &&
            !extension.Equals(".jpg", StringComparison.OrdinalIgnoreCase) &&
            !extension.Equals(".jpeg", StringComparison.OrdinalIgnoreCase)) return false;

        await using var input = OpenRead(key);
        var header = new byte[expected.Length];
        var count = await input.ReadAsync(header.AsMemory(), cancellationToken);
        if (count != expected.Length || !header.AsSpan().SequenceEqual(expected)) return false;
        if (mimeType == "application/pdf")
        {
            input.Position=0;
            int pages;
            try { using var pdf=UglyToad.PdfPig.PdfDocument.Open(input); pages=pdf.NumberOfPages; }
            catch (Exception error) when (error is not OutOfMemoryException and not OperationCanceledException) { return false; }
            if (pages<1) return false;
            using var connection=db.CreateConnection();
            await connection.ExecuteAsync(new CommandDefinition("UPDATE SL_FileBlobs SET PageCount=@pages WHERE StorageKey=@key",new{pages,key},cancellationToken:cancellationToken));
        }
        return true;
    }

    // SQL is authoritative. The delete-on-close spool provides seek/range support
    // without retaining another permanent copy or allocating a 1 GB byte array.
    public FileStream OpenRead(string key)
    {
        if (!IsValidKey(key)) throw new InvalidDataException("รหัสไฟล์ไม่ถูกต้อง");
        using var connection=db.CreateConnection(); connection.Open();
        using var command=connection.CreateCommand();
        command.CommandTimeout=120;
        command.CommandText="SELECT Content FROM SL_FileBlobs WHERE StorageKey=@key";
        command.Parameters.AddWithValue("@key",key);
        using var reader=command.ExecuteReader(System.Data.CommandBehavior.SequentialAccess);
        if (!reader.Read()) throw new FileNotFoundException("ไม่พบไฟล์ในฐานข้อมูล SQL");
        var output=new FileStream(Path.Combine(Path.GetTempPath(),$"smartlaws-sql-{Guid.NewGuid():N}.tmp"),
            FileMode.CreateNew,FileAccess.ReadWrite,FileShare.Read,BufferSize,FileOptions.Asynchronous|FileOptions.DeleteOnClose);
        try { using var input=reader.GetStream(0); input.CopyTo(output,BufferSize); output.Position=0; return output; }
        catch { output.Dispose(); throw; }
    }

    public async Task<int> PageCountAsync(string key)
    {
        using var connection=db.CreateConnection();
        return await connection.ExecuteScalarAsync<int>("SELECT COALESCE(PageCount,1) FROM SL_FileBlobs WHERE StorageKey=@key",new{key});
    }

    public static bool IsValidKey(string key) =>
        key.Length==36 && Guid.TryParseExact(key[..32],"N",out _) &&
        Path.GetExtension(key).Equals(".bin",StringComparison.OrdinalIgnoreCase);

    public void Delete(string? key)
    {
        if (string.IsNullOrWhiteSpace(key)) return;
        if (!IsValidKey(key)) throw new InvalidDataException("รหัสไฟล์ไม่ถูกต้อง");
        using var connection=db.CreateConnection();
        connection.Execute("DELETE FROM SL_FileBlobs WHERE StorageKey=@key",new{key});
    }

    string GetPath(string key)
    {
        if (!IsValidKey(key))
            throw new InvalidDataException("รหัสไฟล์ไม่ถูกต้อง");
        return Path.Combine(Root, key);
    }

    public static async Task InitializeAsync(DatabaseService db)
    {
        using var connection = db.CreateConnection();
        await connection.ExecuteAsync("""
            IF OBJECT_ID('SL_FileBlobs') IS NULL
                CREATE TABLE SL_FileBlobs(
                    StorageKey nvarchar(40) NOT NULL PRIMARY KEY,
                    Content varbinary(max) NOT NULL,
                    SizeBytes bigint NOT NULL,
                    PageCount int NULL,
                    CreatedAt datetime2 NOT NULL DEFAULT SYSUTCDATETIME());
            IF COL_LENGTH('SL_CaseFileAttachments','StorageKey') IS NULL
                ALTER TABLE SL_CaseFileAttachments ADD StorageKey nvarchar(40) NULL;
            IF COL_LENGTH('SL_PersonalDocuments','StorageKey') IS NULL
                ALTER TABLE SL_PersonalDocuments ADD StorageKey nvarchar(40) NULL;
            IF EXISTS(SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('SL_PersonalDocuments') AND name='Content' AND is_nullable=0)
                ALTER TABLE SL_PersonalDocuments ALTER COLUMN Content varbinary(max) NULL;
            IF COL_LENGTH('SL_PaymentSlips','SlipStorageKey') IS NULL
                ALTER TABLE SL_PaymentSlips ADD SlipStorageKey nvarchar(40) NULL;
            IF COL_LENGTH('SL_PaymentSlips','SlipMimeType') IS NULL
                ALTER TABLE SL_PaymentSlips ADD SlipMimeType nvarchar(100) NULL;
            """);
    }

    public async Task ImportLegacyFilesAsync(ILogger logger)
    {
        using var connection=db.CreateConnection();
        var keys=await connection.QueryAsync<string>("""
            SELECT StorageKey FROM SL_CaseFileAttachments WHERE StorageKey IS NOT NULL AND StorageKey<>''
            UNION SELECT StorageKey FROM SL_PersonalDocuments WHERE StorageKey IS NOT NULL AND StorageKey<>''
            UNION SELECT SlipStorageKey FROM SL_PaymentSlips WHERE SlipStorageKey IS NOT NULL AND SlipStorageKey<>''
            """);
        int imported=0, missing=0;
        foreach(var key in keys)
        {
            if(await connection.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM SL_FileBlobs WHERE StorageKey=@key",new{key})>0)continue;
            if(!IsValidKey(key)||!File.Exists(GetPath(key))){missing++;continue;}
            await using var input=File.OpenRead(GetPath(key));
            await SaveWithKeyAsync(input,key,input.Length,CancellationToken.None);
            imported++;
        }
        // Older releases could retain a physical path in FileUrlOrPath without a
        // StorageKey. Recover those rows in place when the original is still on
        // disk. API/HTTPS links are references, not local files, and are skipped.
        var pathRows=await connection.QueryAsync<(int Id,string? StorageKey,string FileUrlOrPath,string MimeType)>("""
            SELECT Id,StorageKey,FileUrlOrPath,MimeType FROM SL_CaseFileAttachments f
            WHERE ISNULL(FileUrlOrPath,'')<>''
              AND FileUrlOrPath NOT LIKE '/api/%'
              AND FileUrlOrPath NOT LIKE 'http://%'
              AND FileUrlOrPath NOT LIKE 'https://%'
              AND (StorageKey IS NULL OR NOT EXISTS(SELECT 1 FROM SL_FileBlobs b WHERE b.StorageKey=f.StorageKey))
            """);
        int pathImported=0;
        foreach(var row in pathRows)
        {
            string sourcePath;
            try
            {
                sourcePath=Path.IsPathFullyQualified(row.FileUrlOrPath)
                    ? Path.GetFullPath(row.FileUrlOrPath)
                    : Path.GetFullPath(row.FileUrlOrPath,Root);
            }
            catch(Exception error) when(error is ArgumentException or NotSupportedException or PathTooLongException)
            {
                logger.LogWarning("Cannot resolve legacy attachment path for file {FileId}",row.Id);
                continue;
            }
            if(!File.Exists(sourcePath)){missing++;continue;}
            var info=new FileInfo(sourcePath);
            if(info.Length<=0||info.Length>MaxFileBytes){missing++;continue;}
            var mime=row.MimeType is "application/pdf" or "image/png" or "image/jpeg" ? row.MimeType : "";
            if(mime.Length==0){missing++;continue;}
            var key=!string.IsNullOrWhiteSpace(row.StorageKey)&&IsValidKey(row.StorageKey)
                ? row.StorageKey : Guid.NewGuid().ToString("N")+".bin";
            try
            {
                await using var input=File.OpenRead(sourcePath);
                await SaveWithKeyAsync(input,key,input.Length,CancellationToken.None);
                var validationName=mime switch {"application/pdf"=>"legacy.pdf","image/png"=>"legacy.png",_=>"legacy.jpg"};
                if(!await IsValidDocumentAsync(key,mime,validationName,CancellationToken.None))
                {
                    Delete(key);missing++;continue;
                }
                var pages=mime=="application/pdf"?await PageCountAsync(key):1;
                await connection.ExecuteAsync("""
                    UPDATE SL_CaseFileAttachments SET StorageKey=@key,FileUrlOrPath='',FileDataBase64='',
                        StorageType=@storageType,MimeType=@mime,PageCount=@pages WHERE Id=@Id
                    """,new{row.Id,key,mime,pages,storageType=mime=="application/pdf"?"PDF":"IMAGE"});
                pathImported++;
            }
            catch(Exception error) when(error is IOException or UnauthorizedAccessException or InvalidDataException or SqlException)
            {
                try{Delete(key);}catch(Exception cleanupError){logger.LogWarning(cleanupError,"Cannot clean failed legacy import {FileId}",row.Id);}
                logger.LogWarning(error,"Cannot import legacy attachment {FileId} from {SourcePath}",row.Id,sourcePath);
            }
        }
        logger.LogInformation("SQL upload migration: {Imported} storage keys and {PathImported} physical paths imported; {Missing} originals unavailable. Source files preserved.",imported,pathImported,missing);
    }
}
