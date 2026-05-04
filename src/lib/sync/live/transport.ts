export interface TransportEventArgs {
  connected: [];
  disconnected: [];
  message: [data: Uint8Array];
}

export type TransportEvents = {
  [E in keyof TransportEventArgs]: (...args: TransportEventArgs[E]) => void;
};

export interface Transport {
  readonly connected: boolean;
  send(data: Uint8Array): Promise<void>;
  on<E extends keyof TransportEvents>(
    event: E,
    handler: TransportEvents[E],
  ): void;
  off<E extends keyof TransportEvents>(
    event: E,
    handler: TransportEvents[E],
  ): void;
  destroy(): Promise<void>;
}

export const noopTransport: Transport = {
  connected: false,
  async send() {},
  on() {},
  off() {},
  async destroy() {},
};
