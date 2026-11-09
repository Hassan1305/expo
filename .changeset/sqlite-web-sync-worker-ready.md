---
'expo-sqlite': patch
---

[Web] The SQLite worker now starts on its own, so a later synchronous call can run without awaiting `openDatabaseAsync()` first. A synchronous call in the same turn as the import throws immediately, because the worker is still loading. After the worker has loaded, a synchronous call waits up to 15 seconds instead of stopping after a fixed number of pauses.
