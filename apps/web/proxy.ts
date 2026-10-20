import { NextResponse, type NextRequest } from "next/server";
export function proxy(request: NextRequest) {
  if (!request.cookies.has("access") && !request.cookies.has("refresh")) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}
export const config = {
  matcher: [
    "/student/:path*",
    "/tutor/:path*",
    "/admin/:path*",
    "/change-password",
  ],
};
