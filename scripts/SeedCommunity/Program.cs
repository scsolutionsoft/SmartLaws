using System.Text.Json.Nodes;
using Dapper;
using Microsoft.Data.SqlClient;
using SmartLaws.Web.Services;

// Explicitly invoked demo content, never automatically republished at application startup.
var root = Directory.GetCurrentDirectory();
var settings = JsonNode.Parse(await File.ReadAllTextAsync(Path.Combine(root, "appsettings.json")))!;
var connection = Environment.GetEnvironmentVariable("ConnectionStrings__DefaultConnection")
    ?? settings["ConnectionStrings"]!["DefaultConnection"]!.GetValue<string>();
using var db = new SqlConnection(connection);
await db.OpenAsync();
var admin = await db.QueryFirstOrDefaultAsync<int?>("SELECT TOP 1 Id FROM SL_UserAccounts WHERE Role='Admin' AND AccountStatus=N'Active' ORDER BY Id")
    ?? throw new InvalidOperationException("An active administrator is required to own the demo news.");
var samples = new[] {
    new {
        Title = "[ข้อมูลทดสอบ] SmartLaws — จัดการสำนวนและเรียนรู้กระบวนการศาลในที่เดียว",
        Video = "yPgzMFjkBME",
        Body = "ยินดีต้อนรับสู่ SmartLaws พื้นที่ทำงานสำหรับทนายความและทีมงาน\n\nเปิดสำนวน จัดทำแบบพิมพ์ศาล และจัดเก็บเอกสารไว้ในคลังสารบัญของคดีเดียวกัน เพิ่มวันนัดในปฏิทิน แล้วเชื่อมรายงานกระบวนพิจารณา คำร้องขอเลื่อนพิจารณาคดี หรือเอกสารประกอบเข้ากับนัดนั้น เพื่อค้นคืนได้สะดวก\n\nทดลองใช้งาน: เปิดปฏิทิน → เลือกวันนัด → เอกสารประกอบวันนัด → เลือกไฟล์เดิมหรืออัปโหลดไฟล์ใหม่ หากต้องการความช่วยเหลือ สามารถส่งข้อความถึงผู้ดูแลผ่านเมนูกล่องข้อความ\n\nสื่อความรู้ประกอบ: COJ Podcast Special เรื่องการไกล่เกลี่ยก่อนฟ้อง EP.1 โดย COJ Channel วิดีโอนี้เป็นสื่อของศาลยุติธรรม ไม่ใช่วิดีโอสาธิต SmartLaws\nแหล่งที่มาและภาพปกวิดีโอ: https://www.youtube.com/watch?v=yPgzMFjkBME\n\nข่าวตัวอย่างสำหรับทดสอบภาพ วิดีโอ และช่วงเวลาเผยแพร่ ผู้ดูแลสามารถแก้ไขหรือลบได้จากเมนูข่าวประชาสัมพันธ์"
    },
    new {
        Title = "[ข้อมูลทดสอบ] มุมความรู้กฎหมายและศาล — คำถามเรื่องการไกล่เกลี่ยก่อนฟ้อง",
        Video = "Lzw-YYZfxRg",
        Body = "เพิ่มมุมเรียนรู้ให้ทีมงานผ่านกระดานข่าว SmartLaws\n\nรับชม COJ Podcast Special EP.3 รวมคำถามเกี่ยวกับการไกล่เกลี่ยก่อนฟ้อง จาก COJ Channel เพื่อใช้เป็นสื่อความรู้ประกอบการทำงาน\n\nสำหรับการใช้งานโปรแกรม: ใช้ปฏิทินติดตามวันนัด จัดเก็บเอกสารที่เกี่ยวข้องในสำนวน และใช้กล่องข้อความสอบถามผู้ดูแลระบบ โดยการแก้ไขหรือลบข้อมูลคดีจะไม่คืนหรือหักเครดิตเพิ่ม\n\nแหล่งที่มาและภาพปกวิดีโอ: https://www.youtube.com/watch?v=Lzw-YYZfxRg\n\nเนื้อหานี้เป็นข่าวทดสอบระบบประชาสัมพันธ์ ไม่ใช่ประกาศนัดหรือคำสั่งศาลสำหรับคดีใด ผู้ดูแลสามารถเปลี่ยนภาพ ลิงก์วิดีโอ และกำหนดวันเริ่ม–สิ้นสุดได้"
    }
};
using var tx = db.BeginTransaction(System.Data.IsolationLevel.Serializable);
foreach (var item in samples)
{
    var image = "data:image/jpeg;base64," + Convert.ToBase64String(await File.ReadAllBytesAsync(Path.Combine(root, "wwwroot", "images", "news", item.Video + ".jpg")));
    if (!CommunityModule.ValidImage(image)) throw new InvalidOperationException("Invalid demo image.");
    var id = await db.ExecuteScalarAsync<int?>("SELECT Id FROM SL_News WITH(UPDLOCK,HOLDLOCK) WHERE Title=@Title", item, tx);
    if (id is null)
    {
        id = await db.QuerySingleAsync<int>("""
            INSERT INTO SL_News(Title,Body,Image,Youtube,StartsAt,EndsAt,CreatedBy)
            OUTPUT INSERTED.Id
            VALUES(@Title,@Body,@Image,@Video,DATEADD(minute,-5,SYSDATETIMEOFFSET()),DATEADD(day,30,SYSDATETIMEOFFSET()),@Admin)
            """, new {item.Title,item.Body,item.Video,Image=image,Admin=admin}, tx);
        Console.WriteLine($"Added demo news {id}: {item.Title}");
    }
    else Console.WriteLine($"Preserved existing demo news {id}: {item.Title}");
}
tx.Commit();
Console.WriteLine("Demo news ready. Existing articles and credit balances were not changed.");
