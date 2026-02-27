import type { DefaultSession, NextAuthConfig } from "next-auth";
import ZitadelProvider from "next-auth/providers/zitadel";

/**
 * Module augmentation for `next-auth` types. Allows us to add custom properties to the `session`
 * object and keep type safety.
 *
 * @see https://next-auth.js.org/getting-started/typescript#module-augmentation
 */
declare module "next-auth" {
	interface Session extends DefaultSession {
		user: {
			id: string;
			// ...other properties
			// role: UserRole;
		} & DefaultSession["user"];
	}

	// interface User {
	//   // ...other properties
	//   // role: UserRole;
	// }
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
		async jwt({ token, profile }) {
			if (profile?.sub) {
				token.sub = profile.sub;
			}
			if (profile?.picture) {
				token.picture = profile.picture;
			}
			return token;
		},
		async session({ session, token }) {
			if (session.user) {
				const sub = token.sub ?? session.user.id;
				session.user.id = sub;
				if (typeof token.picture === "string") {
					session.user.image = token.picture;
				}
			}
			return session;
		},
	},
} satisfies NextAuthConfig;
