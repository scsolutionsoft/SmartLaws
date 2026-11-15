using System.Threading.RateLimiting;

namespace SmartLaws.Web.Services;

// Independent account limits allow many different users behind one office NAT.
public sealed class LoginAttemptLimiter : IDisposable
{
    private readonly PartitionedRateLimiter<string> limiter = PartitionedRateLimiter.Create<string,string>(
        key => RateLimitPartition.GetFixedWindowLimiter(key, _ => new FixedWindowRateLimiterOptions {
            PermitLimit=10, Window=TimeSpan.FromMinutes(1), QueueLimit=0, AutoReplenishment=true
        }));
    public RateLimitLease Attempt(string username) => limiter.AttemptAcquire(username.Trim().ToUpperInvariant());
    public void Dispose() => limiter.Dispose();
}
