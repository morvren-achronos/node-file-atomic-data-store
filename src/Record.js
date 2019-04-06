/**
 * class Record
 */

// Libraries
const stream = require('stream');

// Constants
const
	HASH_SIZE = 8,
	RECORD_DEPTH = 6, // records/01/02/03/04/testrec
	COLLECTION_DEPTH = 7 // collections/colname/
;

/**
 * Interact with a record
 *
 * Do not instantiate this class directly, use methods from class {@link Store}
 */
module.exports = class Record {
	/**
	 * Get record interaction instance
	 *
	 * @param {Store} store - object
	 * @param {Collection} collection - object
	 * @param {string} identifier - record identifier
	 */
	constructor(store, identifier) {
		/**
		 * @access private
		 */
		this._store = store;
		/**
		 * @access private
		 */
		this._id = identifier;
		/**
		 * @access private
		 */
		this._dirParts = null;
	}


	// Utility methods

	/**
	 * Store instance for this record
	 *
	 * @type {Store}
	 */
	get store() {
		return this._store;
	}

	/**
	 * Identifier for this record
	 *
	 * @type {string}
	 */
	get identifier() {
		return this._id;
	}

	/**
	 * Return hex-encoded 32-bit unsigned integer hash of record identifier
	 *
	 * Utility function, normally there is no need to call this directly.
	 *
	 * Based on npm module string-hash (https://github.com/darkskyapp/string-hash) by The Dark Sky Company, LLC
	 * That code is licensed under CC0-1.0
	 *
	 * @return {string} 8-character hex encoding of hash
	 */
	generateHash() {
		let
			hash = 5381,
			id = this.identifier,
			i = id.length
		;
		while(i) {
			hash = (hash * 33) ^ id.charCodeAt(--i);
		}
		hash = (hash >>> 0).toString(16);
		if (hash.length < HASH_SIZE) {
			hash = '0'.repeat(HASH_SIZE - hash.length) + hash;
		}
		return hash;
	}

	/**
	 * Get directory path of record
	 *
	 * Utility function, normally there is no need to call this directly.
	 *
	 * @param {bool} create - true to create directory if it does not exist
	 * @returns {Promise<string>} dirpath
	 */
	async dir(create) {
		return /* await */ this.store.dir(
			[
				this.store.option('recordsDir'),
				...this._getDirParts(),
				this.identifier
			],
			create
		);
	}


	// Data operation methods

	/**
	 * Get list of record parts
	 *
	 * @returns {Promise<array>} part names
	 */
	async listParts() {
		const
			dir = await this.dir(false),
			fsop = this.store.fsop
		;
		let entries;
		try {
			entries = await fsop.readdir(
				dir,
				{
					withFileTypes: true
				},
			);
		}
		catch (err) {
			if (err.code == 'ENOENT') {
				return [];
			}
			throw err;
		}
		let results = [];
		for (let ent of entries) {
			if (ent.isFile() && ent.name.substring(1, 1) != '@') {
				results.push(ent.name);
			}
		}
		results.sort();
		return results;
	}

	/**
	 * Get file stat data for multiple record parts
	 *
	 * @param {array} parts - part names to look up
	 * @returns {Promise<object>} results. Property name is part name. Property value is {fs.Stats}
	 */
	async statMultipleParts(parts) {
		const
			dir = await this.dir(false),
			path = this.store.path,
			fsop  = this.store.fsop
		;
		if (!(parts instanceof Array)) {
			parts = Object.keys(parts);
		}
		let promises = [];
		let results = {};
		for (let part of parts) {
			promises.push(
				fsop.stat(path.join(dir, part))
					.then((stat) => {
						results[part] = stat;
					})
			);
		}
		await Promise.all(promises);
		return results;
	}

	/**
	 * Read multiple record parts
	 *
	 * @param {(array|object} parts - {array} of part names to read, each is returned in Buffer. Or, {object} of part names and handling instructions:
	 * @param {bool false} parts.__partname__ - return content in Buffer
	 * @param {bool true} parts.__partname__ - return ReadStream
	 * @param {stream.Writable} parts.__partname__ - pipe part content to this stream
	 * @returns {Promise<object>} results. Property name is part name. Property value is {Buffer} or {fs.ReadStream} or {bool true}
	 */
	async readMultipleParts(parts) {
		const
			dir = await this.dir(false),
			path = this.store.path,
			fs  = this.store.fs,
			fsop  = this.store.fsop
		;
		if (Array.isArray(parts)) {
			let p = {};
			for (let part of parts) {
				p[part] = false;
			}
			parts = p;
		}
		let promises = [];
		let results = {};
		for (let part in parts) {
			let filepath = path.join(dir, part);
			if (parts[part] === true) {
				results[part] = fs.createReadStream(filepath);
			}
			else if (parts[part] instanceof stream.Writable) {
				promises.push(new Promise((resolve, reject) => {
					try {
						let reader = fs.createReadStream(filepath);
						reader.on('error', (err) => {
							reject(err);
						});
						/* readers have 'end', writers have 'finish' */
						reader.on('end', () => {
							results[part] = true;
							resolve();
						});
						reader.pipe(parts[part]);
					}
					catch (err) {
						reject(err);
					}
				}));
			}
			else {
				promises.push((async () => {
					results[part] = await fsop.readFile(filepath);
				})());
			}
		}
		await Promise.all(promises);
		return results;
	}

	/**
	 * Write multiple record parts
	 *
	 * @param {object} parts - part names and contents to write. Each property is a part to write. Property name is part name. Property value specifies part contents
	 * @param {(Buffer|string)} parts.__partname__ - contents to write
	 * @param {stream.Readable} parts.__partname__ - pipe part contents from this stream
	 * @param {bool true} parts.__partname__ - return {fs.WriteStream}
	 * @returns {Promise<object>} results. Property name is part name. Property value is {bool true} or {fs.WriteStream}
	 */
	async writeMultipleParts(parts) {
		const
			dir = await this.dir(true),
			path = this.store.path,
			fs  = this.store.fs,
			fsop  = this.store.fsop,
			fileMode = this.store.option('fileMode'),
			flags = fs.constants.O_WRONLY | fs.constants.O_TRUNC | fs.constants.O_CREAT
		;
		let promises = [];
		let results = {};
		for (let part in parts) {
			let filepath = path.join(dir, part);
			if (parts[part] === true) {
				results[part] = fs.createWriteStream(
					filepath,
					{
						flags: flags,
						mode: fileMode
					}
				);
			}
			else if (parts[part] instanceof stream.Readable) {
				promises.push(new Promise((resolve, reject) => {
					let writer = fs.createWriteStream(
						filepath,
						{
							flags: flags,
							mode: fileMode
						}
					);
					writer.on('error', (err) => {
						reject(err);
					});
					/* readers have 'end', writers have 'finish' */
					writer.on('finish', () => {
						resolve();
					});
					parts[part].pipe(writer);
					results[part] = true;
				}));
			}
			else {
				promises.push((async () => {
					let fd;
					try {
						fd = await fsop.open(filepath, flags, fileMode);
						await fsop.writeFile(fd, parts[part]);
						await fsop.fdatasync(fd);
						await fsop.close(fd);
					}
					catch (err) {
						if (fd) {
							fs.close(fd);
						}
						throw err;
					}
					results[part] = true;
				})());
			}
		}
		await Promise.all(promises);
		return results;
	}

	/**
	 * Delete multiple record parts
	 *
	 * Parts that do not exist are ignored (not treated as an error).
	 *
	 * @param {array} parts - part names to delete
	 * @returns {Promise<array<string>>} parts deleted
	 */
	async deleteMultipleParts(parts) {
		const
			dir = await this.dir(false),
			path = this.store.path,
			fsop  = this.store.fsop
		;
		if (!(parts instanceof Array)) {
			parts = Object.keys(parts);
		}
		let promises = [];
		let results = [];
		for (let part of parts) {
			promises.push((async () => {
				try {
					await fsop.unlink(path.join(dir, part));
				}
				catch (err) {
					if (err.code == 'ENOENT') {
						return;
					}
					throw err;
				}
				results.push(part);
			})());
		}
		await Promise.all(promises);
		results.sort();
		return results;
	}

	/**
	 * Delete multiple record parts and make contents unrecoverable
	 *
	 * Parts that do not exist are ignored (not treated as an error).
	 *
	 * @param {array} parts - part names to shred
	 * @returns {Promise<array<string>>} parts shredded
	 */
	async shredMultipleParts(parts) {
		const
			dir = await this.dir(false),
			path = this.store.path,
			fs  = this.store.fs,
			fsop  = this.store.fsop,
			shred = this.store.option('shredFunction'),
			flags = fs.constants.O_WRONLY | fs.constants.O_APPEND,
			passCount = this.store.option('shredPassCount')
		;
		if (!(parts instanceof Array)) {
			parts = Object.keys(parts);
		}
		let promises = [];
		let results = [];
		for (let part of parts) {
			promises.push((async () => {
				let filepath = path.join(dir, part);
				let stat;
				try {
					stat = await fsop.stat(filepath);
				}
				catch (err) {
					if (err.code == 'ENOENT') {
						return;
					}
					throw err;
				}
				let newfilepath = path.join(dir, part + '.shred.' + Date.now().toString(16) + shred(8).toString('hex'));
				await fsop.rename(filepath, newfilepath);
				let fd = await fsop.open(newfilepath, flags);
				for (let pass = 0; pass < passCount; pass++) {
					await fsop.ftruncate(fd);
					let bytesRemaining = stat.size;
					while (bytesRemaining >= stat.blksize) {;
						await fsop.write(fd, shred(stat.blksize));
						bytesRemaining -= stat.blksize;
					}
					if (bytesRemaining > 0) {
						await fsop.write(fd, shred(1024 * Math.ceil(bytesRemaining / 1024)));
					}
					await fsop.fdatasync(fd);
				}
				await fsop.ftruncate(fd);
				await fsop.fsync(fd);
				await fsop.close(fd);
				await fsop.unlink(newfilepath);
				results.push(part);
			})());
		}
		await Promise.all(promises);
		results.sort();
		return results;
	}

	/**
	 * Return collections this record is in
	 *
	 * @returns {Promise<array<string>>} collection names
	 */
	async listCollections() {
		const
			fs = this.store.fs,
			fsop = this.store.fsop,
			mode = fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK
		;
		let results = [];
		await this._iterateCollections(
			await this.store.collections(),
			async (collection, dir) => {
				try {
					await fsop.access(dir, mode);
					results.push(collection);
				}
				catch (err) {}
			}
		);
		return results;
	}

	/**
	 * Add record to multiple collections
	 *
	 * @param {array<string>} collections - collection names to add record to
	 * @returns {Promise<array<string>>} collections added
	 */
	async addMultipleCollections(collections) {
		const
			fs = this.store.fs,
			fsop = this.store.fsop,
			dirMode = this.store.option('dirMode'),
			mode = fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK
		;
		if (!(collections instanceof Array)) {
			collections = Object.keys(collections);
		}
		let results = [];
		await this._iterateCollections(
			collections,
			async (collection, dir) => {
				try {
					await fsop.access(dir, mode);
					return;
				}
				catch (err) {}
				try {
					await fsop.mkdir(
						dir,
						{
							recursive: true,
							mode: dirMode
						}
					);
					results.push(collection);
				}
				catch (err) {
					if (err.code != 'EEXIST') {
						throw err;
					}
				}
			}
		);
		results.sort();
		return results;
	}

	/**
	 * Remove record from multiple collections
	 *
	 * Collections that the record does not belong to are ignored (not treated as an error).
	 *
	 * @param {array<string>} collections - collection names to remove record from
	 * @returns {Promise<string>} collections removed
	 */
	async removeMultipleCollections(collections) {
		if (!(collections instanceof Array)) {
			collections = Object.keys(collections);
		}
		let results = [];
console.log('removeMultipleCollections collections=', collections);
		await this._iterateCollections(
			collections,
			async (collection, dir) => {
				if (await this._cleanupDirs(dir, COLLECTION_DEPTH) > 0) {
					results.push(collection);
				}
			}
		);
console.log('removeMultipleCollections results=', results);
		results.sort();
		return results;
	}

	/**
	 * Delete entire record (delete all record parts and remove from all collections)
	 *
	 * @returns {Promise<void>}
	 */
	async deleteRecord() {
		await this.removeAllCollections();
		await this.deleteAllParts();
		await this._cleanupDirs(await this.dir(false), RECORD_DEPTH);
	}


	// Convenience methods

	/**
	 * Return file stat data for part
	 *
	 * @param {?string} part - name of part, or null for default part
	 * @returns {Promise<fs.Stats>} stat results
	 */
	async statPart(part = null) {
		return /* await */ this._singlePartOperation('statMultipleParts', part, false);
	}

	/**
	 * Read a record part into a buffer
	 *
	 * @param {?string} part - name of part, or null for default part
	 * @returns {Promise<Buffer>} content
	 */
	async readBuffer(part = null) {
		return /* await */ this._singlePartOperation('readMultipleParts', part, false);
	}

	/**
	 * Write a record part from a buffer
	 *
	 * @param {?string} part - name of part, or null for default part
	 * @param {(Buffer|string)} content - content to write to part
	 * @returns {Promise<void>}
	 */
	async writeBuffer(part, content) {
		return /* await */ this._singlePartOperation('writeMultipleParts', part, content);
	}

	/**
	 * Get a stream reader for a record part
	 *
	 * @param {?string} part - name of part, or null for default part
	 * @returns {Promise<fs.ReadStream>}
	 */
	async readStream(part = null) {
		return /* await */ this._singlePartOperation('readMultipleParts', part, true);
	}

	/**
	 * Get a stream writer for a record part
	 *
	 * @param {?string} part - name of part, or null for default part
	 * @returns {Promise<fs.WriteStream>}
	 */
	async writeStream(part = null) {
		return /* await */ this._singlePartOperation('writeMultipleParts', part, true);
	}

	/**
	 * Delete a record part
	 *
	 * Parts that do not exist are ignored (not treated as an error).
	 *
	 * @param {?string} part - name of part, or null for default part
	 * @returns {Promise<bool>} true if part existed and was deleted, false if it did not exist
	 */
	async deletePart(part = null) {
		return /* await */ this._singlePartOperation('deleteMultipleParts', part, null);
	}

	/**
	 * Delete all record parts
	 *
	 * @returns {Promise<array<string>>} parts deleted
	 */
	async deleteAllParts() {
		return /* await */ this.deleteMultipleParts(await this.listParts());
	}

	/**
	 * Delete a record part and make contents unrecoverable
	 *
	 * Parts that do not exist are ignored (not treated as an error).
	 *
	 * @param {?string} part - name of part, or null for default part
	 * @returns {Promise<void>} true if part existed and was shredded, false if it did not exist
	 */
	async shredPart(part = null) {
		return /* await */ this._singlePartOperation('shredMultipleParts', part, null);
	}

	/**
	 * Add record to a collection
	 *
	 * @param {string} collection - name of collection
	 * @returns {Promise<bool>} true if record was not in collection and was added, false record was already in collection
	 */
	async addCollection(collection) {
		return /* await */ this._singlePartOperation('addMultipleCollections', collection, null);
	}

	/**
	 * Remove record from a collection
	 *
	 * Collections that the record does not belong to are ignored (not treated as an error).
	 *
	 * @param {string} collection - name of collection
	 * @returns {Promise<bool>} true if record was in collection and was removed, false record was not in collection
	 */
	async removeCollection(collection) {
		return /* await */ this._singlePartOperation('removeMultipleCollections', collection, null);
	}

	/**
	 * Remove record from all collections
	 *
	 * @returns {Promise<string>} collections removed
	 */
	async removeAllCollections() {
		return /* await */ this.removeMultipleCollections(await this.listCollections());
	}

	/**
	 * Set collections for this record
	 *
	 * Add record to/remove record from collections to match provided list.
	 *
	 * @param {array<string>} collections - collection names to add record to (record will be removed from others)
	 * @returns {Promise<void>}
	 */
	async setCollections(collections) {
		let oldCollections = await this.listCollections();
		let add = collections.filter((v) => {
			return !oldCollections.includes(v);
		});
		let rem = oldCollections.filter((v) => {
			return !collections.includes(v);
		});
		if (rem.length) {
			await this.removeMultipleCollections(rem);
		}
		if (add.length) {
			await this.addMultipleCollections(add);
		}
	}


	// Internal methods

	/**
	 * Return array of subdirs based on record hash
	 * @access private
	 */
	_getDirParts() {
		if (!this._dirParts) {
			let hash = this.generateHash();
			this._dirParts = [];
			for (let i = 0; i < HASH_SIZE; i += 2) {
				this._dirParts.push(hash.slice(i, i + 2));
			}
		}
		return this._dirParts;
	}

	/**
	 * Convert convenience single-part operation into multiple-part operation
	 * @access private
	 */
	async _singlePartOperation(method, part, value) {
		part = part || this.store.option('defaultPart');
		let parts = {};
		parts[part] = value;
		parts = await this[method](parts);
		if (Array.isArray(parts)) {
			return parts.length ? true : false;
		}
		if (typeof parts == 'object') {
			return parts[part];
		}
		return null;
	}

	/**
	 * Run callback on provided collections, providing dir
	 * @access private
	 */
	async _iterateCollections(collections, callback) {
		const
			fsop = this.store.fsop,
			path = this.store.path
		;
		let prefixDir = await this.store.dir([this.store.option('collectionsDir')], false);
		let suffixDir = path.join(...this._getDirParts(), this.identifier);
		let promises = [];
		for (let collection of collections) {
			promises.push(callback(collection, path.join(prefixDir, collection, suffixDir)));
		}
		await Promise.all(promises);
	}

	/**
	 * Remove empty record storage directories
	 * @access private
	 */
	async _cleanupDirs(dirpath, depth) {
		const
			fsop  = this.store.fsop,
			path = this.store.path
		;
		let i;
		try {
			for (i = 0; i < depth; i++) {
				await fsop.rmdir(dirpath);
				dirpath = path.dirname(dirpath);
			}
		}
		catch (err) {}
		return i;
	}
};
