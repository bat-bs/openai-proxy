import type {DefaultSession, NextAuthConfig} from "next-auth";
import ZitadelProvider from "next-auth/providers/zitadel";

function decodeJwtPayload(token: string): unknown {
    try {
        const payload = token.split(".")[1];
        if (!payload) return null;
        const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
        const json = Buffer.from(base64, "base64").toString("utf8");
        return JSON.parse(json);
    } catch {
        return null;
    }
}

/**
 * Module augmentation for `next-auth` types. Allows us to add custom properties to the `session`
 * object and keep type safety.
 *
 * @see https://next-auth.js.org/getting-started/typescript#module-augmentation
 */
declare module "next-auth" {
    interface JWT {
        roles?: string[];
    }

    interface Session extends DefaultSession {
        user: {
            id: string;
            isAdmin: boolean;
            // ...other properties
            // role: UserRole;
        } & DefaultSession["user"];
    }
}


/**
 * Options for NextAuth.js used to configure adapters, providers, callbacks, etc.
 *
 * @see https://next-auth.js.org/configuration/options
 */
export const authConfig = {
    providers: [
        ZitadelProvider({
            issuer: process.env.ZITADEL_ISSUER,
            clientId: process.env.ZITADEL_CLIENT_ID,
            clientSecret: process.env.ZITADEL_CLIENT_SECRET,
        }),
        /**
         * ...add more providers here.
         *
         * Most other providers require a bit more work than the Discord provider. For example, the
         * GitHub provider requires you to add the `refresh_token_expires_in` field to the Account
         * model. Refer to the NextAuth.js docs for the provider you want to use. Example:
         *
         * @see https://next-auth.js.org/providers/github
         */
    ],
    callbacks: {
        async jwt({token, profile, account}) {
            if (profile?.sub) {
                token.sub = profile.sub;
            }
            if (Array.isArray(profile?.roles)) {
                token.roles = profile.roles;
            }
            if (!token.roles && typeof account?.id_token === "string") {
                const claims = decodeJwtPayload(account.id_token) as { roles?: unknown } | null;
                if (Array.isArray(claims?.roles)) {
                    token.roles = claims.roles as string[];
                }
            }
            if (profile?.picture) {
                token.picture = profile.picture;
            }
            return token;
        },
        async session({session, token}) {
            if (session.user) {
                const sub = token.sub ?? session.user.id;
                session.user.id = sub;
                if (typeof token.picture === "string") {
                    session.user.image = token.picture;
                }
                session.user.isAdmin = Array.isArray(token.roles)
                    ? token.roles.includes("admin")
                    : false;
            }
            return session;
        },
    },
} satisfies NextAuthConfig;
