import { redirect } from "next/navigation";
import { signOut } from "@/lib/session";

export default async function LogoutPage() {
  await signOut();
  redirect("/login");
}
