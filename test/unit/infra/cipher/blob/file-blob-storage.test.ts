import {expect} from 'chai';
import {existsSync} from 'node:fs';
import {mkdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {
  BlobError,
  BlobErrorCode,
  FileBlobStorage,
} from '../../../../../src/infra/cipher/blob/index.js';

describe('FileBlobStorage', () => {
  let storage: FileBlobStorage;
  let testDir: string;

  beforeEach(async () => {
    // Create a temporary test directory
    testDir = join(tmpdir(), `blob-test-${Date.now()}`);
    await mkdir(testDir, {recursive: true});
    storage = new FileBlobStorage({
      maxBlobSize: 1024 * 1024, // 1MB for tests
      maxTotalSize: 5 * 1024 * 1024, // 5MB for tests
      storageDir: testDir,
    });
    await storage.initialize();
  });

  afterEach(async () => {
    // Clean up test directory
    if (existsSync(testDir)) {
      await rm(testDir, {force: true, recursive: true});
    }
  });

  describe('initialize', () => {
    it('should create storage directory', async () => {
      const newTestDir = join(tmpdir(), `blob-test-init-${Date.now()}`);
      const newStorage = new FileBlobStorage({storageDir: newTestDir});

      await newStorage.initialize();

      expect(existsSync(newTestDir)).to.be.true;

      // Cleanup
      await rm(newTestDir, {force: true, recursive: true});
    });

    it('should not fail if called multiple times', async () => {
      await storage.initialize();
      await storage.initialize();

      expect(existsSync(testDir)).to.be.true;
    });

    it('should use default directory if not specified', async () => {
      const defaultStorage = new FileBlobStorage();
      await defaultStorage.initialize();

      // Just verify it doesn't throw
      expect(defaultStorage).to.exist;
    });
  });

  describe('store', () => {
    it('should store a blob with Buffer content', async () => {
      const key = 'test-buffer';
      const content = Buffer.from('Hello, World!');

      const result = await storage.store(key, content);

      expect(result.key).to.equal(key);
      expect(result.content).to.deep.equal(content);
      expect(result.metadata.size).to.equal(content.length);
      expect(result.metadata.createdAt).to.be.a('number');
      expect(result.metadata.updatedAt).to.be.a('number');
    });

    it('should store a blob with string content', async () => {
      const key = 'test-string';
      const content = 'Hello, World!';

      const result = await storage.store(key, content);

      expect(result.key).to.equal(key);
      expect(result.content.toString()).to.equal(content);
      expect(result.metadata.size).to.equal(Buffer.from(content).length);
    });

    it('should store blob with custom metadata', async () => {
      const key = 'test-metadata';
      const content = Buffer.from('test');
      const metadata = {
        contentType: 'text/plain',
        originalName: 'test.txt',
        tags: {category: 'test', project: 'myapp'},
      };

      const result = await storage.store(key, content, metadata);

      expect(result.metadata.contentType).to.equal('text/plain');
      expect(result.metadata.originalName).to.equal('test.txt');
      expect(result.metadata.tags).to.deep.equal({category: 'test', project: 'myapp'});
    });

    it('should create both .blob and .meta.json files', async () => {
      const key = 'test-files';
      const content = Buffer.from('test');

      await storage.store(key, content);

      const blobPath = join(testDir, `${key}.blob`);
      const metaPath = join(testDir, `${key}.meta.json`);
      expect(existsSync(blobPath)).to.be.true;
      expect(existsSync(metaPath)).to.be.true;
    });

    it('should throw error if key is invalid (empty)', async () => {
      const content = Buffer.from('test');

      try {
        await storage.store('', content);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error).to.be.instanceOf(BlobError);
        expect((error as BlobError).code).to.equal(BlobErrorCode.BLOB_INVALID_KEY);
      }
    });

    it('should throw error if key contains invalid characters', async () => {
      const content = Buffer.from('test');

      try {
        await storage.store('invalid/key', content);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error).to.be.instanceOf(BlobError);
        expect((error as BlobError).code).to.equal(BlobErrorCode.BLOB_INVALID_KEY);
      }
    });

    it('should throw error if blob is too large', async () => {
      const largeContent = Buffer.alloc(2 * 1024 * 1024); // 2MB, exceeds 1MB limit

      try {
        await storage.store('large-blob', largeContent);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error).to.be.instanceOf(BlobError);
        expect((error as BlobError).code).to.equal(BlobErrorCode.BLOB_TOO_LARGE);
      }
    });

    it('should throw error if total size would exceed limit', async () => {
      // Store 5 blobs of 900KB each (total 4.5MB)
      for (let i = 0; i < 5; i++) {
        const content = Buffer.alloc(900 * 1024);
        // eslint-disable-next-line no-await-in-loop
        await storage.store(`blob-${i}`, content);
      }

      // Try to store another 900KB blob (would exceed 5MB total limit: 4.5 + 0.9 = 5.4MB)
      const extraContent = Buffer.alloc(900 * 1024);
      try {
        await storage.store('blob-5', extraContent);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error).to.be.instanceOf(BlobError);
        expect((error as BlobError).code).to.equal(BlobErrorCode.BLOB_TOTAL_SIZE_EXCEEDED);
      }
    });

    it('should throw error if storage not initialized', async () => {
      const uninitializedStorage = new FileBlobStorage({storageDir: testDir});

      try {
        await uninitializedStorage.store('test', Buffer.from('test'));
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error).to.be.instanceOf(BlobError);
        expect((error as BlobError).code).to.equal(BlobErrorCode.BLOB_NOT_INITIALIZED);
      }
    });
  });

  describe('retrieve', () => {
    it('should retrieve a stored blob', async () => {
      const key = 'test-retrieve';
      const content = Buffer.from('Hello, World!');

      await storage.store(key, content);
      const retrieved = await storage.retrieve(key);

      expect(retrieved).to.exist;
      expect(retrieved!.key).to.equal(key);
      expect(retrieved!.content).to.deep.equal(content);
      expect(retrieved!.metadata.size).to.equal(content.length);
    });

    it('should return undefined if blob does not exist', async () => {
      const retrieved = await storage.retrieve('nonexistent');

      expect(retrieved).to.be.undefined;
    });

    it('should retrieve blob with all metadata', async () => {
      const key = 'test-metadata-retrieve';
      const content = Buffer.from('test');
      const metadata = {
        contentType: 'application/json',
        originalName: 'data.json',
        tags: {env: 'test'},
      };

      await storage.store(key, content, metadata);
      const retrieved = await storage.retrieve(key);

      expect(retrieved!.metadata.contentType).to.equal('application/json');
      expect(retrieved!.metadata.originalName).to.equal('data.json');
      expect(retrieved!.metadata.tags).to.deep.equal({env: 'test'});
    });

    it('should throw error if key is invalid', async () => {
      try {
        await storage.retrieve('invalid/key');
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error).to.be.instanceOf(BlobError);
        expect((error as BlobError).code).to.equal(BlobErrorCode.BLOB_INVALID_KEY);
      }
    });
  });

  describe('delete', () => {
    it('should delete a blob', async () => {
      const key = 'test-delete';
      const content = Buffer.from('test');

      await storage.store(key, content);
      await storage.delete(key);

      const retrieved = await storage.retrieve(key);
      expect(retrieved).to.be.undefined;
    });

    it('should delete both .blob and .meta.json files', async () => {
      const key = 'test-delete-files';
      const content = Buffer.from('test');

      await storage.store(key, content);
      await storage.delete(key);

      const blobPath = join(testDir, `${key}.blob`);
      const metaPath = join(testDir, `${key}.meta.json`);
      expect(existsSync(blobPath)).to.be.false;
      expect(existsSync(metaPath)).to.be.false;
    });

    it('should throw error if blob does not exist', async () => {
      try {
        await storage.delete('nonexistent');
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error).to.be.instanceOf(BlobError);
        expect((error as BlobError).code).to.equal(BlobErrorCode.BLOB_NOT_FOUND);
      }
    });

    it('should update stats after deletion', async () => {
      const key1 = 'test-delete-stats-1';
      const key2 = 'test-delete-stats-2';
      const content = Buffer.from('test');

      await storage.store(key1, content);
      await storage.store(key2, content);

      let stats = await storage.getStats();
      expect(stats.totalBlobs).to.equal(2);

      await storage.delete(key1);

      stats = await storage.getStats();
      expect(stats.totalBlobs).to.equal(1);
    });
  });

  describe('exists', () => {
    it('should return true if blob exists', async () => {
      const key = 'test-exists';
      const content = Buffer.from('test');

      await storage.store(key, content);
      const exists = await storage.exists(key);

      expect(exists).to.be.true;
    });

    it('should return false if blob does not exist', async () => {
      const exists = await storage.exists('nonexistent');

      expect(exists).to.be.false;
    });
  });

  describe('list', () => {
    it('should list all blob keys', async () => {
      await storage.store('blob-1', Buffer.from('test1'));
      await storage.store('blob-2', Buffer.from('test2'));
      await storage.store('blob-3', Buffer.from('test3'));

      const keys = await storage.list();

      expect(keys).to.have.lengthOf(3);
      expect(keys).to.include('blob-1');
      expect(keys).to.include('blob-2');
      expect(keys).to.include('blob-3');
    });

    it('should list blobs with prefix filter', async () => {
      await storage.store('user-avatar-1', Buffer.from('test1'));
      await storage.store('user-avatar-2', Buffer.from('test2'));
      await storage.store('screenshot-1', Buffer.from('test3'));

      const keys = await storage.list('user-');

      expect(keys).to.have.lengthOf(2);
      expect(keys).to.include('user-avatar-1');
      expect(keys).to.include('user-avatar-2');
      expect(keys).to.not.include('screenshot-1');
    });

    it('should return empty array if no blobs exist', async () => {
      const keys = await storage.list();

      expect(keys).to.be.an('array');
      expect(keys).to.have.lengthOf(0);
    });
  });

  describe('getMetadata', () => {
    it('should get metadata without loading content', async () => {
      const key = 'test-metadata-only';
      const content = Buffer.from('large content that we dont want to load');
      const metadata = {
        contentType: 'text/plain',
        originalName: 'large.txt',
      };

      await storage.store(key, content, metadata);
      const retrieved = await storage.getMetadata(key);

      expect(retrieved).to.exist;
      expect(retrieved!.size).to.equal(content.length);
      expect(retrieved!.contentType).to.equal('text/plain');
      expect(retrieved!.originalName).to.equal('large.txt');
    });

    it('should return undefined if blob does not exist', async () => {
      const metadata = await storage.getMetadata('nonexistent');

      expect(metadata).to.be.undefined;
    });
  });

  describe('getStats', () => {
    it('should return stats for empty storage', async () => {
      const stats = await storage.getStats();

      expect(stats.totalBlobs).to.equal(0);
      expect(stats.totalSize).to.equal(0);
      expect(stats.lastUpdated).to.be.a('number');
    });

    it('should return accurate stats after storing blobs', async () => {
      const content1 = Buffer.from('test1'); // 5 bytes
      const content2 = Buffer.from('test22'); // 6 bytes

      await storage.store('blob-1', content1);
      await storage.store('blob-2', content2);

      const stats = await storage.getStats();

      expect(stats.totalBlobs).to.equal(2);
      expect(stats.totalSize).to.equal(11); // 5 + 6
    });

    it('should update stats after deletion', async () => {
      const content = Buffer.from('test'); // 4 bytes

      await storage.store('blob-1', content);
      await storage.store('blob-2', content);
      await storage.delete('blob-1');

      const stats = await storage.getStats();

      expect(stats.totalBlobs).to.equal(1);
      expect(stats.totalSize).to.equal(4);
    });

    it('should cache stats for performance', async () => {
      await storage.store('blob-1', Buffer.from('test'));

      const stats1 = await storage.getStats();
      const stats2 = await storage.getStats();

      // Should return the same cached object
      expect(stats1.lastUpdated).to.equal(stats2.lastUpdated);
    });
  });

  describe('clear', () => {
    it('should clear all blobs', async () => {
      await storage.store('blob-1', Buffer.from('test1'));
      await storage.store('blob-2', Buffer.from('test2'));
      await storage.store('blob-3', Buffer.from('test3'));

      await storage.clear();

      const keys = await storage.list();
      expect(keys).to.have.lengthOf(0);

      const stats = await storage.getStats();
      expect(stats.totalBlobs).to.equal(0);
      expect(stats.totalSize).to.equal(0);
    });

    it('should remove all .blob and .meta.json files', async () => {
      await storage.store('blob-1', Buffer.from('test'));
      await storage.clear();

      const blobPath = join(testDir, 'blob-1.blob');
      const metaPath = join(testDir, 'blob-1.meta.json');
      expect(existsSync(blobPath)).to.be.false;
      expect(existsSync(metaPath)).to.be.false;
    });
  });

  describe('key validation', () => {
    it('should accept alphanumeric keys', async () => {
      const key = 'testBlob123';
      await storage.store(key, Buffer.from('test'));

      const exists = await storage.exists(key);
      expect(exists).to.be.true;
    });

    it('should accept keys with hyphens', async () => {
      const key = 'test-blob-123';
      await storage.store(key, Buffer.from('test'));

      const exists = await storage.exists(key);
      expect(exists).to.be.true;
    });

    it('should accept keys with underscores', async () => {
      const key = 'test_blob_123';
      await storage.store(key, Buffer.from('test'));

      const exists = await storage.exists(key);
      expect(exists).to.be.true;
    });

    it('should reject keys with special characters', async () => {
      const invalidKeys = ['test@blob', 'test.blob', 'test blob', 'test/blob', String.raw`test\blob`];

      for (const key of invalidKeys) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await storage.store(key, Buffer.from('test'));
          expect.fail(`Should have rejected key: ${key}`);
        } catch (error) {
          expect(error).to.be.instanceOf(BlobError);
          expect((error as BlobError).code).to.equal(BlobErrorCode.BLOB_INVALID_KEY);
        }
      }
    });
  });

  describe('edge cases', () => {
    it('should handle empty buffer', async () => {
      const key = 'empty-blob';
      const content = Buffer.from('');

      const result = await storage.store(key, content);

      expect(result.metadata.size).to.equal(0);

      const retrieved = await storage.retrieve(key);
      expect(retrieved!.content.length).to.equal(0);
    });

    it('should handle binary data correctly', async () => {
      const key = 'binary-blob';
      const content = Buffer.from([0x00, 0xFF, 0xAA, 0x55, 0x12, 0x34]);

      await storage.store(key, content);
      const retrieved = await storage.retrieve(key);

      expect(retrieved!.content).to.deep.equal(content);
    });

    it('should overwrite existing blob when storing with same key', async () => {
      const key = 'overwrite-test';
      const content1 = Buffer.from('original');
      const content2 = Buffer.from('updated');

      await storage.store(key, content1);
      await storage.store(key, content2);

      const retrieved = await storage.retrieve(key);
      expect(retrieved!.content.toString()).to.equal('updated');
    });
  });
});
