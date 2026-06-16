import { describe, it, expect } from "vitest";
import { OrchidAuthContext } from "@orchid-ai/orchid/core";
import {
    buildVisibilityFilter,
    applyVisibilityFilter,
    scopedVisibilityFilter,
} from "../../src/helpers/visibility.js";

describe("buildVisibilityFilter", () => {
    it("builds filter from auth context", () => {
        const auth = new OrchidAuthContext({ accessToken: "t", tenantKey: "t1", userId: "u1" });
        const filter = buildVisibilityFilter(auth);
        expect(filter.tenant_id).toBe("t1");
        expect(filter.user_id).toBe("u1");
        expect(filter.roles).toEqual([]);
    });

    it("includes roles from auth context", () => {
        const auth = new OrchidAuthContext({
            accessToken: "t",
            tenantKey: "t1",
            userId: "u1",
            roles: ["admin", "editor"],
        });
        const filter = buildVisibilityFilter(auth);
        expect(filter.roles).toEqual(["admin", "editor"]);
    });
});

describe("applyVisibilityFilter", () => {
    const records = [
        { id: "1", tenant_id: "t1", user_id: "u1" },
        { id: "2", tenant_id: "t1", user_id: "u2" },
        { id: "3", tenant_id: "t2", user_id: "u1" },
        { id: "4", tenant_id: "t1", user_id: "u3" },
    ];

    it("filters records by tenant and user", () => {
        const result = applyVisibilityFilter(records, {
            tenant_id: "t1",
            user_id: "u1",
            roles: [],
        });
        expect(result).toHaveLength(1);
        expect(result[0]!.id).toBe("1");
    });

    it("returns all tenant records for admin", () => {
        const result = applyVisibilityFilter(records, {
            tenant_id: "t1",
            user_id: "u1",
            roles: ["admin"],
        });
        expect(result).toHaveLength(3);
    });

    it("returns empty for different tenant", () => {
        const result = applyVisibilityFilter(records, {
            tenant_id: "t3",
            user_id: "u1",
            roles: [],
        });
        expect(result).toHaveLength(0);
    });
});

describe("scopedVisibilityFilter", () => {
    it("combines build and apply", () => {
        const auth = new OrchidAuthContext({
            accessToken: "t",
            tenantKey: "t1",
            userId: "u1",
            roles: ["admin"],
        });
        const records = [
            { tenant_id: "t1", user_id: "u2" },
            { tenant_id: "t1", user_id: "u3" },
            { tenant_id: "t2", user_id: "u1" },
        ];
        const result = scopedVisibilityFilter(auth, records);
        expect(result).toHaveLength(2);
    });
});
