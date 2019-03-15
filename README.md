# file-atomic-data-store

key-record store, uses filesystem, allows any data, transactional

## Overview

### Features:
* *key-record store*: persistent key-value database. A store is a collection of records, each record has a unique key and one or more values.
* *uses filesystem*: plain files, nothing fancy, no external dependencies or database.
* *allows any data*: a record value can be anything, no structure is imposed. For example this is _not_ a JSON database. You can store JSON if you want, or BSON or YAML or just an octet-stream.
* *transactional*: supports record-level atomic (transactional) operations. You can read-then-write or read-then-delete with assurance that no other actor is operating simultaneously.

### Design goals:
* Self-contained. No fancy dependencies, no database engine.
* No assumptions about stored data. Values are binary buffers.
* Streaming.
* No contraints. Throughput and size limitations are provided by the system not the library. Caching is done elsewhere.
* Atomic across processes. Only one actor accesses data at a time, whether across threads or processes.
* POSIX-compliant.

### Why built it, why use it?

* If you need a flat key-value dataset
* If that dataset may be large
* If individual values may be large
* If you need control over how data is serialized (e.g. not being coerced into JSON when you may sometimes need to store big binary files)
* If you need to guarantee that only one actor is working on a record at a time
* If you don't need (or provide your own) automatic magic for caching, data change observers, in-memory record handling, etc.

### Environment

* Node v8+ series (uses ES6 syntax)
* Built for (and tested on) Linux.
* Any POSIX-compliant system should be fine.
* Any filesystem is supported, although the usual advantages and disadvantages apply (see notes below).
* Windows should be ok in theory [2018-09 kp] although this is completely untested.

## Installation

Install via npm:

 npm install --save file-atomic-data-store

## Usage

```javascript
const filedatastore = require('file-atomic-data-store');

let mystore = new filedatastore.Store('./path/to/my/store/dir');

```

TODO

## Backups

TODO

## Format

* A store is a collection of records stored within a directory on the filesystem.
* Each record has a string key.
Keys should be 7-bit ASCII, suggested max size of 200 bytes.
For non-ASCII or binary keys, serialize first, e.g. by converting to hex (`mybufferkey.toString('hex')`).
* Each record has one or more content parts.
* Each part has a string key (7-bit ASCII, suggested max size 32 bytes).
* Each part has a binary (buffer) value.

## Locking model

The use case this model is designed for is one where simultaneous access is expected to be rare, but must absolutely be guaranteed to never happen.

* Locks can be established at record level, or "globally" at store level.
* Record locks are guaranteed atomic.
No one record can be locked by multiple actors at the same time.
This includes different actors running within the same Node process.
Locks are handled by Store instance: different Store objects in the same process are treated as separate users.
* Global locks are guaranteed atomic, but do not affect already-established record locks.
Once a global lock is established, no further record locks will be allowed.
To ensure exclusive access to enire store, wait until all established record locks have been released.
* Locks are first-come-first-served, non-blocking, non-queued
If a requested lock is unavailable, fail immediately.
Does not block or poll for lock to become available, so retries must be handled by the application.
Does not keep a lock request queue, so prioritization for highly-contested resources must be handled by the application.

## Storage on filesystem

* Records are stored in a subdirectory within `$dataDir/records`.
* Each record part is stored in a separate plain file.
* Record part files are grouped into a subdirectory tree based on a hash of the record key.
* Temporary lock data is stored in `$datadir/locks`.

