import { redis } from "bun";

const store = async <T>(time: number, key: string) => {
    const obj = {
        value: null as T | null,
        write: async (v: T | Promise<T>) => {
            const newV = await v;
            await redis.set(key, JSON.stringify(newV));
            await redis.expire(key, time);
            obj.value = newV; // need expire as well
            return newV;
        }
    }
    const value = await redis.get(key)
    if (value) obj.value = JSON.parse(value);

    return obj;
}

enum TIME {
    SECOND = 1,
    MINUTE = 60,
    HOUR = TIME.MINUTE * TIME.MINUTE
}

export const cache = {
    PERMISSIONS: (userId: string) => store<{ projectIds: string[]; appIds: string[] }>(TIME.HOUR, `${userId}:PERMISSIONS`),
    AUTH_GROUPS: store<Set<string>>(TIME.HOUR, `ALLOWED_GROUPS`),
} as const;