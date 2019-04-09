/**
 * fs-atomic-data-store entrypoint
 */

 // Libraries
 const Store = require('./src/Store');

/**
 * Return a Store instance for interacting with a datastore
 *
 * @param {string} datadir - store root directory
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
 * @param {function} options.lockClass - use this instead of internal Lock class
 * @param {function} options.shredFunction - use this to generate overwrite data when shredding record parts. Default is crypto.randomBytes. Signature: `function(size): Buffer`
 * @returns {Store} datastore instance
 */
module.exports.store = (datadir, options) => {
	options.rootDir = datadir;
	return new Store(options);
};
