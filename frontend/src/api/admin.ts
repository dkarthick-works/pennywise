import client from "./client";
import type { AdminUsersResponse } from "../types";

export const ADMIN_PAGE_SIZE = 50;

export const listAdminUsers = (offset: number) =>
  client
    .get<AdminUsersResponse>("/api/admin/users", { params: { limit: ADMIN_PAGE_SIZE, offset } })
    .then((r) => r.data);
