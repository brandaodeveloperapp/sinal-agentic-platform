import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

export type Actor = "subscriber" | "attendant";

export interface DirectoryUser {
  username: string;
  subject: string;
  displayName: string;
  actor: Actor;
  customerId?: string;
  scopes: string[];
}

const SUBSCRIBER_SCOPES = [
  "catalog:read",
  "customer:read",
  "usage:read",
  "billing:read",
  "support:read",
  "support:write",
];

export const USERS: DirectoryUser[] = [
  {
    username: "marina",
    subject: "user-marina",
    displayName: "Marina Andrade",
    actor: "subscriber",
    customerId: "CUS-1001",
    scopes: SUBSCRIBER_SCOPES,
  },
  {
    username: "rafael",
    subject: "user-rafael",
    displayName: "Rafael Queiroz",
    actor: "subscriber",
    customerId: "CUS-1002",
    scopes: SUBSCRIBER_SCOPES,
  },
  {
    username: "agent-smith",
    subject: "staff-smith",
    displayName: "Support Desk",
    actor: "attendant",
    scopes: [...SUBSCRIBER_SCOPES, "customer:any"],
  },
];

interface StoredCredential {
  salt: Buffer;
  hash: Buffer;
}

/**
 * Simulated identity provider.
 *
 * Credentials are never stored in clear text: the shared demo password is derived
 * with scrypt under a per-user salt at boot, and comparison is constant time. A
 * real deployment replaces this class with an OIDC provider; nothing outside it
 * knows how the user was authenticated.
 */
export class Directory {
  private credentials = new Map<string, StoredCredential>();
  private ready: Promise<void>;

  constructor(
    password: string,
    private readonly users: DirectoryUser[] = USERS,
  ) {
    this.ready = this.seed(password);
  }

  private async seed(password: string): Promise<void> {
    for (const user of this.users) {
      const salt = randomBytes(16);
      const hash = (await scrypt(password, salt, 32)) as Buffer;
      this.credentials.set(user.username, { salt, hash });
    }
  }

  async authenticate(username: string, password: string): Promise<DirectoryUser | null> {
    await this.ready;
    const user = this.users.find((candidate) => candidate.username === username);
    const stored = this.credentials.get(username);

    if (!user || !stored) {
      await this.burnTime(password);
      return null;
    }

    const attempt = (await scrypt(password, stored.salt, 32)) as Buffer;
    if (!timingSafeEqual(attempt, stored.hash)) {
      return null;
    }
    return user;
  }

  private async burnTime(password: string): Promise<void> {
    await scrypt(password, randomBytes(16), 32);
  }
}
