# Capacity target: 800 accounts / 200 active users

This is a workload target, not an account cap or a guarantee for every server. The application does not restrict membership to 800 accounts. Up to 200 logged-in users can wait briefly for resource-intensive operations; they do not each require a dedicated SQL connection.

Changes:

- Dashboard loads authorized rows in SQL and batches its queries in one round trip. Case lists reuse the authorization scope. Document, file, litigation and report lists are scoped in SQL.
- Dashboard and file lists contain metadata only. PDF/image bodies are fetched from authenticated `/api/files/{id}/content` URLs when opened. Existing base64 records stream through bounded decode buffers without copying the entire file into the response JSON. File POST/status responses also exclude the body.
- Added indexes for case ownership, documents, attachments, account lookups, sessions and clerk assignments. Existing files need no data migration.
- A shared SQL connection pool defaults to max 200/min 5 per application process. Production settings are in `appsettings.Production.json`.
- Concurrent execution limits: ordinary API 96, login/account operations 16, file uploads 8, downloads 24, Word exports 4. Each class has a FIFO queue up to 256. Overflow returns HTTP 429 with Retry-After; aborted requests leave the queue. These are per-process limits, not limits on signed-in users.
- Login permits 600 attempts/minute per IP for office NAT and 10 attempts/minute per normalized account identifier. Password hashing and immediate database-backed session revocation are preserved.

Deployment:

Use Windows Server x64 + IIS + .NET 10 Hosting Bundle. Windows desktop IIS has request restrictions and is not the production capacity target. Use a dedicated x64 application pool, No Managed Code, Load User Profile enabled, one worker process, and HTTPS. Deploy at a site root. Configure the SQL connection and apply the indexes before peak hours. Extra IIS workers multiply connection pools and in-memory limiter budgets; multiple instances also need shared Data Protection keys and a shared rate limiting strategy.

Determine final CPU/RAM/SQL storage requirements by testing the actual server. Pay particular attention to simultaneous password hashing, SQL disk latency, connection-pool waits, database growth from uploaded PDFs and network bandwidth. Do not reduce password hashing strength to improve load results. Avoid recycling during business peaks. Back up the database, which stores PDF contents.

Validation:

Run `dotnet run --project scripts/Capacity/Capacity.csproj` from the repository root against the local app at port 5088. It creates 800 isolated accounts, cases, documents and litigation events, then signs in 200 distinct accounts from the same IP. Ten rounds mix dashboards, metadata, litigation, reports, PDF reads and one upload per active user. Each test PDF is synthetic and 64 KiB. It verifies row isolation, anonymous/cross-account download denial, and byte-exact downloaded content. Decoder boundary tests additionally cover sizes through 10 MiB. Fixture rows are removed in finally. Results are written to `artifacts/capacity-800-200.json`.

The local test uses Kestrel with the load generator on the same Windows 11 Pro machine (4 logical CPUs, approximately 6.7 GiB RAM). It is not an IIS/network benchmark or a long-duration soak test. Before accepting production capacity, rerun on the intended IIS/SQL deployment with realistic case counts, document lengths, 1–10 MB PDFs, a separate load generator, and a sustained business-day workload. Agree acceptable login and dashboard p95 latency as well as an error-rate target; no-error results alone are insufficient.

Local Production-mode result (2026-11-15): 800 accounts, 200 active sessions, peak 200 concurrent requests; 10 rounds / 10,600 requests with zero failures. Workload after login lasted 50.17 seconds. p95: dashboard 2.678 s, files 1.550 s, litigation 0.367 s, report 0.390 s, PDF download 1.502 s, upload 3.029 s. All 200 simultaneous logins were successful but p95 was 23.701 s; login burst latency is a capacity limitation on this host. App peak working set observed after the run was approximately 244 MiB (not total IIS/SQL/load-generator memory). The workload used 64 KiB synthetic files and one case per account, so it does not certify a larger production data set or 200 simultaneous 10 MiB transfers.

Sources:

- [ASP.NET Core concurrency limiting and load testing](https://learn.microsoft.com/aspnet/core/performance/rate-limit?view=aspnetcore-10.0)
- [SQL connection pooling](https://learn.microsoft.com/en-us/Sql/connect/ado-net/sql-server-connection-pooling?view=sql-server-ver16)
- [IIS restrictions on Windows desktop](https://learn.microsoft.com/en-us/iis/troubleshoot/request-restrictions)
