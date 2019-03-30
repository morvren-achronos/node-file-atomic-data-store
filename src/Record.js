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
						if (err.code == 'ENOENT') {
							resolve([]);
						}
						reject(err);
						return;
					}
					let files = [];
					for (let ent of entries) {
						if (ent.isFile()) {
							files.push(ent.name);
						}
					}
					files.sort();
					resolve(files);
				}
			);
		});
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
			fs  = this.store.fs
		;
		if (!(parts instanceof Array)) {
			parts = Object.keys(parts);
		}
		let promises = [];
		let results = {};
		for (let part of parts) {
			promises.push(new Promise(async (resolve, reject) => {
				fs.stat(
					path.join(dir, part),
					(err, stat) => {
						if (err) {
							reject(err);
							return;
						}
						results[part] = stat;
						resolve();
					}
				);
			}));
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
			fs  = this.store.fs
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
							resolve();
						});
						reader.pipe(parts[part]);
						results[part] = true;
					}
					catch (err) {
						reject(err);
					}
				}));
			}
			else {
				promises.push(new Promise((resolve, reject) => {
					fs.readFile(
						filepath,
						(err, content) => {
							if (err) {
								reject(err);
								return;
							}
							results[part] = content;
							resolve();
						}
					);
				}));
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
			fileMode = this.store.option('fileMode'),
			flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_SYNC
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
				promises.push(new Promise((resolve, reject) => {
					fs.writeFile(
						filepath,
						parts[part],
						{
							flags: flags,
							mode: fileMode
						},
						(err) => {
							if (err) {
								reject(err);
								return;
							}
							results[part] = true;
							resolve();
						}
					);
				}));
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
			fs  = this.store.fs
		;
		if (!(parts instanceof Array)) {
			parts = Object.keys(parts);
		}
		let promises = [];
		let results = [];
		for (let part of parts) {
			promises.push(new Promise(async (resolve, reject) => {
				fs.unlink(
					path.join(dir, part),
					(err) => {
						if (err) {
							if (err.code == 'ENOENT') {
								resolve();
								return;
							}
							reject(err);
							return;
						}
						results.push(part);
						resolve();
					}
				);
			}));
		}
		results.sort();
		promises.push((async () => {
			let removeDir = dir;
			for (let i = 0; i < 6; i++) {
				await new Promise((resolve) => {
					fs.rmdir(removeDir, (err) => {
						if (err) {
							i = 6;
						}
						resolve();
					});
				});
				removeDir = path.dirname(removeDir);
			}
		})());
		await Promise.all(promises);
		return results;
	}

	/**
	 * Delete multiple record parts and make contents unrecoverable
	 *
	 * @param {array} parts - part names to shred
	 * @returns {Promise<void>}
	 */
	async shredMultipleParts(parts) {
		const
			dir = await this.dir(false),
			path = this.store.path,
			fs  = this.store.fs,
			shred = this.store.option('shredFunction'),
			fileMode = this.store.option('fileMode'),
			flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_SYNC
		;
		if (!(parts instanceof Array)) {
			parts = Object.keys(parts);
		}
		let promises = [];
		for (let part of parts) {
			promises.push(new Promise(async (resolve, reject) => {
				let filepath = path.join(dir, part);
				fs.stat(
					filepath,
					(err, stat) => {
						if (err) {
							if (err.code == 'ENOENT') {
								resolve();
								return;
							}
							reject(err);
							return;
						}
						let newfilepath = path.join(dir, part + '.shred.' + Date.now().toString(16) + shred(8).toString('hex'));
						fs.rename(
							filepath,
							newfilepath,
							(err) => {
								let bytesRemaining = stat.size;
								let reader = new stream.Readable({
									autoDestroy: true,
									read(size) {
										let go = true;
										while(go && bytesRemaining) {
											if (bytesRemaining <= size) {
												size = bytesRemaining;
											}
											go = this.push(shred(size));
											bytesRemaining -= size;
										}
										if (bytesRemaining == 0) {
											this.push(null);
										}
									}
								});
								let writer = fs.createWriteStream(
									newfilepath,
									{
										flags: flags,
										mode: fileMode
									}
								);
								writer.on('error', (err) => {
									reject(err);
								});
								writer.on('finish', () => {
									resolve();
								});
								reader.pipe(writer);
							}
						);
					}
				);
			}));
		}
		return Promise.all(promises);
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
};
