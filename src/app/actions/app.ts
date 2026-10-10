"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { SCOPE_COOKIE, visibleCompanies } from "@/lib/data";

export async function setScope(key: string) {
  const user = await requireUser();
  const valid = key === "all" || key === "pro" || visibleCompanies(user.id).some((c) => c.id === key);
  (await cookies()).set(SCOPE_COOKIE, valid ? key : "all", { path: "/", sameSite: "lax", httpOnly: true, maxAge: 60 * 60 * 24 * 365 });
  revalidatePath("/", "layout");
}
