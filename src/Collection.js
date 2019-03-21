/**
 * class Collection
 */

/**
 * Interact with a colection of records
 *
 * Do not instantiate this class directly, use methods from class {Store}
 *
 * @access public
 */
module.exports = class Collection {
	/**
	 * Get collection interaction instance
	 *
	 * @access public
	 * @param {Store} store - object
	 * @param {string} collection - collection name
	 */
	constructor(store, collection) {
		/**
		 * @access private
		 */
		this._store = store;
		/**
		 * @access private
		 */
		this._name = collection;
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
	 * Collection name
	 *
	 * @type string
	 */
	get name() {
		return this._name;
	}

	/**
	 * Get directory path within collection
	 *
	 * Directory is created if it doesn't exist.
	 *
	 * @param {array} dirParts - dir path components
	 * @param {bool} create - true to create directory if it does not exist
	 * @returns {Promise<string>} dirpath
	 */
	async dir(dirParts = [], create = true) {
		return this.store.dir([this.store.option('recordsDir'), this.name, ...dirParts], create);
	}


	// Factory methods

	/**
	 * Return an object to interact with a record within this collection
	 *
	 * @param {string} identifier - record identifier
	 * @returns {Record} object
	 */
	record(identifier) {
		return new (this.store.option('recordClass'))(this.store, this, identifier);
	}


	// Data operation methods

	/**
	 * Iterate over all records in collection, calling function for each
	 *
	 * @param {function} callback - called for each record found
	 *   Signature: `function(identiier, recordIndex, collectionObj): {(void|bool}}`
	 *   If callback returns bool false, traversal is halted
	 * @returns {Promise<number>} total records traversed
	 */
	async traverse(callback) {
		const
			rootDir = await this.dir([], false),
			path = this.store.path,
			fs  = this.store.fs
		;
		function getDirectoriesInDir(dir) {
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
						let dirs = [];
						for (let ent of entries) {
							if (ent.isDirectory()) {
								dirs.push(ent.name);
							}
						}
						resolve(dirs);
					}
				);
			});
		}
		let stack = [
			[rootDir, await getDirectoriesInDir(rootDir)]
		];
		let recordCount = 0;
		while (stack.length) {
			let level = stack.length - 1;
			if (!stack[level][1].length) {
				stack.pop();
				continue;
			}
			let dir = path.join(stack[level][0], stack[level][1].pop());
			let subdirs = await getDirectoriesInDir(dir);
			if (!subdirs.length) {
				continue;
			}
			if (level < 3) {
				stack.push([dir, subdirs]);
				continue;
			}
			for (let identifier of subdirs) {
				if (callback(identifier, recordCount++, this) === false) {
					stack = [];
					break;
				}
			}
		}
		return recordCount;
	}
};
