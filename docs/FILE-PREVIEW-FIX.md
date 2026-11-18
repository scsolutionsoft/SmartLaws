# File preview and deletion update — 2026-11-18

- The case library deletes through POST `/api/files/{id}/delete`. The original DELETE route remains available. Both routes share the same handler, ownership checks, clerk restriction, origin checks and linked-record confirmation.
- Legacy database PDF data is decoded into a temporary file before sending a response. This enables byte ranges and reports invalid data before response headers are committed.
- Missing storage files return 404; unreadable or invalid files return 422 with a Thai explanation and a request reference. Server logs record the underlying exception against that reference.

## Update an existing IIS installation

Stop the site's application pool and back up the database and configuration. Copy the release application files, including web.config and wwwroot. Preserve the existing database connection, Data Protection keys and **App_Data/Uploads**. The release contains no user uploads. Do not replace the production database connection with the package's example connection string.

Install the x64 ASP.NET Core 10 Hosting Bundle and use a 64-bit application pool. The app pool identity needs access to the configured FileStorage:Directory (default App_Data/Uploads), and writable temporary storage for legacy file previews. web.config removes WebDAV interception; POST deletion also supports servers that restrict DELETE.

Restart the pool and reload the browser. If a document remains unavailable, use the displayed request reference to inspect server logs. Restore missing upload files from the original storage or a backup; application code cannot reconstruct a missing original. The screenshots alone do not establish the production HTTP 500 exception.
