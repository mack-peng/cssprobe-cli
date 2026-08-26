import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createClientInfo } from '../src/daemon/session';

describe('session', () => {
  describe('createClientInfo', () => {
    it('returns valid client info', () => {
      const info = createClientInfo();
      
      assert.ok(info.version, 'should have version');
      assert.ok(info.workspaceDirHash, 'should have workspaceDirHash');
      assert.ok(info.daemonProfilesDir, 'should have daemonProfilesDir');
      assert.ok(info.homeDir, 'should have homeDir');
    });

    it('generates consistent hash for same directory', () => {
      const info1 = createClientInfo();
      const info2 = createClientInfo();
      
      assert.strictEqual(info1.workspaceDirHash, info2.workspaceDirHash);
    });

    it('uses home directory', () => {
      const info = createClientInfo();
      
      assert.strictEqual(info.homeDir, os.homedir());
    });

    it('generates valid daemon profiles dir path', () => {
      const info = createClientInfo();
      
      assert.ok(info.daemonProfilesDir.includes('cssprobe-cli'));
      assert.ok(info.daemonProfilesDir.includes('daemon'));
      assert.ok(info.daemonProfilesDir.includes(info.workspaceDirHash));
    });
  });
});
