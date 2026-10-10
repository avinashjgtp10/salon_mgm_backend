import Transport from 'winston-transport';
import axios from 'axios';
import os from 'os';

/**
 * Ships winston log lines to SolarWinds Observability (Papertrail's HTTP
 * log-ingestion endpoint — https://logs.collector.<region>.cloud.solarwinds.com/v1/logs).
 *
 * This is NOT the legacy Papertrail syslog drain (host:port over TCP/UDP) —
 * it's a plain HTTPS POST with a bearer token, so a small custom transport
 * is simpler and more reliable here than pulling in a syslog client.
 *
 * Batches log lines and flushes on a timer so a burst of logs (e.g. a
 * campaign send) doesn't fire one HTTP request per line. Never throws:
 * a Papertrail outage must not take down the app or recurse back into
 * the logger.
 */

interface SolarWindsTransportOptions extends Transport.TransportStreamOptions {
  endpoint: string;
  token: string;
  serviceName: string;
  hostName?: string;
  flushIntervalMs?: number;
  maxBatchSize?: number;
}

export class SolarWindsTransport extends Transport {
  private readonly endpoint: string;
  private readonly token: string;
  private readonly resourceAttrHeader: string;
  private readonly flushIntervalMs: number;
  private readonly maxBatchSize: number;
  private buffer: string[] = [];
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(opts: SolarWindsTransportOptions) {
    super(opts);
    this.endpoint = opts.endpoint;
    this.token = opts.token;
    this.flushIntervalMs = opts.flushIntervalMs ?? 2000;
    this.maxBatchSize = opts.maxBatchSize ?? 50;

    const hostName = opts.hostName || os.hostname();
    this.resourceAttrHeader = `host.name=${hostName}, service.name=${opts.serviceName}`;

    this.scheduleFlush();
  }

  log(info: Record<string, any>, callback: () => void): void {
    setImmediate(() => this.emit('logged', info));

    try {
      const { timestamp, level, message, ...meta } = info;
      const line = `${timestamp} [${level}]: ${message} ${
        Object.keys(meta).length ? JSON.stringify(meta) : ''
      }`.trim();
      this.buffer.push(line);

      if (this.buffer.length >= this.maxBatchSize) {
        this.flush();
      }
    } catch {
      // Never let a formatting error here break logging.
    }

    callback();
  }

  private scheduleFlush(): void {
    this.flushTimer = setInterval(() => this.flush(), this.flushIntervalMs);
    // Don't let this timer keep the process alive on shutdown.
    this.flushTimer.unref?.();
  }

  private flush(): void {
    if (this.buffer.length === 0) return;

    const batch = this.buffer;
    this.buffer = [];

    axios
      .post(this.endpoint, batch.join('\n'), {
        headers: {
          'Content-Type': 'application/octet-stream',
          Authorization: `Bearer ${this.token}`,
          'X-Otel-Resource-Attr': this.resourceAttrHeader,
        },
        timeout: 5000,
      })
      .catch((err) => {
        // Deliberately swallow + console.error (not logger.error) — routing
        // a SolarWinds failure back through winston would recurse into this
        // same transport.
        console.error('⚠️  SolarWinds log shipping failed:', err.message);
      });
  }

  close(): void {
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flush();
  }
}
