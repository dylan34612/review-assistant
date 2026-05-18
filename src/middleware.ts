import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname === "/sw.js" || pathname === "/manifest.webmanifest" || pathname.startsWith("/icon")) {
    return NextResponse.next();
  }

  if (process.env.AUTH_ENABLED !== "true") {
    return NextResponse.next();
  }

  const username = process.env.AUTH_USERNAME;
  const password = process.env.AUTH_PASSWORD;

  if (!username || !password) {
    return new NextResponse("Authentication is enabled but AUTH_USERNAME or AUTH_PASSWORD is missing.", {
      status: 500
    });
  }

  const header = request.headers.get("authorization");
  if (header?.startsWith("Basic ")) {
    const decoded = decodeBasicAuth(header.slice("Basic ".length));
    if (decoded) {
      const separator = decoded.indexOf(":");
      const suppliedUser = decoded.slice(0, separator);
      const suppliedPassword = decoded.slice(separator + 1);
      if (suppliedUser === username && suppliedPassword === password) {
        return NextResponse.next();
      }
    }
  }

  return new NextResponse("Authentication required.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Review Assistant", charset="UTF-8"',
      "Cache-Control": "no-store"
    }
  });
}

function decodeBasicAuth(value: string) {
  try {
    return atob(value);
  } catch {
    return undefined;
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
