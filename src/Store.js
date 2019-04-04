/**
 * class Store
 */

// Libraries
const util = require('util');

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
	 * @param {number} options.transactionTimeout - transaction timeout option (see {@link transaction}, default 0 (no retry)
	 * @param {number} options.transactionWait - transaction wait option (see {@link transaction}, default 10 ms
	 * @param {number} options.lockTimeout - lock timeout option (see {@link lock}, default 0 (no retry)
	 * @param {number} options.lockWait - lock wait option (see {@link lock}, default 10 ms
	 * @param {number} options.shredPassCount - number of times to overwrite data when shredding record parts. Default 3
	 * @param {module} options.fsModule - use this instead of Node.js builtin fs (filesystem) module
	 * @param {module} options.pathModule - use this instead of Node.js buitin path (filepaths) module
	 * @param {function} options.recordClass - use this instead of internal Record class
	 * @param {function} options.collectionClass -  use this instead of internal Collection class
	 * @param {function} options.lockClass - use this instead of internal Lock class
	 * @param {function} options.shredFunction - use this to generate overwrite data when shredding record parts. Default is crypto.randomBytes. Signature: `function(size): Buffer`
	 */
	constructor(options = {}) {
		// Define state vars
		/**
		 * @access private
		 */
		this._options = {
			rootDir: 'store',
			fileMode: 0o660,
			dirMode: 0o770,
			defaultPart: 'r',
			transactionTimeout: 0,
			transactionWait: 10,
			lockTimeout: 0,
			lockWait: 10,
			shredPassCount: 3,
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
		/**
		 * @access private
		 */
		this._fsop = {};

		// Finalize options
		if (typeof options == 'object') {
			for (let k in options) {
				if (this._options[k] !== undefined) {
					this._options[k] = options[k];
				}
			}
		}
		for (let k of ['fileMode', 'dirMode']) {
			if (typeof this._options[k] != 'number') {
				this._options[k] = parseInt(this._options[k], 8);
			}
		}
		for (let k of ['transactionTimeout', 'transactionWait', 'lockTimeout', 'lockWait']) {
			if (typeof this._options[k] != 'number') {
				this._options[k] = parseInt(this._options[k], 10);
			}
		}
		for (let k of ['fsModule', 'pathModule', 'recordClass', 'collectionClass', 'lockClass']) {
			if (typeof this._options[k] != 'object') {
				this._options[k] = require(this._options[k]);
			}
		}
		if (typeof this._options.shredFunction != 'function') {
			this._options.shredFunction = require('crypto').randomBytes;
		}

		// Promisify fs methods
		let fs = this.fs;
		for (let k of ['access', 'close', 'fdatasync', 'fsync', 'ftruncate', 'mkdir', 'open', 'readdir', 'readFile', 'rename', 'rmdir', 'stat', 'unlink', 'write', 'writeFile']) {
			this._fsop[k] = util.promisify(fs[k]);
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
	 * Object with promisified fs operation methods
	 */
	get fsop() {
		return this._fsop;
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
		try {
			await this.fsop.access(dir, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK);
		}
		catch (err) {
			if (err.code != 'ENOENT') {
				throw err;
			}
			if (create) {
				try {
					await this.fsop.mkdir(
						dir,
						{
							recursive: true,
							mode: this.option('dirMode')
						}
					);
				}
				catch (err) {
					if (err.code != 'EEXIST') {
						throw err;
					}
				}
			}
		}
		return dir;
	}

	/**
	 * Perform an operation and retry it if first attempt(s) fail
	 *
	 * @param {function} operation - Signature: `function(resolve: function, reject: function, retry: function, tryCount: number): Promise<void>`
	 * @param {function} onTimeout - On timeout, operation promise is rejected with value returned by this function
	 * @param {number} timeout - max retry time in milliseconds, default is as provided to Lock constructor
	 * @param {number} wait - min time to wait before first retry, default is as provided to Lock constructor
	 */
	async runWithRetry(operation, onTimeout, timeout, wait) {
		function calcRetries(timeout, wait) {
			let retries = [];
			if (timeout > 0) {
				while (timeout >= wait) {
					retries.unshift(timeout);
					timeout = Math.floor(timeout / 3);
				}
				for (let i = 1; i < retries.length; i++) {
					retries[i] -= retries[i - 1];
				}
			}
			return retries;
		}
		return new Promise((resolve, reject) => {
			let retries = calcRetries(timeout, wait);
			let tryCount = 0;
			function retry() {
				if (retries.length == 0) {
					reject(onTimeout());
					return;
				}
				setTimeout(run, retries.shift());
			}
			function run() {
				operation(resolve, reject, retry, tryCount++);
			}
			run();
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
	 * @param {object} options
	 * @param {number} options.timeout - default max retry time in milliseconds
	 * @param {number} options.wait - default min time in ms to wait before first retry
	 * @returns {Lock} locking instance
	 */
	lock(options = {}) {
		options.timeout = parseInt(options.timeout, 10) || this.option('lockTimeout');
		options.wait = parseInt(options.wait, 10) || this.option('lockWait');
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
	 * The delay before the first transaction retry is specified by the `transactionWait` option.
	 * The maximum total transaction retry delay is specified by the `transactionTimeout` option.
	 *
	 * @param {function} callback - perform operations; may be called multiple times, may be halted at any point where a lock is acquired
	 *   Signature: `async function(lockObject: Lock, storeObject: Store, tryCount: number): Promise<*>`
	 * @param {object} options
	 * @param {number} options.transactionTimeout - maximum milliseconds to retry transaction until giving up, default 0 (no retry)
	 * @param {number} options.transactionWait - minimum milliseconds before first transaction retry, default 10 ms.
	 * @param {number} options.lockTimeout - maximum milliseconds to retry each lock until giving up, default 0 (no retry)
	 * @param {number} options.lockWait - minimum milliseconds before first lock retry, default 10 ms
	 * @param {Lock} options.lock - use this Lock instance, do not create or manage a lock for just this transaction. Note: if lock is provided then transaction() will NOT automatically release held locks before resolving
	 * @returns {Promise<*>} On success, resolves with result of callback function's promise. On failure due to lock conflict, rejects with code 'ELOCKED'
	 */
	async transaction(callback, options = {}) {
		options.transactionTimeout = parseInt(options.transactionTimeout, 10) || this.option('transactionTimeout');
		options.transactionWait = parseInt(options.transactionWait, 10) || this.option('transactionWait');
		options.lockTimeout = parseInt(options.lockTimeout, 10) || this.option('lockTimeout');
		options.lockWait = parseInt(options.lockWait, 10) || this.option('lockWait');

		let lock;
		let clearLocks = true;
		if (options.lock) {
			lock = options.lock;
			clearLocks = false;
		}
		else {
			lock = this.lock(
				this,
				{
					timeout: options.lockTimeout,
					wait: options.lockWait
				}
			);
		}

		return this.runWithRetry(
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
			options.transactionTimeout,
			options.transactionWait
		);
	}
};
