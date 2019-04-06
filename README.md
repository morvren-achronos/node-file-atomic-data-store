# fs-atomic-data-store

key-record store, uses filesystem, allows any data, transactional

## Overview

### Features

* **key-record store**  
  Persistent key-value database.  
  A store is a collection of records, each record has a unique key and one or more values.

* **uses filesystem**    
  Plain files, nothing fancy.  
  No external applications or libraries, pure Node.js javascript.

* **allows any data**  
  A record value can contain anything, no structure is imposed or supplied.  
  For example this is _not_ a JSON database. You can store JSON if you want, or BSON or YAML or an octet-stream.

* **transactional**  
  Supports atomic operations across one or multiple records.  
  You can read-then-write or read-then-delete with assurance that no other actor is operating simultaneously.

### Design goals

* Self-contained. No fancy dependencies, no database engine.
* No assumptions about stored data. Values are binary buffers.
* Streaming.
* No constraints. Throughput and size limitations are provided by the system not the library. Caching is done elsewhere.
* Atomic locks across processes. OK for simultaneous requests to Node.js, multiple Node.js instances, network/shared filesystems, etc.
* POSIX-compliant.

### Why use it?

* If you need a persistent key-value store.
* If your dataset may be large.
* If individual entries may be large in size.
* If you need control over how data is serialized (e.g. not being coerced into JSON when you may sometimes need to store big binary files)
* If you need to guarantee that only one actor is working on a record at a time
* If you don't need (or will provide your own) automatic magic for caching, change observers, object persistence, etc.

### Why build it?

* We needed a simple storage solution.
* We didn't need indexes or foreign keys or anything like that, and we didn't want to rely on an external database system without a compelling reason.
* We need to support both *lots of little records* and *some records being huge binary files*, so storing as e.g. JSON is no good.
* Basically every module we could find was either tinker-toy or had a baked in record format like JSON. (Whereas we wanted BSON or MessagePack mostly, but sometimes just an octet-stream).
* So, we built one. Here it is.

### Environment

* Node v10+ series (uses ES6 syntax)
* Built for Mac and Linux. Any POSIX-compliant system *should* be fine. Windows should be ok in theory although this is completely untested (as of 2019-04).
* Any filesystem is supported.

## Installation

Install via npm:

 npm install --save fs-atomic-data-store

## Usage

```javascript
const fads = require('fs-atomic-data-store');

// Access a store, provide store root directory. Store may or may not exist
let mystore = new fads.Store('./path/to/my/store/dir');

// Access a record by identifier. Record may or may not exist
let myrecord = mystore.record('myrecord');

// Write record from Buffer
myrecord.writeBuffer(Buffer.from('some content!')).then(() => {
	console.log('updated myrecord');
});

// Read record into Buffer
myrecord.readBuffer().then((content) => {
	console.log('myrecord contains: ' + content.toString('utf8'));
});

// Iterate over all records
mystore.traverse('@all', (identifier) => {
	console.log('found record identifier ' + identifier);
});
```
## Notes

### Format

* A store is a set of records stored within a directory on the filesystem.
* Each record has a string identifier.  
  Identifiers should be 7-bit ASCII, suggested max size of 100 bytes.  
  Identifiers should not begin with a dot (`.`) or at-sign (`@`).  
  For non-ASCII or binary identifiers, serialize first, e.g. by converting to hex (`mybufferidentifier.toString('hex')`).
* Each record has one or more content parts.
* Each part has a string name.  
  Part names should be 7-bit ASCII, suggested max size 50 bytes.  
  Part names should not begin with a dot (`.`) or at-sign (`@`).
* Each part has a binary (buffer) value.
* Records may belong to collections.
* Each collection has a string name.  
  Collection names should be 7-bit ASCII, suggested max size of 50 bytes.
  Collection names should not begin with a dot (`.`) or at-sign (`@`).
* All records belong to the special collection "@all".
* Records can belong to zero or more other collections.

### Locking model

The use case this model is designed for is one where simultaneous access is expected to be uncommon, but must be absolutely guaranteed to never happen.

* Locks can be established at record level or "globally" at store level.
* Record locks are guaranteed exclusive and atomic.  
  No one record can be locked by multiple actors at the same time.  
  This includes different actors running within the same Node process, and actors running within other Node processes utilizing the same physical store.
* Store locks are also guaranteed exclusive and atomic.  
  Once a store lock is established, no further locks will be allowed.  
  Existing record locks are not cancelled.  
  To ensure exclusive access, wait until all existing record locks have been unlocked.
* Locks are first-come-first-served, non-blocking, non-queued.  
  If a requested lock is unavailable, fail immediately (default) or retry with escalating delay (up to a specified maximum amount of time).  
  Does not block.  
  Does not keep a lock request queue, so prioritization for highly-contested resources must be handled by the application.

The default included locking system is a wrapper around [proper-lockfile](https://www.npmjs.com/package/proper-lockfile).

### Storage on filesystem

* Each record is a nested subdirectory within `$dataDir/records/`, path based on a hash of the record identifier.
* Each record part is stored in a separate plain file within the record directory.
* Each collection is a subdirectory within `$dataDir/collections`.
* Each record belonging to a collection is an empty nested subdirectory within the collection, path based on a hash of the record identifier.
* Lock data is stored in `$datadir/locks`.

### Backup strategies

* archive tool
	* if
		* write volume is low
		* a point-in-time snapshot is not absolutely required
		* you can live with the small chance of catching a record in the middle of a write
	* then
		* use `fsync` or `tar` or your favourite archiving utility
* store-level lock plus archive tool
	* if
		* you need consistency and don't mind some downtime
	* then
		* establish a store-level lock, wait for other open locks to clear, use `fsync`/`tar`/etc., then remove the store-level lock
* traversal script
	* if
		* downtime is no good
		* even small chance of one corrupted record in archive is no good
		* you don't need a point-in-time snapshot
	* then
		* write a program to traverse the store, for each record lock then copy/add to archive then unlock
* snapshotting filesystem
	* if
		* you need a real point-in-time snapshot
		* and no downtime
		* and no corrupted records in archive from bad reads
		* and a pony
	* then
		* use a snapshotting filesystem
		* and the power of wishes
