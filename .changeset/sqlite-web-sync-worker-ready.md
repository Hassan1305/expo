---
'expo-sqlite': patch
---

[Web] The SQLite worker now loads its WebAssembly module on the next turn, without opening the database files. A synchronous call throws immediately until that load finishes. After the worker has loaded, a synchronous call waits up to 15 seconds instead of stopping after a fixed number of pauses.
