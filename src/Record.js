

// Constants
//const MAX_BUFFER_SIZE = 4096; // 4k

/**
 * Interact with a record
 */
module.exports.Record = class Record {
	/**
	 * Get record interaction instance
	 *
	 * Do not instantiate this class directly, use methods from class {Store}
	 *
	 * @param store Store
	 * @param key string
	 */
	constructor(store, key) {
		this._store = store;
		this._key = key;
		this._dir = this.generateDir();
		thi
	}
	/**
	 * Establish exclusive read/write lock on this record
	 *
	 * @returns Promise<void>
	 */
	async lock() {
		return this._store.lockRecord(this._key);
	}
	/**
	 * Release exclusive lock on this record
	 *
	 * @returns Promise<void>
	 */
	async unlock() {
		return this._store.unlockRecord(this._key);
	}


	async listRecordParts(key) {
		//
	}
	async readRecordPart(key, partName = null) {
		//
	}
	async writeRecordPart(key, data, partName = null) {
		//
	}
	async deleteRecordPart(key, partName = null) {
		//
	}
	async createRecordPartReader(key, partName = null) {
		//
	}
	async createRecordPartWriter(key, partName = null) {
		//
	}

	/**
	 * List all parts for record
	 *
	 * @param key string record key
	 * @returns Promise<object>
	 *		parts array names of stored parts
	 */
	async listParts() {
		// TODO
	}
	async readMulti(parts) {
		// TODO
	}
	/**
	 * Read record part directly into buffer
	 *
	 * Use this method only for small data sizes, suggested under 4k.
	 * For larger data parts, use {Record.readStream}
	 *
	 * @param partName string record part, or null for default part
	 * @returns Promise<Buffer> record part contents
	 */
	async readBuffer(partName = null) {
		// TODO
	}
	/**
	 * Get StreamReader instance to read record part
	 *
	 * @param partName string record part, or null for default part
	 * @returns StreamReader
	 */
	readStream(partName = null) {
		// TODO
	}

	/**
	 * Write record part
	 *
	 * @param data
	 * @param partName string record part, or null for default part
	 * @returns Promise<void>
	 */
	async write(data, partName = null) {
		// TODO
	}
	/**
	 * Remove record part
	 *
	 * @param key string record key
	 * @param partName string record part, or null for default part
	 * @returns Promise<void>
	 */
	async delete(key, partName = null) {
		// TODO
	}
	/**
	 * Remove all parts for record
	 *
	 * @param key string record key
	 * @returns Promise<object>
	 *		parts array names of deleted parts
	 */
	async deleteAll() {
		// TODO
	}
	/**
	 * Get StreamWriter instance to write record part
	 *
	 * @param key string record key
	 * @param partName string record part, or null for default part
	 * @returns StreamWriter
	 */
	streamWriter(key, partName = null) {
		// TODO
	}
};
