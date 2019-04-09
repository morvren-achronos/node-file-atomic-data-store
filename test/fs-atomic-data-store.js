/**
 * fs-atomic-data-store unit tests
 */

/* eslint-env node, mocha */
/* eslint prefer-arrow-callback: 0, func-names: 0, no-sync: 0, no-unused-vars: 0 */


// Libraries
const
	fsads = require('../index'),
	Store = require('../src/Store'),
	Record = require('../src/Record'),
	Lock = require('../src/Lock'),
	fs = require('fs'),
	os = require('os'),
	path = require('path'),
	chai = require('chai'),
	chaiAsPromised = require('chai-as-promised'),
	rimraf = require('rimraf')
;
const expect = chai.expect;
chai.use(chaiAsPromised);

let
	rootDir,
	store
;

async function makeDirs(mkdirs) {
	for (let dir of mkdirs) {
		fs.mkdirSync(
			path.join(rootDir, dir),
			{
				recursive: true
			}
		);
	}
}

beforeEach(function() {
	rootDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), '/node-fs-atomic-data-store-test-')));
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
	describe('#store', function() {
		it('should return a configured Store object', function() {
			expect(fsads.store).is.a('function');
			let store = fsads.store(
				rootDir,
				{
					defaultPart: 'test'
				}
			);
			expect(store).is.instanceof(Store);
			expect(store.option('rootDir')).to.equal(rootDir);
			expect(store.option('defaultPart')).to.equal('test');
		});
	});
});

describe('classes', function() {
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
					expect(await store.dir(relativeDir, true)).to.equal(expectedDir);
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
			describe('#listDirectoriesInDir', function() {
				it('should list only directories within dir', async function() {
					const mkdirs = [
						'foo/bar',
						'foo/baz',
						'foo/bat'
					];
					await makeDirs(mkdirs);
					fs.writeFileSync(path.join(await store.dir(['foo'], false), 'a-file'), 'file content');
					await expect(store.listDirectoriesInDir(await store.dir(['foo'], false))).to.eventually.be.an('array').lengthOf(3);
				});
				it('should resolve ok if dir does not exist', async function() {
					await expect(store.listDirectoriesInDir(await store.dir(['does-not-exist'], false))).to.eventually.be.an('array').lengthOf(0);
				});
			});
			describe('#runWithRetry', function() {
				it('should retry according to provided timeout and wait', async function() {
					let testTryCount;
					async function testRetry(timeout, wait, retries, work) {
						testTryCount = 0;
						return store.runWithRetry(
							(resolve, reject, retry, tryCount) => {
								testTryCount++;
								if (tryCount < retries) {
									retry();
									return;
								}
								if (work) {
									resolve('good');
									return;
								}
								reject(new Error('bad'));
							},
							() => {
								return new Error('timeout');
							},
							timeout,
							wait
						);
					}
					// no time
					await expect(testRetry(0, 0, 0, true)).to.eventually.be.fulfilled;
					expect(testTryCount).to.equal(1);
					await expect(testRetry(0, 0, 0, false)).to.eventually.be.rejectedWith('bad');
					expect(testTryCount).to.equal(1);

					// lots of time but operation does not use
					await expect(testRetry(500, 10, 0, true)).to.eventually.be.fulfilled;
					expect(testTryCount).to.equal(1);
					await expect(testRetry(500, 10, 0, false)).to.eventually.be.rejectedWith('bad');
					expect(testTryCount).to.equal(1);

					// lots of time, operation uses only some
					await expect(testRetry(500, 10, 2, true)).to.eventually.be.fulfilled;
					expect(testTryCount).to.equal(3);
					await expect(testRetry(500, 10, 2, false)).to.eventually.be.rejectedWith('bad');
					expect(testTryCount).to.equal(3);

					// time for one retry, operation goes forever
					await expect(testRetry(10, 10, 99, true)).to.eventually.be.rejectedWith('timeout');
					expect(testTryCount).to.equal(2);
					await expect(testRetry(10, 10, 99, false)).to.eventually.be.rejectedWith('timeout');
					expect(testTryCount).to.equal(2);

					// time for some retries, operation goes forever
					await expect(testRetry(100, 10, 99, true)).to.eventually.be.rejectedWith('timeout');
					expect(testTryCount).to.equal(4);
					await expect(testRetry(100, 10, 99, false)).to.eventually.be.rejectedWith('timeout');
					expect(testTryCount).to.equal(4);
				});
			});
		});
		describe('Factory methods', function() {
			describe('#record', function() {
				it('should return an instance of Record', function() {
					expect(store.record('testrec')).to.be.instanceof(Record);
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
								transactionTimeout: 0
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
								transactionTimeout: 30,
								transactionWait: 10
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
								transactionTimeout: 30,
								transactionWait: 10
							}
						),
						'throw during retry'
					).to.be.rejectedWith('test error');
				});
			});
			describe('#collections', function() {
				it('should return list of collections', async function() {
					const mkdirs = [
						'collections/testcol1',
						'collections/testcol2',
						'collections/testcol3'
					];
					await makeDirs(mkdirs);
					await expect(store.collections()).is.eventually.an('array').lengthOf(3).deep.equal(['testcol1', 'testcol2', 'testcol3']);
				});
				it('should return ok when store is empty', async function() {
					await expect(store.collections()).is.eventually.an('array').lengthOf(0);
				});
			});
			describe('#traverse', function() {
				const mkdirs = [
					'records/a0/b0/c0/d0/testrec0',
					'collections/testcol1/a0/b0/c0/d0/testrec0',
					'collections/testcol2/a0/b0/c0/d0/testrec0',
					'records/a0/b0/c0/d0/testrec1',
					'collections/testcol1/a0/b0/c0/d0/testrec1',
					'collections/testcol2/a0/b0/c0/d0/testrec1',
					'records/a0/b0/c0/d1/testrec2',
					'collections/testcol1/a0/b0/c0/d1/testrec2',
					'collections/testcol2/a0/b0/c0/d1/testrec2',
					'records/a0/b0/c0/d1/testrec3',
					'collections/testcol2/a0/b0/c0/d1/testrec3',
					'records/a0/b0/c1/d0/testrec4',
					'collections/testcol2/a0/b0/c1/d0/testrec4',
					'records/a0/b0/c1/d1/testrec5',
					'collections/testcol2/a0/b0/c1/d1/testrec5',
					'collections/testcol3/a0/b0/c1/d1/testrec5',
					'records/a0/b1/c0/d0/testrec6',
					'collections/testcol3/a0/b1/c0/d0/testrec6',
					'records/a1/b0/c0/d0/testrec7',
					'collections/testcol3/a1/b0/c0/d0/testrec7',
					'records/a1/b0/c0/d0/testrec8',
					'records/a1/b0/c1/d0/testrec9'
				];
				const testrecs = {
					'@all': [
						'testrec0',
						'testrec1',
						'testrec2',
						'testrec3',
						'testrec4',
						'testrec5',
						'testrec6',
						'testrec7',
						'testrec8',
						'testrec9'
					],
					testcol1: [
						'testrec0',
						'testrec1',
						'testrec2'
					],
					testcol2: [
						'testrec0',
						'testrec1',
						'testrec2',
						'testrec3',
						'testrec4',
						'testrec5'
					],
					testcol3: [
						'testrec5',
						'testrec6',
						'testrec7'
					]
				};
				it('should execute callback once for each record in collection', async function() {
					await makeDirs(mkdirs);
					for (let colname in testrecs) {
						const testids = testrecs[colname];
						let foundids = [];
						await expect(store.traverse(colname, (identifier, recordIndex) => {
							expect(identifier).to.be.a('string')
								.lengthOf(8)
								.match(/^testrec\d$/)
							;
							expect(recordIndex).to.be.a('number').equal(foundids.length);
							foundids.push(identifier);
						})).to.eventually.equal(testids.length);
						foundids.sort();
						expect(foundids).to.deep.equal(testids);
					}
				});
				it('should return ok if collection does not exist', async function() {
					await expect(store.traverse('does-not-exist', () => {
						throw new Error('callback should not be called');
					})).to.eventually.equal(0);
				});
				it('should stop if callback returns bool false', async function() {
					await makeDirs(mkdirs);
					let foundids = [];
					await expect(store.traverse('@all', (identifier, recordIndex) => {
						foundids.push(identifier);
						if (recordIndex == 3) {
							return false;
						}
					})).to.eventually.equal(4);
					expect(foundids).to.have.lengthOf(4);
				});
			});
		});
	});

	describe('class Record', function() {
		let record, recorddir;
		beforeEach(async function() {
			store = new Store({
				rootDir: rootDir,
				defaultPart: 'test'
			});
			record = store.record('testrec');
			recorddir = await record.dir(true);
		});
		describe('Utility methods', function() {
			describe('#store', function() {
				it('should return store instance', function() {
					expect(record.store).to.equal(store);
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
						let temprec = store.record(identifier);
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
					let expectedDir = path.join(rootDir, 'records', ...hashparts, 'testrec');
					await expect(record.dir(true)).to.eventually.equal(expectedDir);
					expect(function() {
						fs.statSync(expectedDir);
					}).to.not.throw();
				});
				it('should return record dir without creating when create=false', async function() {
					try {
						fs.rmdirSync(recorddir);
					}
					catch(err) {
						/**/
					}
					let hash = record.generateHash();
					let hashparts = [];
					for (let i = 0; i < 8; i += 2) {
						hashparts.push(hash.slice(i, i + 2));
					}
					let expectedDir = path.join(rootDir, 'records', ...hashparts, 'testrec');
					await expect(record.dir(false)).to.eventually.equal(expectedDir);
					expect(function() {
						fs.statSync(expectedDir);
					}).to.throw('ENOENT');
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
						fs.writeFileSync(path.join(recorddir, part), part.repeat(4));
					}
					let parts = await record.listParts();
					parts.sort();
					expect(parts).to.deep.equal(expectedParts);
				});
				it('should return ok if record does not exist', async function() {
					try {
						fs.rmdirSync(recorddir);
					}
					catch(err) {
						/**/
					}
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
						fs.writeFileSync(path.join(recorddir, part), part.repeat(4));
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
						fs.writeFileSync(path.join(recorddir, part), part.repeat(4));
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
						fs.writeFileSync(path.join(recorddir, part), part.repeat(4));
					}
					let partContents = await record.readMultipleParts(parts);
					expect(partContents).is.an('object');
					for (let part in partContents) {
						expect(partContents[part])
							.instanceof(Buffer)
							.lengthOf(20)
							.deep.equal(Buffer.from(part.repeat(4)))
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
						fs.writeFileSync(path.join(recorddir, part), part.repeat(4));
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
						fs.writeFileSync(path.join(recorddir, part), '0123456789abcdef'.repeat(1024));
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
					await expect(record.writeMultipleParts(parts)).to.eventually.be.fulfilled;
					for (let part in parts) {
						expect(fs.readFileSync(path.join(recorddir, part))).to.be.lengthOf(16 * 1024);
					}
				});
				it('should throw if any part cannot be written', async function() {
					let parts = {
						test1: Buffer.from('0123456789abcdef'.repeat(1024)),
						test2: Buffer.from('0123456789abcdef'.repeat(1024)),
						test3: '0123456789abcdef'.repeat(1024)
					};
					fs.mkdirSync(path.join(recorddir, 'test3'));
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
						expect(fs.readFileSync(path.join(recorddir, part))).to.be.lengthOf(16 * 1024);
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
						fs.writeFileSync(path.join(recorddir, part), part);
					}
					await expect(record.deleteMultipleParts(parts)).to.eventually.deep.equal(parts);
					for (let part of parts) {
						let filepath = path.join(recorddir, part);
						expect(function() {
							fs.statSync(filepath);
						}).to.throw('ENOENT');
					}
				});
				it('should ignore parts that do not exist', async function() {
					let parts = [
						'test1',
						'test2'
					];
					for (let part of parts) {
						fs.writeFileSync(path.join(recorddir, part), part);
					}
					parts.push('test3');
					await expect(record.deleteMultipleParts(parts)).to.eventually.be.an('array').lengthOf(2);
					for (let part of parts) {
						let filepath = path.join(recorddir, part);
						expect(function() {
							fs.statSync(filepath)
						}).to.throw('ENOENT');
					}
				});
				it('should return ok if record does not exist', async function() {
					try {
						fs.rmdirSync(recorddir);
					}
					catch(err) {
						/**/
					}
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
			});
			describe('#shredMultipleParts', function() {
				async function shredCaptureContent(parts) {
					let shredFdFilenameMap = {};
					const originalOpen = store._fsop.open;
					store._fsop.open = async (...args) => {
						let fd = await originalOpen(...args);
						shredFdFilenameMap[fd] = args[0];
						return fd;
					};
					let contentBeforeUnlink = {};
					const originalTruncate = store._fsop.ftruncate;
					store._fsop.ftruncate = async (fd) => {
						let filename = shredFdFilenameMap[fd];
						let part = (/(test\d)\.shred/).exec(filename)[1];
						contentBeforeUnlink[part] = fs.readFileSync(filename);
						return originalTruncate(fd);
					};
					await expect(record.shredMultipleParts(parts)).to.eventually.deep.equal(parts);
					return contentBeforeUnlink;
				}
				it('should overwrite part data then remove parts', async function() {
					let parts = [
						'test1',
						'test2',
						'test3'
					];
					for (let part of parts) {
						let filepath = path.join(recorddir, part);
						fs.writeFileSync(filepath, Buffer.from('0123456789abcdef'.repeat(1024))); // 16K
						fs.linkSync(filepath, filepath + '-copy');
					}
					let contentBeforeUnlink = await shredCaptureContent(parts);
					for (let part of parts) {
						let filepath = path.join(recorddir, part);

						expect(function() {
							return fs.statSync(filepath);
						}).to.throw();

						let stat = fs.statSync(filepath + '-copy');
						expect(stat.size).to.equal(0);
						fs.unlinkSync(filepath + '-copy');

						expect(contentBeforeUnlink[part]).to.be.instanceof(Buffer).lengthOf(16 * 1024);
						expect(contentBeforeUnlink[part].indexOf(Buffer.from('0123456789abcdef'))).to.equal(-1);
					}
					expect(fs.readdirSync(await record.dir(false))).to.be.an('array').lengthOf(0);
				});
				it('should overwrite part data to an even kilobyte', async function() {
					let filepath = path.join(recorddir, 'test1');
					fs.writeFileSync(filepath, Buffer.from('0123456789abcdef'.repeat(1025))); // 16K plus 16 btyes
					let contentBeforeUnlink = await shredCaptureContent(['test1']);
					expect(contentBeforeUnlink.test1).to.be.instanceof(Buffer).lengthOf(17 * 1024);
					expect(contentBeforeUnlink.test1.indexOf(Buffer.from('0123456789abcdef'))).to.equal(-1);
				});
				it('should overwrite all of large parts', async function() {
					let filepath = path.join(recorddir, 'test1');
					fs.writeFileSync(filepath, Buffer.from('0123456789abcdef'.repeat((512 * 1024) + 1))); // 8M plus 16 bytes
					let contentBeforeUnlink = await shredCaptureContent(['test1']);
					expect(contentBeforeUnlink.test1).to.be.instanceof(Buffer).lengthOf((16 * 512 * 1024) + 1024);
					expect(contentBeforeUnlink.test1.indexOf(Buffer.from('0123456789abcdef'))).to.equal(-1);
				});
			});
			describe('#listCollections', function() {
				it('should list collections the record belongs to', async function() {
					const mkdirs = [
						recorddir.replace(rootDir + '/records/', 'collections/testcol1/'),
						recorddir.replace(rootDir + '/records/', 'collections/testcol2/'),
						recorddir.replace(rootDir + '/records/', 'collections/testcol3/')
					];
					await makeDirs(mkdirs);
					await expect(record.listCollections()).to.eventually.deep.equal(['testcol1', 'testcol2', 'testcol3']);
				});
				it('should not list collections the record does not belong to', async function() {
					const mkdirs = [
						recorddir.replace(rootDir + '/records/', 'collections/testcol1/'),
						recorddir.replace(rootDir + '/records/', 'collections/testcol2/'),
						recorddir.replace(rootDir + '/records/', 'collections/testcol3/')
					];
					await makeDirs(mkdirs);
					await store.dir(['collections/testcol4/00/01/02/03/foobar'], true)
					await store.dir(['collections/testcol5/00/01/02/03/foobar'], true)
					await expect(record.listCollections()).to.eventually.deep.equal(['testcol1', 'testcol2', 'testcol3']);
				});
				it('should resolve ok if the record does not belong to any collections', async function() {
					const mkdirs = [
						await store.dir(['collections/testcol1/00/01/02/03/foobar'], true),
						await store.dir(['collections/testcol2'], true)
					];
					await expect(record.listCollections()).to.eventually.deep.equal([]);
				});
				it('should resolve ok if there are no collections', async function() {
					await expect(record.listCollections()).to.eventually.deep.equal([]);
				});
			});
			describe('#addMultipleCollections', function() {
				it('should add to the collections the record belongs to', async function() {
					const collections = ['testcol1', 'testcol2', 'testcol3'];
					await expect(record.addMultipleCollections(collections)).to.eventually.deep.equal(collections);
					expect(function() {
						fs.statSync(recorddir.replace('records/', 'collections/testcol1/'));
					}).to.not.throw();
					expect(function() {
						fs.statSync(recorddir.replace('records/', 'collections/testcol2/'));
					}).to.not.throw();
					expect(function() {
						fs.statSync(recorddir.replace('records/', 'collections/testcol3/'));
					}).to.not.throw();
				});
				it('should return only added collections', async function() {
					const mkdirs = [
						recorddir.replace(rootDir + '/records/', '/collections/testcol2/'),
						recorddir.replace(rootDir + '/records/', '/collections/testcol3/')
					];
					await makeDirs(mkdirs);
					const collections = ['testcol1', 'testcol2', 'testcol3', 'testcol4'];
					await expect(record.addMultipleCollections(collections)).to.eventually.deep.equal(['testcol1', 'testcol4']);
				});
			});
			describe('#removeMultipleCollections', function() {
				it('should remove from the collections the record belongs to', async function() {
					const mkdirs = [
						recorddir.replace(rootDir + '/records/', 'collections/testcol1/'),
						recorddir.replace(rootDir + '/records/', 'collections/testcol2/'),
						recorddir.replace(rootDir + '/records/', 'collections/testcol3/')
					];
					await makeDirs(mkdirs);
					await expect(record.removeMultipleCollections(['testcol1', 'testcol2'])).to.eventually.deep.equal(['testcol1', 'testcol2']);
					expect(function() {
						fs.statSync(recorddir.replace('records/', 'collections/testcol1/'));
					}).to.throw();
					expect(function() {
						fs.statSync(recorddir.replace('records/', 'collections/testcol2/'));
					}).to.throw();
					expect(function() {
						fs.statSync(recorddir.replace('records/', 'collections/testcol3/'));
					}).to.not.throw();
				});
				it('should return removed collections', async function() {
					const mkdirs = [
						recorddir.replace(rootDir + '/records/', 'collections/testcol1/'),
						recorddir.replace(rootDir + '/records/', 'collections/testcol2/'),
						recorddir.replace(rootDir + '/records/', 'collections/testcol3/')
					];
					await makeDirs(mkdirs);
					await expect(record.removeMultipleCollections(['testcol3', 'testcol4'])).to.eventually.deep.equal(['testcol3']);
					expect(function() {
						fs.statSync(recorddir.replace('records/', 'collections/testcol1/'));
					}).to.not.throw();
					expect(function() {
						fs.statSync(recorddir.replace('records/', 'collections/testcol2/'));
					}).to.not.throw();
					expect(function() {
						fs.statSync(recorddir.replace('records/', 'collections/testcol3/'));
					}).to.throw();
					expect(function() {
						fs.statSync(recorddir.replace('records/', 'collections/testcol4/'));
					}).to.throw();
				});
				it('should clean up empty directories', async function() {
					const mkdirs = [
						recorddir.replace(rootDir + '/records/', 'collections/testcol1/')
					];
					await makeDirs(mkdirs);
					await expect(record.removeMultipleCollections(['testcol1'])).to.eventually.deep.equal(['testcol1']);
					expect(function() {
						fs.statSync(store.dir(['collections']));
					}).to.throw();
				});
			});
			describe('#deleteRecord', function() {
				it('should remove record parts, record directory and collections', async function() {
					fs.writeFileSync(path.join(recorddir, 'test1'), 'test1');
					fs.writeFileSync(path.join(recorddir, 'test2'), 'test2');
					const mkdirs = [
						recorddir.replace(rootDir + '/records/', 'collections/testcol1/'),
						recorddir.replace(rootDir + '/records/', 'collections/testcol2/')
					];
					await makeDirs(mkdirs);
					await expect(record.deleteRecord()).to.eventually.be.fulfilled;
					expect(function() {
						fs.readFileSync(path.join(recorddir, 'test1'));
					}).to.throw();
					expect(function() {
						fs.readFileSync(path.join(recorddir, 'test2'));
					}).to.throw();
					expect(function() {
						fs.statSync(recorddir.replace('records/', 'collections/testcol1/'));
					}).to.throw();
					expect(function() {
						fs.statSync(recorddir.replace('records/', 'collections/testcol2/'));
					}).to.throw();
					expect(function() {
						fs.statSync(store.dir(['records']));
					}).to.throw();
				});
			});
		});
		describe('Convenience methods', function() {
			describe('#statPart', function() {
				it('should return file stat data for part', async function() {
					fs.writeFileSync(path.join(recorddir, 'test1'), 'test1');
					await expect(record.statPart('test1')).to.eventually.be.instanceof(fs.Stats);
				});
				it('should throw if part does not exist', async function() {
					await expect(record.statPart('test1')).to.be.rejected;
				});
			});
			describe('#readBuffer', function() {
				it('should return single part in Buffer', async function() {
					fs.writeFileSync(path.join(recorddir, 'test1'), 'test1');
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
					fs.writeFileSync(path.join(recorddir, 'test1'), Buffer.from('0123456789abcdef'.repeat(1024)));
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
					await expect(fs.readFileSync(path.join(recorddir, 'test1'))).to.be.instanceof(Buffer).lengthOf(16 * 1024);
				});
			});
			describe('#deletePart', function() {
				it('should remove single part', async function() {
					fs.writeFileSync(path.join(recorddir, 'test1'), 'test1');
					await expect(record.deletePart('test1')).to.eventually.equal(true);
				});
				it('should return false if part does not exist', async function() {
					await expect(record.deletePart('test1')).to.eventually.equal(false);
				});
			});
			describe('#deleteAllParts', function() {
				it('should remove entire record', async function() {
					let parts = [
						'test1',
						'test2',
						'test3'
					];
					for (let part of parts) {
						fs.writeFileSync(path.join(recorddir, part), Buffer.from('0123456789abcdef'.repeat(1024)));
					}
					await expect(record.deleteAllParts()).to.eventually.deep.equal(parts);
				});
			});
			describe('#shredPart', function() {
				it('should overwrite single part', async function() {
					const filepath = path.join(recorddir, 'test1');
					fs.writeFileSync(filepath, Buffer.from('0123456789abcdef'.repeat(1024)));
					await expect(record.shredPart('test1')).to.eventually.be.fulfilled;
					expect(function() {
						return fs.statSync(filepath);
					}).to.throw();
				});
			});
			describe('#addCollection', function() {
				it('should add to the collections the record belongs to', async function() {
					await expect(record.addCollection('testcol')).to.eventually.equal(true);
					expect(function() {
						fs.statSync(recorddir.replace('records/', 'collections/testcol/'));
					}).to.not.throw();
				});
				it('should return whether the collection was added', async function() {
					const mkdirs = [
						recorddir.replace(rootDir + '/records/', 'collections/testcol/')
					];
					await makeDirs(mkdirs);
					await expect(record.addCollection('testcol')).to.eventually.equal(false);
				});
			});
			describe('#removeCollection', function() {
				it('should remove from the collections the record belongs to', async function() {
					const mkdirs = [
						recorddir.replace(rootDir + '/records/', 'collections/testcol/')
					];
					await makeDirs(mkdirs);
					await expect(record.removeCollection('testcol')).to.eventually.equal(true);
					expect(function() {
						fs.statSync(recorddir.replace('records/', 'collections/testcol/'));
					}).to.throw();
				});
				it('should return whether the collection was removed', async function() {
					await expect(record.removeCollection('testcol')).to.eventually.equal(false);
				});
				it('should clean up empty directories', async function() {
					const mkdirs = [
						recorddir.replace(rootDir + '/records/', 'collections/testcol/')
					];
					await makeDirs(mkdirs);
					await expect(record.removeCollection('testcol')).to.eventually.equal(true);
					expect(function() {
						fs.statSync(store.dir(['collections']));
					}).to.throw();
				});
			});
			describe('#removeAllCollections', function() {
				it('should remove all collections the record belongs to, and clean up empty directories', async function() {
					const mkdirs = [
						recorddir.replace(rootDir + '/records/', 'collections/testcol1/'),
						recorddir.replace(rootDir + '/records/', 'collections/testcol2/')
					];
					await makeDirs(mkdirs);
					await expect(record.removeAllCollections()).to.eventually.deep.equal(['testcol1', 'testcol2']);
					expect(function() {
						fs.statSync(recorddir.replace('records/', 'collections/testcol1/'));
					}).to.throw();
					expect(function() {
						fs.statSync(recorddir.replace('records/', 'collections/testcol2/'));
					}).to.throw();
					expect(function() {
						fs.statSync(store.dir(['collections']));
					}).to.throw();
				});
			});
			describe('#setCollections', function() {
				it('should add to and remove from the collections the record belongs to', async function() {
					const mkdirs = [
						recorddir.replace(rootDir + '/records/', 'collections/testcol1/'),
						recorddir.replace(rootDir + '/records/', 'collections/testcol2/'),
						recorddir.replace(rootDir + '/records/', 'collections/testcol3/')
					];
					await makeDirs(mkdirs);
					await expect(record.setCollections(['testcol1', 'testcol4', 'testcol5'])).to.eventually.be.fulfilled;
					expect(function() {
						fs.statSync(recorddir.replace('records/', 'collections/testcol1/'));
					}).to.not.throw();
					expect(function() {
						fs.statSync(recorddir.replace('records/', 'collections/testcol2/'));
					}).to.throw();
					expect(function() {
						fs.statSync(recorddir.replace('records/', 'collections/testcol3/'));
					}).to.throw();
					expect(function() {
						fs.statSync(recorddir.replace('records/', 'collections/testcol4/'));
					}).to.not.throw();
					expect(function() {
						fs.statSync(recorddir.replace('records/', 'collections/testcol5/'));
					}).to.not.throw();
				});
			});
		});
	});

	describe('class Lock', function() {
		let lock, lockdir;
		beforeEach(async function() {
			store = new Store({
				rootDir: rootDir,
				defaultPart: 'test'
			});
			lock = store.lock();
			lockdir = await store.dir([store.option('locksDir')], true);
		});
		describe('Utility methods', function() {
			describe('#store', function() {
				it('should return store instance', function() {
					expect(lock.store).to.equal(store);
				});
			});
		});
		describe('Data operation methods', function() {
			describe('#lock', function() {
				it('should take lock if available', async function() {
					await expect(lock.lock('testrec')).to.eventually.be.fulfilled;
					expect(fs.statSync(path.join(lockdir, 'testrec'))).to.be.instanceof(fs.Stats);
					await expect(lock.lock('@store')).to.eventually.be.fulfilled;
					expect(fs.statSync(path.join(lockdir, '@store'))).to.be.instanceof(fs.Stats);
				});
				it('should return ok if lock already held by same instance', async function() {
					await expect(lock.lock('testrec')).to.eventually.be.fulfilled;
					await expect(lock.lock('testrec')).to.eventually.be.fulfilled;
					await expect(lock.lock('@store')).to.eventually.be.fulfilled;
					await expect(lock.lock('@store')).to.eventually.be.fulfilled;
				});
				it('should fail if lock already held by other instance', async function() {
					let lock2 = store.lock();
					await expect(lock.lock('testrec')).to.eventually.be.fulfilled;
					await expect(lock2.lock('testrec')).to.be.rejectedWith('ELOCKED');
					await expect(lock.lock('@store')).to.eventually.be.fulfilled;
					await expect(lock2.lock('@store')).to.be.rejectedWith('ELOCKED');
				});
				it('should fail always if store locked', async function() {
					let lock2 = store.lock();
					await expect(lock.lock('@store')).to.eventually.be.fulfilled;
					await expect(lock.lock('testrec')).to.be.rejectedWith('ELOCKED');
					await expect(lock2.lock('testrec2')).to.be.rejectedWith('ELOCKED');
					await expect(lock2.lock('@store')).to.be.rejectedWith('ELOCKED');
				});
				it('should retry for up to configured maximum delay', async function() {
					let lockpath = path.join(lockdir, 'testrec');
					let lock2 = store.lock();
					await expect(lock.lock('testrec')).to.eventually.be.fulfilled;
					setTimeout(
						() => {
							expect(() => {
								fs.rmdirSync(lockpath);
							}).to.not.throw();
						},
						100
					);
					await expect(lock2.lock('testrec')).to.be.rejectedWith('ELOCKED');
					await expect(lock2.lock(
						'testrec',
						{
							timeout: 20
						}
					)).to.be.rejectedWith('ELOCKED');
					await expect(lock2.lock(
						'testrec',
						{
							timeout: 200
						}
					)).to.eventually.be.fulfilled;
				});
			});
			describe('#unlock', function() {
				it('should unlock held lock', async function() {
					let lockpath = path.join(lockdir, 'testrec');
					let lock2 = store.lock();
					await expect(lock.lock('testrec')).to.eventually.be.fulfilled;
					await expect(lock2.lock('testrec')).to.be.rejectedWith('ELOCKED');
					await expect(lock.unlock('testrec')).to.eventually.be.fulfilled;
					expect(() => {
						fs.statSync(lockpath);
					}).to.throw();
					await expect(lock2.lock('testrec')).to.eventually.be.fulfilled;
				});
				it('should fail if lock not held by instance', async function() {
					let lock2 = store.lock();
					await expect(lock.unlock('testrec')).to.be.rejectedWith('ENOTACQUIRED');
					await expect(lock2.unlock('testrec')).to.be.rejectedWith('ENOTACQUIRED');
					await expect(lock.lock('testrec')).to.eventually.be.fulfilled;
					await expect(lock2.unlock('testrec')).to.be.rejectedWith('ENOTACQUIRED');
				});
				it('should fail if lock has been compromised', async function() {
					let lockpath = path.join(lockdir, 'testrec');
					await expect(lock.lock('testrec')).to.eventually.be.fulfilled;
					expect(() => {
						return fs.rmdirSync(lockpath);
					}).to.not.throw();
					await expect(lock.unlock('testrec')).to.be.rejectedWith('ECOMPROMISED');
				});
			});
			describe('#unlockAll', function() {
				it('should unlock all locks held by instance', async function() {
					let dir = lockdir;
					await expect(lock.lock('testrec1')).to.eventually.be.fulfilled;
					await expect(lock.lock('testrec2')).to.eventually.be.fulfilled;
					await expect(lock.lock('testrec3')).to.eventually.be.fulfilled;
					expect(fs.readdirSync(dir)).to.be.an('array').lengthOf(3);
					await expect(lock.unlockAll()).to.eventually.be.fulfilled;
					expect(fs.readdirSync(dir)).to.be.an('array').lengthOf(0);
				});
				it('should return ok if no locks are held', async function() {
					let dir = lockdir;
					await expect(lock.unlockAll()).to.eventually.be.fulfilled;
				});
				it('should return ok if lock directory does not exist', async function() {
					try{
						fs.rmdirSync(lockdir);
					}
					catch (err) {
						/**/
					}
					await expect(lock.unlockAll()).to.eventually.be.fulfilled;
				});
			});
			describe('#list', function() {
				it('should list held locks', async function() {
					await expect(lock.lock('testrec1')).to.eventually.be.fulfilled;
					await expect(lock.lock('testrec2')).to.eventually.be.fulfilled;
					await expect(lock.lock('@store')).to.eventually.be.fulfilled;
					expect(lock.list()).to.be.an('array').lengthOf(3).deep.equal(['@store', 'testrec1', 'testrec2']);
				});
				it('should return ok if no locks are held', async function() {
					expect(lock.list()).to.be.an('array').lengthOf(0);
				});
				it('should return ok if lock directory does not exist', async function() {
					try{
						fs.rmdirSync(lockdir);
					}
					catch (err) {
						/**/
					}
					expect(lock.list()).to.be.an('array').lengthOf(0);
				});
			});
			describe('#listGlobal', function() {
				it('should list all locks held by all processes/instances', async function() {
					await expect(lock.lock('testrec1')).to.eventually.be.fulfilled;
					let lock2 = store.lock();
					await expect(lock2.lock('testrec2')).to.eventually.be.fulfilled;
					await expect(lock2.lock('@store')).to.eventually.be.fulfilled;
					await expect(lock.listGlobal()).to.eventually.be.an('array').lengthOf(3).deep.equal(['@store', 'testrec1', 'testrec2']);
				});
				it('should return ok if no locks are held by anything', async function() {
					await expect(lock.listGlobal()).to.eventually.be.an('array').lengthOf(0);
				});
				it('should return ok if lock directory does not exist', async function() {
					try{
						fs.rmdirSync(lockdir);
					}
					catch (err) {
						/**/
					}
					await expect(lock.listGlobal()).to.eventually.be.an('array').lengthOf(0);
				});
			});
		});
		describe('Convenience methods', function() {
			describe('#lockStore', function() {
				it('should lock store', async function() {
					await expect(lock.lockStore()).to.eventually.be.fulfilled;
					expect(fs.statSync(path.join(lockdir, '@store'))).to.be.instanceof(fs.Stats);
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
			describe('#unlockStore', function() {
				it('should unlock held store lock', async function() {
					let lockpath = path.join(lockdir, '@store');
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
});
