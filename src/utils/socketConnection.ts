/**
 * Socket communication utility.
 * Adapted from playwright-cli.
 */

import net from 'net';

export class SocketConnection {
  private _socket: net.Socket;
  private _pendingBuffers: Buffer[] = [];

  onclose?: () => void;
  onmessage?: (message: any) => void;

  constructor(socket: net.Socket) {
    this._socket = socket;
    socket.on('data', buffer => this._onData(buffer));
    socket.on('close', () => {
      this.onclose?.();
    });

    socket.on('error', e => console.error(`error: ${e.message}`));
  }

  async send(message: { id: number, error?: string, result?: any }) {
    await new Promise((resolve, reject) => {
      this._socket.write(`${JSON.stringify(message)}\n`, error => {
        if (error)
          reject(error);
        else
          resolve(undefined);
      });
    });
  }

  close() {
    this._socket.destroy();
  }

  private _onData(buffer: Buffer) {
    let end = buffer.indexOf('\n');
    if (end === -1) {
      this._pendingBuffers.push(buffer);
      return;
    }
    this._pendingBuffers.push(buffer.slice(0, end));
    const message = Buffer.concat(this._pendingBuffers).toString();
    this._dispatchMessage(message);

    let start = end + 1;
    end = buffer.indexOf('\n', start);
    while (end !== -1) {
      const message = buffer.toString(undefined, start, end);
      this._dispatchMessage(message);
      start = end + 1;
      end = buffer.indexOf('\n', start);
    }
    this._pendingBuffers = [buffer.slice(start)];
  }

  private _dispatchMessage(message: string) {
    try {
      this.onmessage?.(JSON.parse(message));
    } catch (e) {
      console.error('failed to dispatch message', e);
    }
  }
}
