export interface TransportEvents {
  connected(): void;
  disconnected(): void;
  error(error: Error): void;
  message(data: Uint8Array): void;
}

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
