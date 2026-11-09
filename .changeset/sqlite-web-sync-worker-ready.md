---
'expo-sqlite': patch
---

[Web] Synchronous calls now throw immediately when the SQLite worker is still loading, and tell you to await `openDatabaseAsync()` once first. After the worker has loaded, a synchronous call waits up to 15 seconds instead of stopping after a fixed number of pauses.
