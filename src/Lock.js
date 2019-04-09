/**
 * class Lock
 */

// Libraries
const lockfile = require('proper-lockfile');

// Constants
/**
 * @access private
 */
const STORE_LOCK = '@store';

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


	// Data operation methods

	/**
	 * Attempt to take an exclusive lock
	 *
	 * If the lock is free, it will be taken by this instance.
	 * If the lock is already held by this instance, calling {lock} again will resolve ok.
	 * If the lock is held by another instance or process, rejects with code "ELOCKED" and lockType "record".
	 * If the store is locked (by this or any other instance), rejects with code "ELOCKED" and lockType "store".
	 *
	 * @param {string} identifier - record identifier, or special token "@store" for store-level lock
	 * @param {object} options
	 * @param {number} options.timeout - max retry time in milliseconds. Default is per options to constructor
	 * @param {number} options.wait - min time in ms to wait before first retry. Default is per options to constructor
	 * @returns {Promise<void>}
	 */
	async lock(identifier, options = {}) {
		const
			path = this.store.path,
			dir = await this.store.dir([this.store.option('locksDir')], true),
			filepath = path.join(dir, identifier)
		;
		options.timeout = parseInt(options.timeout, 10) || this._options.timeout;
		options.wait = parseInt(options.wait, 10) || this._options.wait;

		// Check whether this instance already holds lock
		if (this._locks[identifier]) {
			// Confirm we really still have it
			if (await this._lockOperation('check', filepath)) {
				// We do, resolve now
				return;
			}
			// We don't... this is bad but nothing we can do about it here, unlock will throw if we can't lock it again
		}

		// Check for store-level lock
		if (await this._lockOperation('check', path.join(dir, STORE_LOCK))) {
			// Store is locked
			let err = new Error('Error: ELOCKED: store is locked');
			err.code = 'ELOCKED';
			err.lockType = 'store';
			throw err;
		}

		// Attempt to take lock
		return /* await */ this.store.runWithRetry(
			(resolve, reject, retry) => {
				this._lockOperation('lock', filepath)
					.then((release) => {
						this._locks[identifier] = release;
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
				let err = new Error('Error: ELOCKED: lock is held by another instance');
				err.code = 'ELOCKED';
				err.lockType = 'record';
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
	 * @param {string} identifier - record identifier, or special token "@store" for store-level lock
	 * @returns {Promise<void>}
	 */
	async unlock(identifier) {
		const
			path = this.store.path,
			dir = await this.store.dir([this.store.option('locksDir')], true),
			filepath = path.join(dir, identifier)
		;

		// Check whether this instance holds lock
		if (!this._locks[identifier]) {
			let err = new Error('Error: ENOTACQUIRED: lock is not held by this instance');
			err.code = 'ENOTACQUIRED';
			throw err;
		}

		// Confirm we really still have it
		let err;
		if (await this._lockOperation('check', filepath) == false) {
			// We don't... throw error
			err = new Error('Error: ECOMPROMISED: lock has been removed by another process, possible simultaneous data access');
			err.code = 'ECOMPROMISED';
		}

		// Release lock
		await this._locks[identifier]();
		delete this._locks[identifier];

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
		for (let identifier of Object.keys(this._locks)) {
			// Release lock
			await this._locks[identifier]();
			delete this._locks[identifier];
		}
	}

	/**
	 * List locks currently held by this instance
	 *
	 * @return LockInfo[] held locks
	 */
	list() {
		let locks = Object.keys(this._locks);
		locks.sort();
		return locks;
	}

	/**
	 * List locks currently held by all actors (all processes, all instances)
	 *
	 * @return {Promise<string>} held locks
	 */
	async listGlobal() {
		let locks = await this.store.listDirectoriesInDir(await this.store.dir([this.store.option('locksDir')], false));
		locks.sort();
		return locks;
	}


	// Convenience methods

	/**
	 * Attempt to take a store-level lock (lock the entire store)
	 *
	 * @returns {Promise<void>}
	 */
	async lockStore() {
		return /* await */ this.lock(STORE_LOCK);
	}

	/**
	 * Release held store-level lock
	 */
	async unlockStore() {
		return /* await */ this.unlock(STORE_LOCK);
	}


	// Internal methods

	/**
	 * @access private
	 */
	async _lockOperation(method, filepath) {
		return /* await */ lockfile[method](
			filepath,
			{
				realpath: false,
				lockfilePath: filepath
			}
		);
	}
};
