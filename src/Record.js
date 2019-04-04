/**
 * class Record
 */

 // Libraries
 const stream = require('stream');

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
	constructor(store, collection, identifier) {
		/**
		 * @access private
		 */
		this._store = store;
		/**
		 * @access private
		 */
		this._col = collection;
		/**
		 * @access private
		 */
		this._id = identifier;
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
	 * Collection instance for this record
	 *
	 * @type {Collection}
	 */
	get collection() {
		return this._col;
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
		if (hash.length < 8) {
			hash = '0'.repeat(8 - hash.length) + hash;
		}
		return hash;
	}

	/**
	 * Get directory path of record
	 *
	 * Directory is created if it doesn't exist.
	 *
	 * @param {bool} create - true to create directory if it does not exist
	 * @returns {Promise<string>} dirpath
	 */
	async dir(create = true) {
		let
			hash = this.generateHash(),
			dirParts = []
		;
		for (let i = 0; i < 8; i += 2) {
			dirParts.push(hash.slice(i, i + 2));
		}
		return this.collection.dir([...dirParts, this.identifier], create);
	}

	/**
	 * Get file path of record part
	 *
	 * @param {?string} part - name of part, or null for default part
	 * @param {bool} createDir - true to create directory if it does not exist
	 * @returns {Promise<string>} filepath
	 */
	async filepath(part = null, createDir = true) {
		return this.store.path.join(
			await this.dir(createDir),
			part || this.store.option('defaultPart')
		);
	}


	// Data operation methods

	/**
	 * Get list of record parts
	 *
	 * @returns {Promise<array>} partnames
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
		let files = [];
		for (let ent of entries) {
			if (ent.isFile()) {
				files.push(ent.name);
			}
		}
		files.sort();
		return files;
	}

	/**
	 * Get file stat data for multiple record parts
	 *
	 * @param {array} parts - part names to remove
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
			dir = await this.dir(),
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
	 * @param {array} parts - part names to remove
	 * @returns {Promise<array>} part names deleted
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
		await this._cleanupDirs();
		results.sort();
		return results;
	}

	/**
	 * Delete multiple record parts and make contents unrecoverable
	 *
	 * Parts that do not exist are ignored (not treated as an error).
	 *
	 * @param {array} parts - part names to shred
	 * @returns {Promise<array>} part names deleted
	 */
	async shredMultipleParts(parts) {
		const
			dir = await this.dir(false),
			path = this.store.path,
			fs  = this.store.fs,
			fsop  = this.store.fsop,
			shred = this.store.option('shredFunction'),
			fileMode = this.store.option('fileMode'),
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
					while (bytesRemaining > 0) {;
						await fsop.write(fd, shred(stat.blksize));
						bytesRemaining -= stat.blksize;
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
		await this._cleanupDirs();
		results.sort();
		return results;
	}


	// Convenience methods

	/**
	 * Return file stat data for part
	 *
	 * @param {?string} part - name of part, or null for default part
	 * @returns {Promise<fs.Stats>} stat results
	 */
	async statPart(part = null) {
		return this._singlePartOperation('statMultipleParts', part, false);
	}

	/**
	 * Read a record part into a buffer
	 *
	 * @param {?string} part - name of part, or null for default part
	 * @returns {Promise<Buffer>} content
	 */
	async readBuffer(part = null) {
		return this._singlePartOperation('readMultipleParts', part, false);
	}

	/**
	 * Write a record part from a buffer
	 *
	 * @param {?string} part - name of part, or null for default part
	 * @param {(Buffer|string)} content - content to write to part
	 * @returns {Promise<void>}
	 */
	async writeBuffer(part, content) {
		return this._singlePartOperation('writeMultipleParts', part, content);
	}

	/**
	 * Get a stream reader for a record part
	 *
	 * @param {?string} part - name of part, or null for default part
	 * @returns {Promise<fs.ReadStream>}
	 */
	async readStream(part = null) {
		return this._singlePartOperation('readMultipleParts', part, true);
	}

	/**
	 * Get a stream writer for a record part
	 *
	 * @param {?string} part - name of part, or null for default part
	 * @returns {Promise<fs.WriteStream>}
	 */
	async writeStream(part = null) {
		return this._singlePartOperation('writeMultipleParts', part, true);
	}

	/**
	 * Delete a record part
	 *
	 * @param {?string} part - name of part, or null for default part
	 * @returns {Promise<bool>} true if part existed and was deleted, false if it did not exist
	 */
	async deletePart(part = null) {
		return this._singlePartOperation('deleteMultipleParts', part, null);
	}

	/**
	 * Delete a record part and make contents unrecoverable
	 *
	 * @param {?string} part - name of part, or null for default part
	 * @returns {Promise<void>}
	 */
	async shredPart(part = null) {
		return this._singlePartOperation('shredMultipleParts', part, null);
	}

	/**
	 * Delete entire record (delete all record parts)
	 *
	 * @returns {Promise<array>} removed part names
	 */
	async deleteAll() {
		return this.deleteMultipleParts(await this.listParts());
	}

	/**
	 * Delete entire record (delete all record parts) and make contents unrecoverable
	 *
	 * @returns {Promise<array>} removed part names
	 */
	async shredAll() {
		return this.shredMultipleParts(await this.listParts());
	}


	// Internal methods

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

	// Remove empty record storage directories
	async _cleanupDirs() {
		const
			fsop  = this.store.fsop,
			path = this.store.path
		;
		let removeDir = await this.dir(false);
		try {
			for (let i = 0; i < 6; i++) {
				await fsop.rmdir(removeDir);
				removeDir = path.dirname(removeDir);
			}
		}
		catch (err) {}
	}
};
