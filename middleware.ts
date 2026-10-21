import { NextRequest, NextResponse } from "next/server";
export function middleware(req: NextRequest) {
  const password = process.env.APP_PASSWORD;
  const host = req.nextUrl.hostname;
  if (!password) {
    if (
      process.env.NODE_ENV !== "production" &&
      ["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)
    )
      return NextResponse.next();
    return new NextResponse("Set APP_PASSWORD before network access", {
      status: 503,
    });
  }
  const supplied = req.headers.get("authorization");
  if (
    supplied ===
    `Basic ${btoa(Array.from(new TextEncoder().encode("hideki:" + password), (byte) => String.fromCharCode(byte)).join(""))}`
  )
    return NextResponse.next();
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="HIDEKI", charset="UTF-8"' },
  });
}
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
