// Libraries
const Record = require('./Record').Record;
const mkdirp = require('mkdirp-promise');

// Constants
const RECORDS_DIR = 'records';
const LOCKS_DIR = 'locks';
const DIR_PART_LENGTH = 2;
const GLOBAL_LOCK = '@@--file-atomic-data-store.global-lock@@';

// Module vars
let maxId = 0;

/**
 * Interact with a datastore
 */
module.exports.Store = class Store {
	/**
	 * Create new Store instance
	 *
	 * @param options object
	 *		dirPath string required; data directory for this store (does not need to exist, will be created automatically)
	 *		defaultPartName string name of part to use when no part name supplied, default "r"
	 *		fileMode number file permission mode when creating files, default 0o660
	 *		dirMode number file permission mode when creating directories, default 0o770
	 *		fsModule object use this as filesystem module, default is node builtin fs module
	 *		pathModule object use this as path module, default is node builtin path module
	 */
	constructor(options) {
		this._id = process.pid + ' ' + (maxId++);
		this._rootDir = options.dirpath;
		this._defaultPartName = options.defaultPartName || 'r';
		this._fileMode = options.fileMode || 0o660;
		this._dirMode = options.dirMode || 0o770;
		this._fs = options.fsModule || require('fs');
		this._path = options.pathModule || require('path');

		this._locks = {};
	}
	/**
	 * Read and modify a record with exclusive access
	 *
	 * In nearly all cases, calls to read/write record data should be wrapped in a call to transaction().
	 *
	 * This method works as follows:
	 * 		1) Establish exclusive lock on record (using {lock})
	 *			Reject if lock cannot be established
	 *		2) Execute provided promise
	 *			This promise may read, write and/or delete parts (or all) of the record
	 *			
	 *
	 * @param key string record key
	 * @param handler function code to be executed after lock is established, before lock is released
	 *		Function signature:
	 *			async handler(record) : Promise<object|void>
	 *		Arguments:
	 *			record Record instance to handle loaded record
	 *				see class {Record}
	 *				note the record is automatically lock()ed and unlock()ed, _do not_ call these in handler
	 *		Returns:
	 *			object
	 *				
	 *			Handler must return Promis
	 * @returns Promise<void>
	 */
	async transaction(key, handler) {
		let record = new Record(this, key);
		await record.lock(key);
		try {
			let result = await handler(record);
			if (result != null) {
				await record.update(result);
			}
			await record.unlock(key);
		}
		catch(err) {
			await record.unlock(key);
			throw err;
		}
	}
	async globalTransaction(handler) {
		await this.applyGlobalLock();
		try {
			await handler(record);
			await this.releaseGlobalLock();
		}
		catch(err) {
			await this.releaseGlobalLock();
			throw err;
		}
	}

	/**
	 * TODO
	 *
	 * @returns Promise<void>
	 */
	async traverse(handler) {
		// TODO
	}

	/**
	 * Mark entire store as locked to prevent read/writes
	 *
	 * @returns Promise<void>
	 */
	async applyGlobalLock() {
		return this.applyRecordLock(GLOBAL_LOCK);
	}
	/**
	 * TODO
	 *
	 * @returns Promise<void>
	 */
	async releaseGlobalLock() {
		return this.releaseRecordLock(GLOBAL_LOCK);
	}
	/**
	 * TODO
	 *
	 * @returns Promise<void>
	 */
	async dismissGlobalLock() {
		return this.dismissRecordLock(GLOBAL_LOCK);
	}
	/**
	 * TODO
	 *
	 * @returns Promise<void>
	 */
	async testGlobalLock(checkActivityComplete = false) {
		let lockPath = this._path.resolve(this.getLocksDir(), GLOBAL_LOCK);
		if (!await this._checkFileExists(lockPath)) {
			return false;
		}
		if (!checkActivityComplete) {
			return true;
		}
		let files = await this.listLocks();
		if (files.length > 0) {
			return 0;
		}
		return true;
	}
	async listLocks() {
		return this._listDir(this.getLocksDir());
	}

	/**
	 * Establish exclusive read/write lock on a record
	 *
	 * @param key string record key
	 * @returns Promise<void>
	 */
	async applyRecordLock(key) {
		let globalLock = await this.testGlobalLock();
		if (globalLock) {
			throw new Error('Global lock is set');
		}
		let lockDir = this.getLocksDir();
		await this._prepDir(lockDir);
		let lockPath = this._path.resolve(lockDir, key);
		try {
			await this._writeFile(lockPath, this._id, true);
		}
		catch(err) {
			if (err.code == 'EEXIST') {
				throw new Error('Record is already locked');
			}
			throw err;
		}
	}
	/**
	 * Release exclusive lock on record
	 *
	 * @param key string record key
	 * @returns Promise<void>
	 */
	async releaseRecordLock(key) {
		if (!this._locks[key]) {
			throw new Error('Not locked by this Store');
		}
		return this._deleteFile(this._path.resolve(this.getLocksDir(), key));
	}
	/**
	 * Remove lock on record that is held by another actor
	 *
	 * NOTE: this is intended only to be used to handle dead locks, those established by abnormally terminated Node processes
	 */
	async dismissRecordLock(key) {
		return this._deleteFile(this._path.resolve(this.getLocksDir(), key));
	}
	async testRecordLock(key) {
		//
	}

	async loadRecord(key) {
		//
	}


	/**
	 * Return filename of record part
	 *
	 * @param partName string record part, or null for default part
	 * @returns string filepath
	 */
	getRecordFileName(key, partName = null) {
		return this._key + '-' + (partName ? partName : this._defaultPartName);
	}
	/**
	 * Return dirpath of record part files
	 */
	getRecordDir(key) {
		let
			hash = this.generateRecordHash(key).toString(16),
			pathParts = [this._rootDir, RECORDS_DIR]
		;
		for (let i = 0; i < hash.length - DIR_PART_LENGTH - 1; i += DIR_PART_LENGTH) {
			pathParts.push(hash.slice(i, i + DIR_PART_LENGTH));
		}
		pathParts.push(key);
		return this._path.resolve.apply(pathParts);
	}
	/**
	 * Return 32-bit unsigned integer hash for record key
	 *
	 * Based on npm module string-hash (https://github.com/darkskyapp/string-hash) by The Dark Sky Company, LLC
	 * That code is licensed under CC0-1.0
	 *
	 * @returns number 32-bit unsigned int hash value
	 */
	getRecordHash(key) {
		let
			hash = 5381,
			i = key.length
		;

		while(i) {
			hash = (hash * 33) ^ key.charCodeAt(--i);
		}

		return hash >>> 0;
	}

	getLocksDir() {
		return this._path.resolve(this._rootDir, LOCKS_DIR);
	}

	_prepDir(dirpath) {
		return mkdirp(dirpath, {mode: this._dirMode});
	}
	_listDir(dirpath) {
		return new Promise((resolve, reject) => {
			this._fs.readdir(lockDir, (err, files) => {
			 	if (err) {
				 	reject(err);
				 	return;
			 	}
			 	return files;
			});
		});
	}
	_checkFileExists(filepath) {
		return new Promise((resolve, reject) => {
			this._fs.access(filepath, this._fs.constants.F_OK, (err) => {
				if (err.code === 'ENOENT') {
					resolve(false);
				}
			 	if (err) {
				 	reject(err);
				 	return;
			 	}
			 	resolve(true);
			});
		});
	}
	//_getFile(filepath) {
	//	// TODO
	//}
	_writeFile(filepath, data, mustNotExist) {
		return new Promise((resolve, reject) => {
			let flag = this._fs.constants.O_WRONLY | this._fs.constants.O_CREAT | this._fs.constants.O_SYNC;
			if (mustNotExist) {
				flag |= this._fs.constants.O_EXCL;
			}
			this._fs.writeFile(
				lockPath,
				 this._id,
				 {
				 	mode: this._fileMode,
				 	flag: flag 
				 },
				 (err) => {
				 	if (err) {
					 	reject(err);
					 	return;
				 	}
				 	resolve();
				 }
			);
		});
	}
	_deleteFile(filepath) {
		return new Promise((resolve, reject) => {
			this._fs.unlink(filepath, (err) => {
				if (err.code === 'ENOENT') {
					resolve();
				}
			 	if (err) {
				 	reject(err);
				 	return;
			 	}
			 	resolve();
			});
		});
	}
};

