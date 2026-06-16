import { OrchidAuthContext, OrchidIdentityResolver } from "@orchid-ai/orchid/core";

export class DevBypassIdentityResolver extends OrchidIdentityResolver {
    override async resolve(domain: string, bearerToken: string): Promise<OrchidAuthContext> {
        return new OrchidAuthContext({
            accessToken: bearerToken || "dev-token",
            tenantKey: domain || "99999",
            userId: "dev-user-00000000",
            roles: ["admin"],
        });
    }
}
