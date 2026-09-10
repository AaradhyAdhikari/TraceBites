import { NextResponse } from "next/server";
import { harvestInput, registerHarvest } from "@/lib/harvest";
import { getSession } from "@/lib/session";

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || session.role !== "farmer") {
    return NextResponse.json({ error: "Sign in as a farmer first" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Malformed request" }, { status: 400 });
  }

  const parsed = harvestInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Check the form and try again" },
      { status: 400 },
    );
  }

  try {
    const result = await registerHarvest(parsed.data, {
      userId: session.userId,
      orgId: session.orgId,
    });
    return NextResponse.json(result, { status: result.deduplicated ? 200 : 201 });
  } catch (err) {
    console.error("harvest registration failed", err);
    const message = err instanceof Error ? err.message : "Registration failed";
    // Bad input from the client is permanent; the offline queue must not retry it.
    const isClientFault = /not found|Unknown crop|Unknown user/i.test(message);
    return NextResponse.json({ error: message }, { status: isClientFault ? 400 : 500 });
  }
}
