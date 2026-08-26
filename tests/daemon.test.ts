import { describe, it } from 'node:test';
import assert from 'node:assert';
import net from 'net';
import { SocketConnection } from '../src/utils/socketConnection';

describe('socketConnection', () => {
  describe('SocketConnection', () => {
    it('delivers newline-delimited messages', async () => {
      const messages: any[] = [];
      const server = net.createServer(socket => {
        const conn = new SocketConnection(socket);
        conn.onmessage = msg => messages.push(msg);
      });

      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
      const port = (server.address() as net.AddressInfo).port;

      const client = net.createConnection(port, '127.0.0.1');
      await new Promise<void>(resolve => client.on('connect', () => resolve()));
      client.write(JSON.stringify({ id: 1, method: 'run' }) + '\n');
      await new Promise<void>(resolve => setTimeout(resolve, 50));
      client.write(JSON.stringify({ id: 2, method: 'stop' }) + '\n');
      await new Promise<void>(resolve => setTimeout(resolve, 50));

      assert.strictEqual(messages.length, 2);
      assert.strictEqual(messages[0].id, 1);
      assert.strictEqual(messages[1].id, 2);

      client.destroy();
      await new Promise<void>(resolve => server.close(() => resolve()));
    });

    it('handles a message split across multiple chunks', async () => {
      const messages: any[] = [];
      const server = net.createServer(socket => {
        const conn = new SocketConnection(socket);
        conn.onmessage = msg => messages.push(msg);
      });

      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
      const port = (server.address() as net.AddressInfo).port;

      const client = net.createConnection(port, '127.0.0.1');
      await new Promise<void>(resolve => client.on('connect', () => resolve()));
      const payload = JSON.stringify({ id: 7, method: 'run' });
      client.write(payload.slice(0, 5));
      await new Promise<void>(resolve => setTimeout(resolve, 50));
      client.write(payload.slice(5) + '\n');
      await new Promise<void>(resolve => setTimeout(resolve, 50));

      assert.strictEqual(messages.length, 1);
      assert.strictEqual(messages[0].id, 7);

      client.destroy();
      await new Promise<void>(resolve => server.close(() => resolve()));
    });
  });
});