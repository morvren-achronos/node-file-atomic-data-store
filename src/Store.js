/**
 * class Store
 */

/**
 * Interact with a datastore
 */
module.exports = class Store {
	/**
	 * Create new Store instance
	 *
	 * @param {object} options
	 * @param {string} options.rootDir - root directory for this store. Default is subdirectory "store" in current working directory
	 * @param {number} options.fileMode - octal file permission mode when creating files. Default 0o660
	 * @param {number} options.dirMode - octal file permission mode when creating directories. Default 0o770
	 * @param {string} options.defaultPart - default part name to use when none is specified. Default "r"
	 * @param {module} options.fsModule - use this instead of Node.js builtin fs (filesystem) module
	 * @param {module} options.pathModule- use this instead of Node.js buitin path (filepaths) module
	 * @param {function} options.recordClass - use this instead of internal Record class
	 * @param {function} options.collectionClass -  use this instead of internal Collection class
	 * @param {function} options.lockClass - use this instead of internal Lock class
	 * @param {function} options.shredFunction - use this to generate overwrite data when shredding record parts. Default is crypto.randomBytes. Signature: `function(size): Buffer`
	 */
	constructor(options = {}) {
		/**
		 * @access private
		 */
		this._options = {
			rootDir: 'store',
			fileMode: 0o660,
			dirMode: 0o770,
			defaultPart: 'r',
			fsModule: 'fs',
			pathModule: 'path',
			recordClass: './Record',
			collectionClass: './Collection',
			lockClass: './Lock',
			shredFunction: null,
			recordsDir: 'records',
			locksDir: 'locks'
		};
		/**
		 * @access private
		 */
		this._collections = {};

		if (typeof options == 'object') {
			for (let k in options) {
				if (this._options[k] !== undefined) {
					this._options[k] = options[k];
				}
			}
		}
		for (let k of ['fsModule', 'pathModule', 'recordClass', 'collectionClass', 'lockClass']) {
			if (typeof this._options[k] == 'string') {
				this._options[k] = require(this._options[k]);
			}
		}
		if (this._options.shredFunction == null) {
			this._options.shredFunction = require('crypto').randomBytes;
		}
	}


	// Utility methods

	/**
	 * Filesystem module
	 *
	 * @type {module}
	 */
	get fs() {
		return this.option('fsModule');
	}

	/**
	 * Filepaths module
	 *
	 * @type {module}
	 */
	get path() {
		return this.option('pathModule');
	}

	/**
	 * Return a configured option
	 *
	 * @param {string} name - option property name
	 * @returns {*} option value
	 */
	option(name) {
		return this._options[name];
	}

	/**
	 * Get directory path within store
	 *
	 * Directory is created if it doesn't exist.
	 *
	 * @param {array} dirParts - dir path components
	 * @param {bool} create - true to create directory if it does not exist
	 * @returns {Promise<s?tring>} dirpath
	 */
	async dir(dirParts = [], create = true) {
		const
			path = this.path,
			fs  = this.fs,
			dir = path.resolve(this.option('rootDir'), ...dirParts)
		;
		return new Promise((resolve, reject) => {
			fs.access(
				dir,
				fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK,
				(err) => {
					if (!err) {
						resolve(dir);
						return;
					}
					if (err.code != 'ENOENT') {
						reject(err);
						return;
					}
					if (!create) {
						resolve(dir);
						return;
					}
					fs.mkdir(
						dir,
						{
							recursive: true,
							mode: this.option('dirMode')
						},
						(err) => {
							if (err && err.code != 'EEXIST') {
								reject(err);
								return;
							}
							resolve(dir);
						}
					);
				}
			);
		});
	}


	// Factory methods

	/**
	 * Return an object to interact with a named collection of records
	 *
	 * @param {string} name - collection name
	 * @returns {Collection} collection object
	 */
	collection(name) {
		name = name.toLowerCase();
		if (!this._collections[name]) {
			this._collections[name] = new (this.option('collectionClass'))(this, name);
		}
		return this._collections[name];
	}

	/**
	 * Return an object to interact with a record
	 *
	 * @param {string} collection - collection name
	 * @param {string} identifier - record identifier
	 * @returns {Record} record object
	 */
	record(collection, identifier) {
		return this.collection(collection).record(identifier);
	}

	/**
	 * Return an object to perform exclusive access locking
	 *
	 * @param {object} options - see Lock class
	 * @returns {Lock} locking instance
	 */
	lock(options = {}) {
		return new (this.option('lockClass'))(this, options);
	}


	// Data operation methods

	/**
	 * Perform a sequence of operations requiring exclusive access
	 *
	 * The operation should request exclusive locks using the provided instance of the Lock class.
	 * If a lock cannot be applied, the entire transaction will fail.
	 * The operation code must structure calls to ensure that it holds all needed locks prior to making any data changes or assumptions about the immutability of loaded records.
	 *
	 * By default, no attempt is made to retry if a lock is not available.
	 * Likewise, no attempt is made to retry the entire transaction if any lock is unavailable.
	 * Both individual locks and the transaction as a whole can be configured to retry automatically after a delay.
	 * The delay before the first transaction retry is specified by the `retryWait` option.
	 * The maximum total transaction retry delay is specified by the `retryTimeout` option.
	 *
	 * @param {function} callback - perform operations; may be called multiple times, may be halted at any point where a lock is acquired
	 *   Signature: `async function(lockObject: Lock, storeObject: Store, tryCount: number): Promise<*>`
	 * @param {object} options
	 * @param {number} options.retryTimeout - maximum milliseconds to retry transaction until giving up, default 0 (no retry)
	 * @param {number} options.retryWait - minimum milliseconds before first transaction retry, default 10 ms.
	 * @param {number} options.lockTimeout - maximum milliseconds to retry each lock until giving up, default 0 (no retry)
	 * @param {number} options.lockWait - minimum milliseconds before first lock retry, default 10 ms
	 * @param {Lock} options.lock - use this Lock instance, do not create or manage a lock for just this transaction. Note: if lock is provided then transaction() will NOT automatically release held locks before resolving
	 * @returns {Promise<*>} On success, resolves with result of callback function's promise. On failure due to lock conflict, rejects with code 'ELOCKED'
	 */
	async transaction(callback, options = {}) {
		options.retryTimeout = parseInt(options.retryTimeout, 10) || 0;
		options.retryWait = parseInt(options.retryWait, 10) || 10;
		options.lockTimeout = parseInt(options.lockTimeout, 10) || 0;
		options.lockWait = parseInt(options.lockWait, 10) || 10;

		let lock;
		let clearLocks = true;
		if (options.lock) {
			lock = options.lock;
			clearLocks = false;
		}
		else {
			lock = this.lock(this, {
				timeout: options.lockTimeout,
				wait: options.lockWait
			});
		}

		return lock.runWithRetry(
			(resolve, reject, retry, tryCount) => {
				callback(lock, this, tryCount)
					.then((result) => {
						clearLocks && lock.unlockAll();
						resolve(result);
					})
					.catch((err) => {
						clearLocks && lock.unlockAll();
						if (err.code != 'ELOCKED') {
							reject(err);
							return;
						}
						retry();
					})
				;
			},
			(originalErr) => {
				const err = new Error('Error: ELOCKED: unable to acquire locks');
				err.code = 'ELOCKED';
				err.lockType = 'transaction';
				err.cause = originalErr;
				return err;
			},
			{
				timeout: options.retryTimeout,
				wait: options.retryWait
			}
		);
	}
};
