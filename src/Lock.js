/**
 * class Lock
 */

/**
 * @typedef {Array<{collection: ?string, identifier: ?string, type: "record"|"collection"|"store", ours: ?bool}>} LockInfo
 */

// Libraries
const lockfile = require('proper-lockfile');

// Constants
/**
 * @access private
 */
const
	STORE_FILENAME = '@@--store@@',
	COLLECTION_FILENAME = '@@--collection@@%s',
	COLLECTION_FILENAME_REGEXP = new RegExp('^' + COLLECTION_FILENAME.replace(/%s/, '(.+)') + '$'),
	RECORD_FILENAME = '%s@@--record@@%s',
	RECORD_FILENAME_REGEXP = new RegExp('^' + RECORD_FILENAME.replace(/%s/g, '(.+)') + '$')
;

/**
 * Lock resources for exclusive access
 *
 * Do not instantiate this class directly, use methods from class {@link Store}
 */
module.exports = class Lock {
	/**
	 * Get locking instance
	 *
	 * @param {Store} store - object
	 * @param {object} options
	 * @param {number} options.timeout - default max retry time in milliseconds
	 * @param {number} options.wait - default min time in ms to wait before first retry
	 */
	constructor(store, options) {
		/**
		 * @access private
		 */
		this._store = store;
		/**
		 * @access private
		 */
		this._options = {
			timeout: parseInt(options.timeout, 10) || 0,
			wait: parseInt(options.wait, 10) || 10
		};
		/**
		 * @access private
		 */
		this._locks = {};
	}


	// Utility methods

	/**
	 * Store instance for this collection
	 *
	 * @type Store
	 */
	get store() {
		return this._store;
	}

	/**
	 * Utility. Get filename for a lock
	 *
	 * For a record lock, pass string collection and identifier.
	 * For a collection-level lock, pass string collection and null for identifier.
	 * For a store-level lock, pass null for both parameters
	 *
	 * @param {?string} collection - collection name
	 * @param {?string} identifier - identifier name
	 * @returns {string} filename
	 */
	filename(collection, identifier) {
		if (collection == null && identifier == null) {
			return STORE_FILENAME;
		}
		if (identifier == null) {
			return COLLECTION_FILENAME.replace(/%s/, collection);
		}
		return RECORD_FILENAME.replace(/%s/, collection).replace(/%s/, identifier);
	}

	/**
	 * Utility. Get lock info from lock filename
	 *
	 * @param {string} filename - lock filename
	 * @return {LockInfo} lock info
	 */
	parseFilename(filename) {
		if (filename == STORE_FILENAME) {
			return {
				collection: null,
				identifier: null,
				type: 'store',
				ours: null
			}
		}
		let m;
		if ((m = COLLECTION_FILENAME_REGEXP.exec(filename))) {
			return {
				collection: m[1],
				identifier: null,
				type: 'collection',
				ours: null
			}
		}
		if ((m = RECORD_FILENAME_REGEXP.exec(filename))) {
			return {
				collection: m[1],
				identifier: m[2],
				type: 'record',
				ours: null
			}
		}
		return null;
	}

	/**
	 * Utility. Get directory path for locks
	 *
	 * Directory is created if it doesn't exist.
	 *
	 * @param {bool} create - true to create directory if it does not exist
	 * @returns {Promise<string>} dirpath
	 */
	async dir(create = true) {
		return this.store.dir([this.store.option('locksDir')], create);
	}


	// Data operation methods

	/**
	 * Attempt to take an exclusive lock
	 *
	 * If the lock is free, it will be taken by this instance.
	 * If the lock is already held by this instance, calling {lock} again will resolve ok.
	 * If the lock is held by another instance or process, rejects with code "ELOCKED" and lockType "record".
	 * If the collection is locked (by this or any other instance), rejects with code "ELOCKED" and lockType "collection".
	 * If the store is locked (by this or any other instance), rejects with code "ELOCKED" and lockType "store".
	 *
	 * @param {?string} collection - collection name, or null for store-level lock
	 * @param {?string} identifier - record identifier, or null for collection-level lock
	 * @param {object} options
	 * @param {number} options.timeout - max retry time in milliseconds. Default is per options to constructor
	 * @param {number} options.wait - min time in ms to wait before first retry. Default is per options to constructor
	 * @returns {Promise<void>}
	 */
	async lock(collection, identifier, options = {}) {
		const
			dir = await this.dir(),
			path = this.store.path,
			filename = this.filename(collection, identifier),
			filepath = path.join(dir, filename)
		;
		options.timeout = parseInt(options.timeout, 10) || this._options.timeout;
		options.wait = parseInt(options.wait, 10) || this._options.wait;

		// Check whether this instance already holds lock
		if (this._locks[filename]) {
			// Confirm we really still have it
			if (await this._lockOperation('check', filepath)) {
				// We do
				return;
			}
			// We don't... this is bad but nothing we can do about it here, unlock will throw
		}

		// Check for store-level lock
		if (await this._lockOperation('check', path.join(dir, this.filename(null, null)))) {
			// Store is locked
			const err = new Error('Error: ELOCKED: store is locked');
			err.code = 'ELOCKED';
			err.lockType = 'store';
			throw err;
		}

		// Check for collection lock
		if (collection && await this._lockOperation('check', path.join(dir, this.filename(collection, null)))) {
			// Store is locked
			const err = new Error('Error: ELOCKED: collection is locked');
			err.code = 'ELOCKED';
			err.lockType = 'collection';
			throw err;
		}

		// Attempt to take lock
		return this.store.runWithRetry(
			(resolve, reject, retry) => {
				this._lockOperation('lock', filepath)
					.then((release) => {
						this._locks[filename] = {
							c: collection,
							i: identifier,
							r: release
						};
						resolve();
					})
					.catch((err) => {
						if (err.code != 'ELOCKED') {
							reject(err);
							return;
						}
						retry();
					})
				;
			},
			() => {
				const err = new Error('Error: ELOCKED: lock is held by another instance');
				err.code = 'ELOCKED';
				err.lockType = 'lock';
				return err;
			},
			options.timeout,
			options.wait
		);
	}

	/**
	 * Release a lock held by this instance
	 *
	 * If lock is not held by this instance, rejects with code "ENOTACQUIRED".
	 * If lock has been compromised, rejects with code "ECOMPROMISED".
	 *
	 * @param {?string} collection - collection name, or null for store-level lock
	 * @param {?string} identifier - record identifier, or null for collection-level lock
	 * @returns {Promise<void>}
	 */
	async unlock(collection, identifier) {
		const
			path = this.store.path,
			filename = this.filename(collection, identifier)
		;

		// Check whether this instance holds lock
		if (!this._locks[filename]) {
			let err = new Error('Error: ENOTACQUIRED: lock is not held by this instance');
			err.code = 'ENOTACQUIRED';
			throw err;
		}

		// Confirm we really still have it
		let err;
		if (await this._lockOperation('check', path.join(await this.dir(), filename)) == false) {
			// We don't... throw error
			err = new Error('Error: ECOMPROMISED: lock has been removed by another process, possible simultaneous data access');
			err.code = 'ECOMPROMISED';
		}

		// Release lock
		await this._locks[filename].r();
		delete this._locks[filename];

		// Throw error if present
		if (err) {
			throw err;
		}
	}

	/**
	 * Release all locks held by this instance
	 *
	 * @returns {Promise<void>}
	 */
	async unlockAll() {
		for (let k of Object.keys(this._locks)) {
			// Release lock
			await this._locks[k].r();
			delete this._locks[k];
		}
	}

	/**
	 * List locks currently held by this instance
	 *
	 * @return LockInfo[] held locks
	 */
	list() {
		let locks = [];
		for (let k in this._locks) {
			locks.push({
				collection: this._locks[k].c,
				identifier: this._locks[k].i,
				type:
					(this._locks[k].c == null)
					? 'store'
					: (
						(this._locks[k].i == null)
						? 'collection'
						: 'record'
					),
				ours: true
			});
		}
		this._sortLockList(locks);
		return locks;
	}

	/**
	 * List locks currently held by all actors (all processes, all instances)
	 *
	 * @return {Promise<LockInfo[]>} held locks
	 */
	async listGlobal() {
		const
			dir = await this.dir(),
			fs = this.store.fs
		;
		return new Promise((resolve, reject) => {
			fs.readdir(
				dir,
				{
					withFileTypes: true
				},
				(err, entries) => {
					if (err) {
						reject(err);
						return;
					}
					let locks = [];
					for (let ent of entries) {
						if (ent.isDirectory()) {
							let lockinfo = this.parseFilename(ent.name)
							lockinfo.ours = (typeof this._locks[ent.name] == 'object');
							locks.push(lockinfo);
						}
					}
					this._sortLockList(locks);
					resolve(locks);
				}
			);
		});
	}


	// Convenience methods

	/**
	 * Attempt to take a collection-level lock (lock an entire collection)
	 *
	 * @param {string} collection - collection name
	 * @returns {Promise<void>}
	 */
	async lockCollection(collection) {
		return this.lock(collection, null);
	}

	/**
	 * Attempt to take a store-level lock (lock the entire store)
	 *
	 * @returns {Promise<void>}
	 */
	async lockStore() {
		return this.lock(null, null);
	}

	/**
	 * Release a held colection-level lock
	 *
	 * @param {string} collection - collection name
	 * @returns {Promise<void>}
	 */
	async unlockCollection(collection) {
		return this.unlock(collection, null);
	}

	/**
	 * Release held store-level lock
	 */
	async unlockStore() {
		return this.unlock(null, null);
	}


	// Internal methods

	/**
	 * @access private
	 */
	_lockOperation(method, filepath) {
		return lockfile[method](
			filepath,
			{
				realpath: false,
				lockfilePath: filepath
			}
		);
	}

	/**
	 * @access private
	 */
	_sortLockList(locks) {
		const typeSortMap = {
			store: 0,
			collection: 1,
			record: 2
		};
		locks.sort((a, b) => {
			let v = typeSortMap[a.type] - typeSortMap[b.type];
			if (v) {
				return v;
			}
			v = a.collection.localeCompare(b.collection);
			if (v) {
				return v;
			}
			return a.identifier.localeCompare(b.identifier);
		});
	}
};
