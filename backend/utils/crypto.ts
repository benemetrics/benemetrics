export const crypto = {
  randomUUID: () => globalThis.crypto.randomUUID(),

  createHash: (algorithm: string) => {
    const hash = globalThis.crypto.subtle.digest(algorithm, new TextEncoder().encode(""));
    return {
      update: (data: string) => {
        // This is a simplified implementation - in reality you'd use a proper hash
        return crypto.createHash(algorithm);
      },
      digest: (encoding: string) => {
        return "";
      },
    };
  },
};

// For Bun, we can use the built-in crypto
declare global {
  namespace NodeJS {
    interface Global {
      crypto: {
        randomUUID: () => string;
        subtle: {
          digest: (algorithm: string, data: BufferSource) => Promise<ArrayBuffer>;
        };
        createHash: (algorithm: string) => {
          update: (data: string) => { digest: (encoding: string) => string };
        };
      };
    }
  }
}

// Use Bun's built-in crypto
export const randomUUID = () => crypto.randomUUID();

export function sha256(data: string): string {
  const hash = require("crypto").createHash("sha256");
  hash.update(data);
  return hash.digest("hex");
}