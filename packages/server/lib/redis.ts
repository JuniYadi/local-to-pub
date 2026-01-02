// packages/server/lib/redis.ts
import { RedisClient } from "bun";

export interface TunnelInfo {
  tokenId: number;
  connectedAt: number;
  localPort: number;
}

const KEY_PREFIX = "tunnel:";

export class TunnelStore {
  private redis: RedisClient | null = null;
  private url: string;

  constructor(url: string = "redis://localhost:6379") {
    this.url = url;
  }

  async connect(): Promise<void> {
    this.redis = new RedisClient(this.url);
    await this.redis.connect();
  }

  async disconnect(): Promise<void> {
    if (this.redis) {
      this.redis.close();
      this.redis = null;
    }
  }

  async register(subdomain: string, info: TunnelInfo): Promise<void> {
    if (!this.redis) throw new Error("Redis not connected");

    const key = `${KEY_PREFIX}${subdomain}`;
    await this.redis.set(key, JSON.stringify(info));
  }

  async unregister(subdomain: string): Promise<void> {
    if (!this.redis) throw new Error("Redis not connected");

    const key = `${KEY_PREFIX}${subdomain}`;
    await this.redis.del(key);
  }

  async get(subdomain: string): Promise<TunnelInfo | null> {
    if (!this.redis) throw new Error("Redis not connected");

    const key = `${KEY_PREFIX}${subdomain}`;
    const data = await this.redis.get(key);

    if (!data) return null;
    return JSON.parse(data) as TunnelInfo;
  }

  async exists(subdomain: string): Promise<boolean> {
    if (!this.redis) throw new Error("Redis not connected");

    const key = `${KEY_PREFIX}${subdomain}`;
    const result = await this.redis.exists(key);
    return Boolean(result);
  }

  async clear(prefix: string = ""): Promise<void> {
    if (!this.redis) throw new Error("Redis not connected");

    const pattern = `${KEY_PREFIX}${prefix}*`;
    const keys = await this.redis.keys(pattern);
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }
}
