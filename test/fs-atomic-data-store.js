/**
 * fs-atomic-data-store unit tests
 */

/* eslint-env node, mocha */
/* eslint prefer-arrow-callback: 0, func-names: 0, no-sync: 0, no-unused-vars: 0 */


// Libraries
const
	Store = require('../src/Store'),
	Collection = require('../src/Collection'),
	Record = require('../src/Record'),
	Lock = require('../src/Lock'),
	chai = require('chai'),
	chaiAsPromised = require('chai-as-promised'),
	os = require('os'),
	fs = require('fs'),
	path = require('path'),
	rimraf = require('rimraf')
;
const expect = chai.expect;
chai.use(chaiAsPromised);

let
	rootDir,
	store
;
beforeEach(function() {
	rootDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), '/test-node-file-atomic-data-store-')));
});
afterEach(async function() {
	return new Promise((resolve, reject) => {
		rimraf(
			rootDir,
			() => {
				resolve();
			}
		);
	});
});

describe('entrypoint script', function() {
	it('should return the four public classes', function() {
		const index = require('../index');
		expect(index.Store, 'class Store').to.equal(Store);
		expect(index.Collection, 'class Collection').to.equal(Collection);
		expect(index.Record, 'class Record').to.equal(Record);
		expect(index.Lock, 'class Lock').to.equal(Lock);
	});
});

describe('class Store', function() {
	beforeEach(function() {
		store = new Store({
			rootDir: rootDir,
			defaultPart: 'test'
		});
	});
	describe('Utility methods', function() {
		describe('#fs', function() {
			it('should return fileystem module', function() {
				expect(store.fs).to.equal(fs);
			});
		});
		describe('#path', function() {
			it('should return filepath module', function() {
				expect(store.path).to.equal(path);
			});
		});
		describe('#option', function() {
			it('should return an option passed to constructor', function() {
				expect(store.option('defaultPart')).to.equal('test');
			});
		});
		describe('#dir', function() {
			it('should create directory if it does not exist', async function() {
				const relativeDir = ['test', 'creating', 'directories'];
				const expectedDir = path.join(rootDir, ...relativeDir);
				expect(await store.dir(relativeDir)).to.equal(expectedDir);
				expect(function() {
					fs.statSync(expectedDir);
				}).to.not.throw();
			});
			it('should return directory without creating when create=false', async function() {
				const relativeDir = ['test', 'creating', 'directories'];
				const expectedDir = path.join(rootDir, ...relativeDir);
				expect(await store.dir(relativeDir, false)).to.equal(expectedDir);
				expect(function() {
					fs.statSync(expectedDir);
				}).to.throw('ENOENT');
			});
		});
	});
	describe('Factory methods', function() {
		describe('#collection', function() {
			it('should return an instance of Collection', function() {
				expect(store.collection('testcol')).to.be.instanceof(Collection);
			});
		});
		describe('#record', function() {
			it('should return an instance of Record', function() {
				expect(store.record('testcol', 'testrec')).to.be.instanceof(Record);
			});
		});
		describe('#lock', function() {
			it('should return an instance of Lock', function() {
				expect(store.lock()).to.be.instanceof(Lock);
			});
		});
	});
	describe('Data operation methods', function() {
		describe('#transaction', function() {
			it('should execute callback with expected inputs and return results', async function() {
				await expect(
					store.transaction(async () => {
						return 'foo';
					}),
					'return callback result'
				).to.eventually.equal('foo');
				await expect(
					store.transaction(async () => {
						throw new Error('test error');
					}),
					'throw if callback throws'
				).to.be.rejectedWith('test error');
				await store.transaction(async (lock, store, tryCount) => {
					expect(lock, 'lock callback arg').to.be.instanceof(Lock);
					expect(store, 'store callback arg').to.equal(store);
					expect(tryCount, 'tryCount callback arg').to.equal(0);
				});
			});
			it('should retry on lock contention according to configuration', async function() {
				let testTryCount = 0;
				await expect(
					store.transaction(async (lock, store) => {
						testTryCount++;
						let err = new Error('test locked');
						err.code = 'ELOCKED';
						throw err;
					}),
					'default config, throws'
				).to.be.rejectedWith('ELOCKED');
				expect(testTryCount, 'default config, 1 try').to.equal(1);

				testTryCount = 0;
				await expect(
					store.transaction(
						async (lock, store) => {
							testTryCount++;
							let err = new Error('test locked');
							err.code = 'ELOCKED';
							throw err;
						},
						{
							retryTimeout: 0
						}
					),
					'retry 0, throws'
				).to.be.rejectedWith('ELOCKED');
				expect(testTryCount, 'retry 0, 1 try').to.equal(1);

				testTryCount = 0;
				await expect(
					store.transaction(
						async (lock, store) => {
							testTryCount++;
							let err = new Error('test locked');
							err.code = 'ELOCKED';
							throw err;
						},
						{
							retryTimeout: 30,
							retryWait: 10
						}
					),
					'retry 10-30 ms, throws'
				).to.be.rejectedWith('ELOCKED');
				expect(testTryCount, 'retry 10-30 ms, 3 tries').to.equal(3);
				testTryCount = 0;
				await expect(
					store.transaction(
						async (lock, store) => {
							testTryCount++;
							if (testTryCount == 1) {
								throw new Error('test error');
							}
							let err = new Error('test locked');
							err.code = 'ELOCKED';
							throw err;
						},
						{
							retryTimeout: 30,
							retryWait: 10
						}
					),
					'throw during retry'
				).to.be.rejectedWith('test error');
			});
		});
	});
});

describe('class Collection', function() {
	let collection;
	beforeEach(function() {
		store = new Store({
			rootDir: rootDir,
			defaultPart: 'test'
		});
		collection = store.collection('testcol');
	});
	describe('Utility methods', function() {
		describe('#store', function() {
			it('should return Store instance', function() {
				expect(collection.store).to.equal(store);
			});
		});
		describe('#name', function() {
			it('should return collection name', function() {
				expect(collection.name).to.equal('testcol');
			});
		});
		describe('#dir', function() {
			it('should create and return collection root directory', async function() {
				let expectedDir = path.join(rootDir, 'records', 'testcol');
				await expect(collection.dir()).to.eventually.equal(expectedDir);
				expect(function() {
					fs.statSync(expectedDir);
				}).to.not.throw();
			});
			it('should return collection dir without creating when create=false', async function() {
				let expectedDir = path.join(rootDir, 'records', 'testcol');
				await expect(collection.dir([], false)).to.eventually.equal(expectedDir);
				expect(function() {
					fs.statSync(expectedDir);
				}).to.throw('ENOENT');
			});
		});
	});
	describe('Factory methods', function() {
		describe('#record', function() {
			it('should return Record instance', function() {
				expect(collection.record('testrec')).to.be.instanceof(Record);
			});
		});
	});
	describe('Data operation methods', function() {
		describe('#traverse', function() {
			it('should execute callback once for each record in collection', async function() {
				let baseDir = await collection.dir();
				const mkdirs = [
					'a0/b0/c0/d0/testrec_1',
					'a0/b0/c0/d1/testrec_2',
					'a0/b0/c0/d1/testrec_3',
					'a0/b0/c1/d0/testrec_4',
					'a0/b0/c1/d1/testrec_5',
					'a0/b1/c0/d0/testrec_6',
					'a1/b0/c0/d0/testrec_7',
					'a1/b0/c0/d0/testrec_8',
					'a1/b0/c1/d0/testrec_9',
					'a1/b1/c0/d0/testrec_a'
				];
				const expectedIds = [
					'testrec_1',
					'testrec_2',
					'testrec_3',
					'testrec_4',
					'testrec_5',
					'testrec_6',
					'testrec_7',
					'testrec_8',
					'testrec_9',
					'testrec_a'
				];
				for (let dir of mkdirs) {
					fs.mkdirSync(
						path.join(baseDir, dir),
						{
							recursive: true
						}
					);
				}
				let foundIds = [];
				await expect(collection.traverse((identifier) => {
					foundIds.push(identifier);
				})).to.eventually.equal(expectedIds.length);
				foundIds.sort();
				expect(foundIds).to.deep.equal(expectedIds);
			});
			it('should return ok if collection does not exist', async function() {
				// triple-check that dir does not exist
				let dir = await collection.dir([], false);
				expect(function() {
						return fs.statSync(dir);
				}).to.throw('ENOENT');
				await expect(collection.traverse(() => {
					return;
				})).to.eventually.equal(0);
			});
		});
	});
});

describe('class Record', function() {
	let record;
	beforeEach(function() {
		store = new Store({
			rootDir: rootDir,
			defaultPart: 'test'
		});
		record = store.record('testcol', 'testrec');
	});
	describe('Utility methods', function() {
		describe('#store', function() {
			it('should return store instance', function() {
				expect(record.store).to.equal(store);
			});
		});
		describe('#collection', function() {
			it('should return collection instance', function() {
				expect(record.collection).to.be.instanceof(Collection);
			});
		});
		describe('#identifier', function() {
			it('should return record identifier', function() {
				expect(record.identifier).to.equal('testrec');
			});
		});
		describe('#generateHash', function() {
			it('should return hex-encoded 32-bit hash of identifier', function() {
				expect(record.generateHash()).to.match(/^[0-9a-f]{8}$/);
			});
			it('should return different values for different identifiers', function() {
				let identifiers = [
					'record0',
					'record1',
					'record2',
					'record3',
					'record4',
					'record5',
					'record6',
					'record7',
					'record8',
					'record9'
				];
				let hashes = {};
				for (let identifier of identifiers) {
					let temprec = store.record('testcol', identifier);
					let hash = temprec.generateHash();
					expect(hashes).to.not.have.property(hash);
					hashes[hash] = true;
				}
			});
		});
		describe('#dir', function() {
			it('should create and return record directory', async function() {
				let hash = record.generateHash();
				let hashparts = [];
				for (let i = 0; i < 8; i += 2) {
					hashparts.push(hash.slice(i, i + 2));
				}
				let expectedDir = path.join(rootDir, 'records', 'testcol', ...hashparts, 'testrec');
				await expect(record.dir()).to.eventually.equal(expectedDir);
				expect(function() {
					fs.statSync(expectedDir);
				}).to.not.throw();
			});
			it('should return record dir without creating when create=false', async function() {
				let hash = record.generateHash();
				let hashparts = [];
				for (let i = 0; i < 8; i += 2) {
					hashparts.push(hash.slice(i, i + 2));
				}
				let expectedDir = path.join(rootDir, 'records', 'testcol', ...hashparts, 'testrec');
				await expect(record.dir(false)).to.eventually.equal(expectedDir);
				expect(function() {
					fs.statSync(expectedDir);
				}).to.throw('ENOENT');
			});
		});
		describe('#filepath', function() {
			it('should return part filepath and create record dir if needed', async function() {
				let expectedPath = path.join(await record.dir(), 'testpart');
				await expect(record.filepath('testpart')).to.eventually.equal(expectedPath);
				expect(function() {
					fs.statSync(path.dirname(expectedPath));
				}).to.not.throw();
			});
		});
	});
	describe('Data operation methods', function() {
		describe('#listParts', function() {
			it('should return list of record parts', async function() {
				let expectedParts = [
					'test1',
					'test2',
					'test3'
				];
				for (let part of expectedParts) {
					fs.writeFileSync(await record.filepath(part), part.repeat(4));
				}
				let parts = await record.listParts();
				parts.sort();
				expect(parts).to.deep.equal(expectedParts);
			});
			it('should return ok if record does not exist', async function() {
				// triple-check that dir does not exist
				let dir = await record.dir(false);
				expect(function() {
						return fs.statSync(dir);
				}).to.throw('ENOENT');
				await expect(record.listParts()).to.eventually.be.an('array').lengthOf(0);
			});
		});
		describe('#statMultipleParts', function() {
			it('should return file stat data for parts', async function() {
				let parts = [
					'test1',
					'test2',
					'test3'
				];
				for (let part of parts) {
					fs.writeFileSync(await record.filepath(part), part.repeat(4));
				}
				let partStats = await record.statMultipleParts(parts);
				expect(partStats).is.an('object');
				for (let part in partStats) {
					expect(partStats[part]).instanceof(fs.Stats).has.property('size', 20);
				}
			});
			it('should throw if any part does not exist', async function() {
				let parts = [
					'test1',
					'test2',
					'test3'
				];
				for (let part of parts) {
					fs.writeFileSync(await record.filepath(part), part.repeat(4));
				}
				parts.push('test4');
				await expect(record.statMultipleParts(parts)).to.be.rejected;
			});
		});
		describe('#readMultipleParts', function() {
			it('should return parts as Buffers', async function() {
				let parts = [
					'test1',
					'test2',
					'test3'
				];
				for (let part of parts) {
					fs.writeFileSync(await record.filepath(part), part.repeat(4));
				}
				let partContents = await record.readMultipleParts(parts);
				expect(partContents).is.an('object');
				for (let part in partContents) {
					expect(partContents[part])
						.instanceof(Buffer)
						.lengthOf(20)
					;
				}
			});
			it('should throw if any part does not exist', async function() {
				let parts = [
					'test1',
					'test2',
					'test3'
				];
				for (let part of parts) {
					fs.writeFileSync(await record.filepath(part), part.repeat(4));
				}
				parts.push('test4');
				await expect(record.readMultipleParts(parts)).to.be.rejected;
			});
			it('should return ReadStream or write to WriteStream when requested', async function() {
				let tempDir = path.join(rootDir, 'test');
				fs.mkdirSync(
					tempDir,
					{
						recursive: true
					}
				);
				let parts = {
					test1: false,
					test2: true,
					test3: fs.createWriteStream(path.join(tempDir, 'test3'))
				};
				for (let part in parts) {
					fs.writeFileSync(await record.filepath(part), '0123456789abcdef'.repeat(1024));
				}
				let partContents = await record.readMultipleParts(parts);
				expect(partContents).is.an('object');
				for (let part in partContents) {
					if (parts[part] instanceof fs.WriteStream) {
						expect(partContents[part]).to.equal(true);
						expect(fs.readFileSync(path.join(tempDir, part)))
							.instanceof(Buffer)
							.lengthOf(16 * 1024)
						;
					}
					else if (parts[part] === true) {
						expect(partContents[part]).instanceof(fs.ReadStream);
						let tempFile = path.join(tempDir, part);
						await expect(new Promise((resolve, reject) => {
							let writer = fs.createWriteStream(tempFile);
							writer.on('error', (err) => {
								reject(err);
							});
							/* readers have 'end', writers have 'finish' */
							writer.on('finish', () => {
								resolve();
							});
							partContents[part].pipe(writer);
						})).to.be.fulfilled;
						expect(fs.readFileSync(tempFile))
							.instanceof(Buffer)
							.lengthOf(16 * 1024)
						;
					}
					else {
						expect(partContents[part])
							.instanceof(Buffer)
							.lengthOf(16 * 1024)
						;
					}
				}
			});
		});
		describe('#writeMultipleParts', function() {
			it('should write parts from Buffer or string', async function() {
				let parts = {
					test1: Buffer.from('0123456789abcdef'.repeat(1024)),
					test2: Buffer.from('0123456789abcdef'.repeat(1024)),
					test3: '0123456789abcdef'.repeat(1024)
				};
				await record.writeMultipleParts(parts);
				for (let part in parts) {
					expect(fs.readFileSync(await record.filepath(part))).to.be.lengthOf(16 * 1024);
				}
			});
			it('should throw if any part cannot be written', async function() {
				let parts = {
					test1: Buffer.from('0123456789abcdef'.repeat(1024)),
					test2: Buffer.from('0123456789abcdef'.repeat(1024)),
					test3: '0123456789abcdef'.repeat(1024)
				};
				fs.mkdirSync(await record.filepath('test3'));
				await expect(record.writeMultipleParts(parts)).to.be.rejected;
			});
			it('should return WriteStream or read from ReadStream when requested', async function() {
				let tempDir = path.join(rootDir, 'test');
				fs.mkdirSync(
					tempDir,
					{
						recursive: true
					}
				);
				let tempFile = path.join(tempDir, 'test-data');
				fs.writeFileSync(tempFile, Buffer.from('0123456789abcdef'.repeat(1024)));
				let parts = {
					test1: Buffer.from('0123456789abcdef'.repeat(1024)),
					test2: true,
					test3: fs.createReadStream(tempFile)
				};
				let results = await record.writeMultipleParts(parts);
				expect(results.test1).to.equal(true);
				expect(results.test2).to.be.instanceof(fs.WriteStream);
				await expect(new Promise((resolve, reject) => {
					let reader = fs.createReadStream(tempFile);
					reader.on('error', (err) => {
						reject(err);
					});
					reader.on('end', () => {
						resolve();
					});
					reader.pipe(results.test2);
				})).to.be.fulfilled;
				expect(results.test3).to.equal(true);
				for (let part in parts) {
					expect(fs.readFileSync(await record.filepath(part))).to.be.lengthOf(16 * 1024);
				}
			});
		});
		describe('#deleteMultipleParts', function() {
			it('should remove parts', async function() {
				let parts = [
					'test1',
					'test2',
					'test3'
				];
				for (let part of parts) {
					fs.writeFileSync(await record.filepath(part), part);
				}
				await expect(record.deleteMultipleParts(parts)).to.eventually.be.an('array').lengthOf(3);
				for (let part of parts) {
					let path = await record.filepath(part, false);
					expect(function() {
						fs.statSync(path);
					}).to.throw('ENOENT');
				}
			});
			it('should ignore parts that do not exist', async function() {
				let parts = [
					'test1',
					'test2'
				];
				for (let part of parts) {
					fs.writeFileSync(await record.filepath(part), part);
				}
				parts.push('test3');
				await expect(record.deleteMultipleParts(parts)).to.eventually.be.an('array').lengthOf(2);
				for (let part of parts) {
					let path = await record.filepath(part, false);
					expect(function() {
						fs.statSync(path)
					}).to.throw('ENOENT');
				}
			});
			it('should return ok if record does not exist', async function() {
				// triple-check that dir does not exist
				let dir = await record.dir(false);
				expect(function() {
						return fs.statSync(dir);
				}).to.throw('ENOENT');
				let parts = [
					'test1',
					'test2'
				];
				await expect(record.deleteMultipleParts(parts)).to.eventually.be.an('array').lengthOf(0);
			});
			it('should return ok if record directory exists but is empty', async function() {
				let dir = await record.dir(true);
				expect(fs.readdirSync(dir)).to.be.an('array').lengthOf(0);
				let parts = [
					'test1',
					'test2'
				];
				await expect(record.deleteMultipleParts(parts)).to.eventually.be.an('array').lengthOf(0);
			});
			it('should clean up empty directories', async function() {
				let dir = record.dir();
				fs.writeFileSync(await record.filepath('test1'), 'test1');
				await record.deleteMultipleParts(['test1']);
				// base records directory should exist but be empty (no collection, no subdirs)
				expect(fs.readdirSync(path.join(rootDir, 'records'))).to.be.an('array').lengthOf(0);
			});
		});
		describe('#shredMultipleParts', function() {
			it('should overwrite parts and keep same size', async function() {
				let parts = [
					'test1',
					'test2',
					'test3'
				];
				for (let part of parts) {
					let filepath = await record.filepath(part);
					fs.writeFileSync(filepath, Buffer.from('0123456789abcdef'.repeat(1024)));
					fs.linkSync(filepath, filepath + '-copy');
				}
				await expect(record.shredMultipleParts(parts)).to.eventually.deep.equal(parts);
				for (let part of parts) {
					let filepath = await record.filepath(part);
					expect(function() { return fs.statSync(filepath); }).to.throw();
					let buf = fs.readFileSync(filepath + '-copy');
					expect(buf).to.be.instanceof(Buffer).lengthOf(16 * 1024);
					expect(buf.indexOf('0123456789abcdef')).to.equal(-1);
					fs.unlinkSync(filepath + '-copy');
				}
				expect(fs.readdirSync(await record.dir(false))).to.be.an('array').lengthOf(0);
			});
		});
	});
	describe('Convenience methods', function() {
		describe('#statPart', function() {
			it('should return file stat data for part', async function() {
				fs.writeFileSync(await record.filepath('test1'), 'test1');
				await expect(record.statPart('test1')).to.eventually.be.instanceof(fs.Stats);
			});
			it('should throw if part does not exist', async function() {
				await expect(record.statPart('test1')).to.be.rejected;
			});
		});
		describe('#readBuffer', function() {
			it('should return single part in Buffer', async function() {
				fs.writeFileSync(await record.filepath('test1'), 'test1');
				await expect(record.readBuffer('test1')).to.eventually.be.instanceof(Buffer).lengthOf(5).deep.equal(Buffer.from('test1'));
			});
			it('should throw if part does not exist', async function() {
				await expect(record.readBuffer('test1')).to.be.rejected;
			});
		});
		describe('#writeBuffer', function() {
			it('should write single part from Buffer', async function() {
				await expect(record.writeBuffer('test1', 'test1')).to.eventually.be.fulfilled;
			});
		});
		describe('#readStream', function() {
			it('should return a working ReadStream for part', async function() {
				let tempDir = path.join(rootDir, 'test');
				fs.mkdirSync(
					tempDir,
					{
						recursive: true
					}
				);
				let tempFile = path.join(tempDir, 'test-data');
				fs.writeFileSync(await record.filepath('test1'), Buffer.from('0123456789abcdef'.repeat(1024)));
				let reader = await record.readStream('test1');
				expect(reader).is.instanceof(fs.ReadStream);
				await expect(new Promise((resolve, reject) => {
					let writer = fs.createWriteStream(tempFile);
					writer.on('error', (err) => {
						reject(err);
					});
					writer.on('finish', () => {
						resolve();
					});
					reader.pipe(writer);
				})).to.be.fulfilled;
				expect(fs.readFileSync(tempFile)).to.be.instanceof(Buffer).lengthOf(16 * 1024);
			});
		});
		describe('#writeStream', function() {
			it('should return a working WriteStream for part', async function() {
				let tempDir = path.join(rootDir, 'test');
				fs.mkdirSync(
					tempDir,
					{
						recursive: true
					}
				);
				let tempFile = path.join(tempDir, 'test-data');
				fs.writeFileSync(tempFile, Buffer.from('0123456789abcdef'.repeat(1024)));
				let writer = await record.writeStream('test1');
				expect(writer).is.instanceof(fs.WriteStream);
				await expect(new Promise((resolve, reject) => {
					let reader = fs.createReadStream(tempFile);
					reader.on('error', (err) => {
						reject(err);
					});
					reader.on('end', () => {
						resolve();
					});
					reader.pipe(writer);
				})).to.be.fulfilled;
				await expect(fs.readFileSync(await record.filepath('test1'))).to.be.instanceof(Buffer).lengthOf(16 * 1024);
			});
		});
		describe('#deletePart', function() {
			it('should remove single part', async function() {
				fs.writeFileSync(await record.filepath('test1'), 'test1');
				await expect(record.deletePart('test1')).to.eventually.equal(true);
			});
			it('should return false if part does not exist', async function() {
				await expect(record.deletePart('test1')).to.eventually.equal(false);
			});
		});
		describe('#deleteAll', function() {
			it('should remove entire record', async function() {
				let parts = [
					'test1',
					'test2',
					'test3'
				];
				for (let part of parts) {
					fs.writeFileSync(await record.filepath(part), Buffer.from('0123456789abcdef'.repeat(1024)));
				}
				await expect(record.deleteAll()).to.eventually.deep.equal(parts);
			});
		});
		describe('#shredPart', function() {
			it('should overwrite single part', async function() {
				const filepath = await record.filepath('test1');
				fs.writeFileSync(filepath, Buffer.from('0123456789abcdef'.repeat(1024)));
				await expect(record.shredPart('test1')).to.eventually.be.fulfilled;
				expect(function() { return fs.statSync(filepath); }).to.throw();
			});
		});
	});
});

describe('class Lock', function() {
	let lock;
	beforeEach(function() {
		store = new Store({
			rootDir: rootDir,
			defaultPart: 'test'
		});
		lock = store.lock();
	});
	afterEach(async function() {
		let dir = await lock.dir();
		return new Promise((resolve) => {
			rimraf(dir, () => {
				resolve();
			});
		});
	});
	describe('Utility methods', function() {
		describe('#store', function() {
			it('should return store instance', function() {
				expect(lock.store).to.equal(store);
			});
		});
		describe('#filename', function() {
			it('should return filename for all lock types', function() {
				expect(lock.filename('testcol', 'testrec')).to.equal('testcol@@--record@@testrec');
				expect(lock.filename('testcol', null)).to.equal('@@--collection@@testcol');
				expect(lock.filename(null, null)).to.equal('@@--store@@');
			});
		});
		describe('#parseFilename', function() {
			it('should return lock info for all lock types', function() {
				expect(lock.parseFilename('testcol@@--record@@testrec')).to.deep.equal({
					collection: 'testcol',
					identifier: 'testrec',
					type: 'record',
					ours: null
				});
				expect(lock.parseFilename('@@--collection@@testcol')).to.deep.equal({
					collection: 'testcol',
					identifier: null,
					type: 'collection',
					ours: null
				});
				expect(lock.parseFilename('@@--store@@')).to.deep.equal({
					collection: null,
					identifier: null,
					type: 'store',
					ours: null
				});
			});
		});
		describe('#calcRetries', function() {
			it('should calculate delay times according to provided timeout and wait');
		});
		describe('#runWithRetry', function() {
			it('should retry according to provided timeout and wait');
		});
		describe('#dir', function() {
			it('should create and return lock directory', async function() {
				let expectedDir = path.join(rootDir, 'locks');
				await expect(lock.dir()).to.eventually.equal(expectedDir);
				expect(function() {
					fs.statSync(expectedDir);
				}).to.not.throw();
			});
			it('should return record dir without creating when create=false', async function() {
				let expectedDir = path.join(rootDir, 'locks');
				await expect(lock.dir(false)).to.eventually.equal(expectedDir);
				expect(function() {
					fs.statSync(expectedDir);
				}).to.throw('ENOENT');
			});
		});
	});
	describe('Data operation methods', function() {
		describe('#lock', function() {
			it('should take lock if available', async function() {
				await expect(lock.lock('testcol', 'testrec')).to.eventually.be.fulfilled;
				expect(fs.statSync(path.join(await lock.dir(), 'testcol@@--record@@testrec'))).to.be.instanceof(fs.Stats);
				await expect(lock.lock('testcol', null)).to.eventually.be.fulfilled;
				expect(fs.statSync(path.join(await lock.dir(), '@@--collection@@testcol'))).to.be.instanceof(fs.Stats);
				await expect(lock.lock(null, null)).to.eventually.be.fulfilled;
				expect(fs.statSync(path.join(await lock.dir(), '@@--store@@'))).to.be.instanceof(fs.Stats);
			});
			it('should return ok if lock already held by same instance', async function() {
				await expect(lock.lock('testcol', 'testrec')).to.eventually.be.fulfilled;
				await expect(lock.lock('testcol', 'testrec')).to.eventually.be.fulfilled;
				await expect(lock.lock('testcol', null)).to.eventually.be.fulfilled;
				await expect(lock.lock('testcol', null)).to.eventually.be.fulfilled;
				await expect(lock.lock(null, null)).to.eventually.be.fulfilled;
				await expect(lock.lock(null, null)).to.eventually.be.fulfilled;
			});
			it('should fail if lock already held by other instance', async function() {
				let lock2 = store.lock();
				await expect(lock.lock('testcol', 'testrec')).to.eventually.be.fulfilled;
				await expect(lock2.lock('testcol', 'testrec')).to.be.rejectedWith('ELOCKED');
			});
			it('should fail on record or collection lock if collection locked', async function() {
				let lock2 = store.lock();
				await expect(lock.lock('testcol', null)).to.eventually.be.fulfilled;
				await expect(lock.lock('testcol', 'testrec')).to.be.rejectedWith('ELOCKED');
				await expect(lock2.lock('testcol', 'testrec')).to.be.rejectedWith('ELOCKED');
				await expect(lock2.lock('testcol', null)).to.be.rejectedWith('ELOCKED');
				await expect(lock2.lock(null, null)).to.eventually.be.fulfilled;
			});
			it('should fail always if store locked', async function() {
				let lock2 = store.lock();
				await expect(lock.lock(null, null)).to.eventually.be.fulfilled;
				await expect(lock.lock('testcol', null)).to.be.rejectedWith('ELOCKED');
				await expect(lock.lock('testcol', 'testrec')).to.be.rejectedWith('ELOCKED');
				await expect(lock2.lock('testcol', 'testrec')).to.be.rejectedWith('ELOCKED');
				await expect(lock2.lock('testcol', null)).to.be.rejectedWith('ELOCKED');
				await expect(lock2.lock(null, null)).to.be.rejectedWith('ELOCKED');
			});
			it('should retry for up to configured maximum delay', async function() {
				let lockpath = path.join(await lock.dir(), lock.filename('testcol', 'testrec'));
				let lock2 = store.lock();
				await expect(lock.lock('testcol', 'testrec')).to.eventually.be.fulfilled;
				setTimeout(
					() => {
						expect(() => {
							fs.rmdirSync(lockpath);
						}).to.not.throw();
					},
					100
				);
				await expect(lock2.lock('testcol', 'testrec')).to.be.rejectedWith('ELOCKED');
				await expect(lock2.lock(
					'testcol',
					'testrec',
					{
						timeout: 20
					}
				)).to.be.rejectedWith('ELOCKED');
				await expect(lock2.lock(
					'testcol',
					'testrec',
					{
						timeout: 200
					}
				)).to.eventually.be.fulfilled;
			});
		});
		describe('#unlock', function() {
			it('should unlock held lock', async function() {
				let lockpath = path.join(await lock.dir(), lock.filename('testcol', 'testrec'));
				let lock2 = store.lock();
				await expect(lock.lock('testcol', 'testrec')).to.eventually.be.fulfilled;
				await expect(lock2.lock('testcol', 'testrec')).to.be.rejectedWith('ELOCKED');
				await expect(lock.unlock('testcol', 'testrec')).to.eventually.be.fulfilled;
				expect(() => {
					fs.statSync(lockpath);
				}).to.throw();
				await expect(lock2.lock('testcol', 'testrec')).to.eventually.be.fulfilled;
			});
			it('should fail if lock not held by instance', async function() {
				let lock2 = store.lock();
				await expect(lock.unlock('testcol', 'testrec')).to.be.rejectedWith('ENOTACQUIRED');
				await expect(lock2.unlock('testcol', 'testrec')).to.be.rejectedWith('ENOTACQUIRED');
				await expect(lock.lock('testcol', 'testrec')).to.eventually.be.fulfilled;
				await expect(lock2.unlock('testcol', 'testrec')).to.be.rejectedWith('ENOTACQUIRED');
			});
			it('should fail if lock has been compromised', async function() {
				let lockpath = path.join(await lock.dir(), lock.filename('testcol', 'testrec'));
				await expect(lock.lock('testcol', 'testrec')).to.eventually.be.fulfilled;
				expect(() => {
					return fs.rmdirSync(lockpath);
				}).to.not.throw();
				await expect(lock.unlock('testcol', 'testrec')).to.be.rejectedWith('ECOMPROMISED');
			});
		});
		describe('#unlockAll', function() {
			it('should unlock all locks held by instance', async function() {
				let dir = await lock.dir();
				await expect(lock.lock('testcol', 'testrec1')).to.eventually.be.fulfilled;
				await expect(lock.lock('testcol', 'testrec2')).to.eventually.be.fulfilled;
				await expect(lock.lock('testcol', 'testrec3')).to.eventually.be.fulfilled;
				expect(fs.readdirSync(dir)).to.be.an('array').lengthOf(3);
				await expect(lock.unlockAll()).to.eventually.be.fulfilled;
				expect(fs.readdirSync(dir)).to.be.an('array').lengthOf(0);
			});
			it('should return ok if no locks are held', async function() {
				let dir = await lock.dir();
				await expect(lock.unlockAll()).to.eventually.be.fulfilled;
			});
			it('should return ok if lock directory does not exist', async function() {
				let dir = await lock.dir(false);
				await expect(lock.unlockAll()).to.eventually.be.fulfilled;
			});
		});
		describe('#list', function() {
			it('should list held locks with info', async function() {
				await expect(lock.lock('testcol', 'testrec')).to.eventually.be.fulfilled;
				await expect(lock.lock('testcol', null)).to.eventually.be.fulfilled;
				await expect(lock.lock(null, null)).to.eventually.be.fulfilled;
				expect(lock.list()).to.be.an('array').lengthOf(3).deep.equal([
					{
						collection: null,
						identifier: null,
						type: 'store',
						ours: true
					},
					{
						collection: 'testcol',
						identifier: null,
						type: 'collection',
						ours: true
					},
					{
						collection: 'testcol',
						identifier: 'testrec',
						type: 'record',
						ours: true
					}
				]);
			});
			it('should return ok if no locks are held', async function() {
				let dir = await lock.dir();
				expect(lock.list()).to.be.an('array').lengthOf(0);
			});
			it('should return ok if lock directory does not exist', async function() {
				let dir = await lock.dir(false);
				expect(lock.list()).to.be.an('array').lengthOf(0);
			});
		});
		describe('#listGlobal', function() {
			it('should list all locks held by all processes/instances', async function() {
				await expect(lock.lock('testcol', 'testrec1')).to.eventually.be.fulfilled;
				let lock2 = store.lock();
				await expect(lock2.lock('testcol', 'testrec2')).to.eventually.be.fulfilled;
				await expect(lock2.lock('testcol', null)).to.eventually.be.fulfilled;
				await expect(lock2.lock(null, null)).to.eventually.be.fulfilled;
				await expect(lock.listGlobal()).to.eventually.be.an('array').lengthOf(4).deep.equal([
					{
						collection: null,
						identifier: null,
						type: 'store',
						ours: false
					},
					{
						collection: 'testcol',
						identifier: null,
						type: 'collection',
						ours: false
					},
					{
						collection: 'testcol',
						identifier: 'testrec1',
						type: 'record',
						ours: true
					},
					{
						collection: 'testcol',
						identifier: 'testrec2',
						type: 'record',
						ours: false
					}
				]);
			});
			it('should return ok if no locks are held by anything', async function() {
				let dir = await lock.dir();
				await expect(lock.listGlobal()).to.eventually.be.an('array').lengthOf(0);
			});
			it('should return ok if lock directory does not exist', async function() {
				let dir = await lock.dir(false);
				await expect(lock.listGlobal()).to.eventually.be.an('array').lengthOf(0);
			});
		});
	});
	describe('Convenience methods', function() {
		describe('#lockCollection', function() {
			it('should lock collection', async function() {
				await expect(lock.lockCollection('testcol')).to.eventually.be.fulfilled;
				expect(fs.statSync(path.join(await lock.dir(), '@@--collection@@testcol'))).to.be.instanceof(fs.Stats);
			});
			it('should return ok if lock already held by same instance', async function() {
				await expect(lock.lockCollection('testcol')).to.eventually.be.fulfilled;
				await expect(lock.lockCollection('testcol')).to.eventually.be.fulfilled;
			});
			it('should fail if lock already held by other instance', async function() {
				let lock2 = store.lock();
				await expect(lock.lockCollection('testcol')).to.eventually.be.fulfilled;
				await expect(lock2.lockCollection('testcol')).to.be.rejectedWith('ELOCKED');
			});
			it('should fail always if store locked', async function() {
				let lock2 = store.lock();
				await expect(lock.lock(null, null)).to.eventually.be.fulfilled;
				await expect(lock.lockCollection('testcol')).to.be.rejectedWith('ELOCKED');
				await expect(lock2.lockCollection('testcol')).to.be.rejectedWith('ELOCKED');
			});
		});
		describe('#lockStore', function() {
			it('should lock store', async function() {
				await expect(lock.lockStore()).to.eventually.be.fulfilled;
				expect(fs.statSync(path.join(await lock.dir(), '@@--store@@'))).to.be.instanceof(fs.Stats);
			});
			it('should return ok if lock already held by same instance', async function() {
				await expect(lock.lockStore()).to.eventually.be.fulfilled;
				await expect(lock.lockStore()).to.eventually.be.fulfilled;
			});
			it('should fail if lock already held by other instance', async function() {
				let lock2 = store.lock();
				await expect(lock.lockStore()).to.eventually.be.fulfilled;
				await expect(lock2.lockStore()).to.be.rejectedWith('ELOCKED');
			});
		});
		describe('#unlockCollection', function() {
			it('should unlock held collection lock', async function() {
				let lockpath = path.join(await lock.dir(), lock.filename('testcol', null));
				let lock2 = store.lock();
				await expect(lock.lockCollection('testcol')).to.eventually.be.fulfilled;
				await expect(lock2.lockCollection('testcol')).to.be.rejectedWith('ELOCKED');
				await expect(lock.unlockCollection('testcol')).to.eventually.be.fulfilled;
				expect(() => {
					fs.statSync(lockpath);
				}).to.throw();
				await expect(lock2.lockCollection('testcol')).to.eventually.be.fulfilled;
			});
			it('should fail if lock not held by instance', async function() {
				let lock2 = store.lock();
				await expect(lock.unlockCollection('testcol')).to.be.rejectedWith('ENOTACQUIRED');
				await expect(lock2.unlockCollection('testcol')).to.be.rejectedWith('ENOTACQUIRED');
				await expect(lock.lockCollection('testcol')).to.eventually.be.fulfilled;
				await expect(lock2.unlockCollection('testcol')).to.be.rejectedWith('ENOTACQUIRED');
			});
		});
		describe('#unlockStore', function() {
			it('should unlock held store lock', async function() {
				let lockpath = path.join(await lock.dir(), lock.filename(null, null));
				let lock2 = store.lock();
				await expect(lock.lockStore()).to.eventually.be.fulfilled;
				await expect(lock2.lockStore()).to.be.rejectedWith('ELOCKED');
				await expect(lock.unlockStore()).to.eventually.be.fulfilled;
				expect(() => {
					fs.statSync(lockpath);
				}).to.throw();
				await expect(lock2.lockStore()).to.eventually.be.fulfilled;
			});
			it('should fail if lock not held by instance', async function() {
				let lock2 = store.lock();
				await expect(lock.unlockStore()).to.be.rejectedWith('ENOTACQUIRED');
				await expect(lock2.unlockStore()).to.be.rejectedWith('ENOTACQUIRED');
				await expect(lock.lockStore()).to.eventually.be.fulfilled;
				await expect(lock2.unlockStore()).to.be.rejectedWith('ENOTACQUIRED');
			});
		});
	});
});
