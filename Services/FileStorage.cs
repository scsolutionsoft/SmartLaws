using Dapper;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Data.SqlClient;

namespace SmartLaws.Web.Services;

public sealed class FileStorage(IWebHostEnvironment environment, IConfiguration configuration)
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

        Directory.CreateDirectory(Root);
        var key = Guid.NewGuid().ToString("N") + ".bin";
        await SaveWithKeyAsync(source,key,expectedLength,cancellationToken);
        return key;
    }

    public async Task SaveWithKeyAsync(Stream source,string key,long expectedLength,CancellationToken cancellationToken)
    {
        if (expectedLength <= 0 || expectedLength > MaxFileBytes)
            throw new InvalidDataException("ไฟล์ต้องมีขนาดมากกว่า 0 และไม่เกิน 1 GB");
        Directory.CreateDirectory(Root);
        var path=GetPath(key);
        var completed = false;
        try
        {
            await using var target = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None,
                BufferSize, FileOptions.Asynchronous | FileOptions.SequentialScan);
            var buffer = new byte[BufferSize];
            long total = 0;
            int read;
            while ((read = await source.ReadAsync(buffer.AsMemory(), cancellationToken)) > 0)
            {
                total += read;
                if (total > MaxFileBytes) throw new InvalidDataException("ไฟล์ต้องมีขนาดไม่เกิน 1 GB");
                await target.WriteAsync(buffer.AsMemory(0, read), cancellationToken);
            }
            if (total != expectedLength) throw new InvalidDataException("ขนาดไฟล์ที่รับมาไม่ตรงกัน กรุณาลองใหม่");
            completed = true;
        }
        finally
        {
            if (!completed && File.Exists(path)) File.Delete(path);
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
        return count == expected.Length && header.AsSpan().SequenceEqual(expected);
    }

    public FileStream OpenRead(string key) => new(GetPath(key), FileMode.Open, FileAccess.Read, FileShare.Read,
        BufferSize, FileOptions.Asynchronous | FileOptions.SequentialScan);

    public static bool IsValidKey(string key) =>
        Guid.TryParseExact(Path.GetFileNameWithoutExtension(key),"N",out _) &&
        Path.GetExtension(key).Equals(".bin",StringComparison.OrdinalIgnoreCase);

    public void Delete(string? key)
    {
        if (!string.IsNullOrWhiteSpace(key) && File.Exists(GetPath(key))) File.Delete(GetPath(key));
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
}
